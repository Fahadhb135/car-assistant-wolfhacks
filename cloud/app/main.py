import json
import logging
import os
import time
from pathlib import Path
from typing import Callable, Optional

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from .chat import ChatFn, ChatRequest, ChatResponse, answer, chat_from_env
from .chat_stream import TextStream, chat_text_stream_from_env, stream_reply
from .tts import Tts
from .databricks_sink import DatabricksSink
from .hotspots import aggregate_events, events_from_trips, near
from .db import TripStore
from .model_registry import PATTERN, latest_model
from .reports import GeminiFn, gemini_from_env, make_report
from .schemas import Hotspot, HotspotSnapshot, ModelInfo, Report, Trip

CLOUD_DIR = Path(__file__).resolve().parent.parent  # defaults live under cloud/ however we're launched




def create_app(
    db_path: Optional[str] = None,
    models_dir: Optional[Path] = None,
    gemini: Optional[GeminiFn] = None,
    chat: Optional[ChatFn] = None,
    sink: Optional[DatabricksSink] = None,
    text_stream: Optional[TextStream] = None,
    tts: Optional[Tts] = None,
) -> FastAPI:
    app = FastAPI(title="Car Assistant cloud")
    store = TripStore(db_path or os.environ.get("TRIPS_DB") or str(CLOUD_DIR / "data" / "trips.db"))
    folder = models_dir or Path(os.environ.get("MODELS_DIR") or CLOUD_DIR / "models")

    key = os.environ.get("GEMINI_API_KEY")
    def model_list(var: str, default: str) -> list[str]:
        return [m.strip() for m in os.environ.get(var, default).split(",") if m.strip()]

    # Lite first: ~0.5 s to first token versus ~2 s, and the standard flash model has only a
    # 20-requests/day free quota. The standard model stays as a fallback.
    models = model_list("GEMINI_MODEL", "gemini-flash-lite-latest,gemini-flash-latest")
    chat_models = model_list("GEMINI_CHAT_MODEL", "gemini-flash-lite-latest,gemini-flash-latest")
    if gemini is None and key:
        gemini = gemini_from_env(key, models)
    if chat is None and key:
        chat = chat_from_env(key, chat_models)
    if text_stream is None and key:
        text_stream = chat_text_stream_from_env(key, chat_models)
    if tts is None and os.environ.get("ELEVENLABS_API_KEY") and os.environ.get("ELEVENLABS_VOICE_ID"):
        tts = Tts(os.environ["ELEVENLABS_API_KEY"], os.environ["ELEVENLABS_VOICE_ID"])

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

    @app.post("/chat/stream")
    async def post_chat_stream(req: ChatRequest) -> StreamingResponse:
        """Streamed coach reply: one JSON packet per sentence with its audio, so the phone can start
        speaking the first sentence while the rest is still being written."""

        async def lines():
            async for packet in stream_reply(req, text_stream, tts.synthesize if tts else None):
                yield json.dumps(packet) + "\n"

        return StreamingResponse(lines(), media_type="application/x-ndjson")

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
