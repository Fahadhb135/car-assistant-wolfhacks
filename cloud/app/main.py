import json
import logging
import os
import time
from pathlib import Path
from typing import Callable, Optional

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse

from .chat import ChatFn, ChatRequest, ChatResponse, answer, chat_from_env
from .databricks_sink import DatabricksSink
from .hotspots import aggregate_events, events_from_trips, near
from .db import TripStore
from .model_registry import PATTERN, latest_model
from .reports import GeminiFn, gemini_from_env, make_report
from .schemas import Hotspot, HotspotSnapshot, ModelInfo, Report, Trip

CLOUD_DIR = Path(__file__).resolve().parent.parent  # defaults live under cloud/ however we're launched

LiveTokenFn = Callable[[], str]


def live_token_from_env(api_key: str) -> LiveTokenFn:
    """Mints a short-lived Gemini Live token. UNVERIFIED against the SDK: this is the
    hour-1 spike. If it fails on a phone, replace with a WebSocket proxy."""

    def mint() -> str:
        import datetime

        from google import genai

        client = genai.Client(api_key=api_key, http_options={"api_version": "v1alpha"})
        now = datetime.datetime.now(tz=datetime.timezone.utc)
        token = client.auth_tokens.create(
            config={
                "uses": 1,
                "expire_time": now + datetime.timedelta(minutes=30),
                "new_session_expire_time": now + datetime.timedelta(minutes=1),
            }
        )
        return token.name

    return mint


def create_app(
    db_path: Optional[str] = None,
    models_dir: Optional[Path] = None,
    gemini: Optional[GeminiFn] = None,
    live_token: Optional[LiveTokenFn] = None,
    chat: Optional[ChatFn] = None,
    sink: Optional[DatabricksSink] = None,
) -> FastAPI:
    app = FastAPI(title="Car Assistant cloud")
    store = TripStore(db_path or os.environ.get("TRIPS_DB") or str(CLOUD_DIR / "data" / "trips.db"))
    folder = models_dir or Path(os.environ.get("MODELS_DIR") or CLOUD_DIR / "models")

    key = os.environ.get("GEMINI_API_KEY")
    models = [
        m.strip()
        for m in os.environ.get("GEMINI_MODEL", "gemini-flash-latest,gemini-flash-lite-latest").split(",")
        if m.strip()
    ]
    if gemini is None and key:
        gemini = gemini_from_env(key, models)
    if chat is None and key:
        chat = chat_from_env(key, models)
    if live_token is None and key:
        live_token = live_token_from_env(key)

    if sink is None and os.environ.get("DATABRICKS_HOST") and os.environ.get("DATABRICKS_TOKEN"):
        sink = DatabricksSink(
            os.environ["DATABRICKS_HOST"],
            os.environ["DATABRICKS_TOKEN"],
            os.environ.get("DATABRICKS_VOLUME_PATH", "/Volumes/carassistant/default/trips"),
        )

    def push_to_databricks(trip_id: str) -> bool:
        trip = store.get_trip(trip_id)
        if sink is None or trip is None:
            return False
        try:
            sink.write_trip(trip)
            store.mark_synced(trip_id)
            return True
        except Exception:
            logging.getLogger("cloud").exception("databricks sync failed for %s", trip_id)
            return False

    def check_admin(token: Optional[str]) -> None:
        expected = os.environ.get("ADMIN_TOKEN")
        if expected and token != expected:
            raise HTTPException(401, "bad admin token")

    def local_snapshot() -> HotspotSnapshot:
        hotspots = aggregate_events(events_from_trips(store.all_trips()))
        return HotspotSnapshot(
            source="local",
            generatedAt=int(time.time() * 1000),
            demo=any(h["demo"] for h in hotspots),
            hotspots=hotspots,
        )

    def databricks_snapshot() -> HotspotSnapshot:
        """The ingest/analytics notebook publishes publish/hotspots.json into the Volume."""
        assert sink is not None
        raw = json.loads(sink.read_file("publish/hotspots.json"))
        return HotspotSnapshot.model_validate({**raw, "source": "databricks"})

    def build_report(trip_id: str) -> None:
        trip = store.get_trip(trip_id)
        if trip and store.get_report(trip_id) is None:
            store.save_report(trip_id, make_report(trip, gemini))

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.post("/trips", status_code=201)
    def post_trip(trip: Trip, background: BackgroundTasks) -> dict:
        created = store.insert_if_new(trip, int(time.time() * 1000))
        if created:
            background.add_task(build_report, trip.tripId)
            background.add_task(push_to_databricks, trip.tripId)
        return {"tripId": trip.tripId, "created": created}

    @app.get("/trips/{trip_id}/report", response_model=Report)
    def get_report(trip_id: str) -> Report:
        trip = store.get_trip(trip_id)
        if trip is None:
            raise HTTPException(404, "unknown trip")
        report = store.get_report(trip_id)
        if report is None:
            report = make_report(trip, gemini)
            store.save_report(trip_id, report)
        return report

    @app.post("/admin/databricks/sync")
    def sync_databricks(x_admin_token: Optional[str] = Header(default=None)) -> dict:
        """Retry trips that failed to reach Databricks (e.g. venue wifi was down)."""
        check_admin(x_admin_token)
        if sink is None:
            raise HTTPException(503, "Databricks not configured")
        ids = store.unsynced_ids()
        done = sum(1 for i in ids if push_to_databricks(i))
        return {"pending": len(ids), "synced": done}

    @app.get("/hotspots", response_model=HotspotSnapshot)
    def get_hotspots(lat: float, lon: float, radiusM: float = 5000) -> HotspotSnapshot:
        """Crowd hotspots near a point. Phones fetch this once at trip start."""
        snap = store.load_hotspots()
        if snap is None:  # nothing published yet: build from local trips
            fresh = local_snapshot()
            store.save_hotspots(fresh.model_dump())
            snap_model = fresh
        else:
            snap_model = HotspotSnapshot.model_validate(snap)
        radius = max(100.0, min(radiusM, 50_000.0))
        keep = near([h.model_dump() for h in snap_model.hotspots], lat, lon, radius)
        return snap_model.model_copy(update={"hotspots": [Hotspot(**h) for h in keep]})

    @app.post("/admin/hotspots/refresh")
    def refresh_hotspots(source: str = "auto", x_admin_token: Optional[str] = Header(default=None)) -> dict:
        """Rebuild the served snapshot: from Databricks (auto, if configured) or from local trips."""
        check_admin(x_admin_token)
        if source not in ("auto", "databricks", "local"):
            raise HTTPException(422, "source must be auto, databricks or local")
        snap: Optional[HotspotSnapshot] = None
        if source in ("auto", "databricks"):
            if sink is None:
                if source == "databricks":
                    raise HTTPException(503, "Databricks not configured")
            else:
                try:
                    snap = databricks_snapshot()
                except Exception as exc:
                    logging.getLogger("cloud").warning("databricks hotspots unavailable: %s", exc)
                    if source == "databricks":
                        raise HTTPException(502, f"could not read hotspots from Databricks: {exc}")
        if snap is None:
            snap = local_snapshot()
        store.save_hotspots(snap.model_dump())
        return {"source": snap.source, "count": len(snap.hotspots), "demo": snap.demo}

    @app.post("/chat", response_model=ChatResponse)
    def post_chat(req: ChatRequest) -> ChatResponse:
        return ChatResponse(reply=answer(req, chat))

    @app.post("/live-token")
    def post_live_token() -> dict:
        if live_token is None:
            raise HTTPException(503, "Gemini not configured")
        try:
            return {"token": live_token()}
        except Exception as exc:
            raise HTTPException(502, f"token mint failed: {exc}")

    @app.get("/model/latest", response_model=ModelInfo)
    def get_latest_model(request: Request) -> ModelInfo:
        info = latest_model(folder, str(request.base_url).rstrip("/"))
        if info is None:
            raise HTTPException(404, "no model published")
        return info

    @app.get("/model/files/{name}")
    def get_model_file(name: str) -> FileResponse:
        if not PATTERN.match(name) or not (folder / name).is_file():
            raise HTTPException(404, "not found")
        return FileResponse(folder / name)

    return app


def app_factory() -> FastAPI:
    return create_app()
