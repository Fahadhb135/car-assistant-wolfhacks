import json
import logging
import os
import time
from pathlib import Path
from typing import Callable, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from .chat import ChatFn, ChatRequest, ChatResponse, answer, chat_from_env
from .coach import CoachRequest, CoachResponse, coach_line
from .driver_stats import driver_stats, rows_from_payloads
from .chat_stream import TextStream, chat_text_stream_from_env, stream_reply
from .tts import Tts
from .databricks_reader import DatabricksReader
from .trip_rows import local_summary, local_trip
from .databricks_sink import DatabricksSink
from .hotspots import aggregate_events, events_from_trips, near
from . import parent as parent_data
from .db import TripStore
from .model_registry import PATTERN, latest_model
from .reports import GeminiFn, gemini_from_env, make_report
from .schemas import Hotspot, HotspotSnapshot, ModelInfo, Report, Trip

# Loopback addresses, plus Starlette's TestClient, which is never routable.
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}

CLOUD_DIR = Path(__file__).resolve().parent.parent  # defaults live under cloud/ however we're launched
COACHING_TTL_S = 600  # re-read Databricks' coaching context at most this often
PARENT_TTL_S = 600  # same for the parent dashboard snapshot
SHARE_CODE_TTL_MS = 10 * 60_000
LINK_ATTEMPTS = 10  # wrong share codes allowed per client per window, so a 6-digit code cannot be guessed
LINK_WINDOW_S = 600


class ShareCodeRequest(BaseModel):
    shareLocation: bool = False


class LinkRequest(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


class Viewer(BaseModel):
    driverId: str
    shareLocation: bool




def create_app(
    db_path: Optional[str] = None,
    models_dir: Optional[Path] = None,
    gemini: Optional[GeminiFn] = None,
    chat: Optional[ChatFn] = None,
    sink: Optional[DatabricksSink] = None,
    text_stream: Optional[TextStream] = None,
    tts: Optional[Tts] = None,
    reader: Optional[DatabricksReader] = None,
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
    if reader is None and os.environ.get("DATABRICKS_HOST") and os.environ.get("DATABRICKS_TOKEN"):
        reader = DatabricksReader(
            os.environ["DATABRICKS_HOST"],
            os.environ["DATABRICKS_TOKEN"],
            os.environ.get("DATABRICKS_VOLUME_PATH", "/Volumes/carassistant/default/trips"),
            warehouse_id=os.environ.get("DATABRICKS_WAREHOUSE_ID") or None,
        )
    # Queue ingest -> analytics after each upload so the dashboard sees new trips (DATABRICKS_AUTO_INGEST=0 to stop).
    auto_ingest = os.environ.get("DATABRICKS_AUTO_INGEST", "1") != "0"
    log = logging.getLogger("cloud")

    def sync_and_refresh(trip_id: str) -> None:
        if push_to_databricks(trip_id) and reader is not None and auto_ingest:
            try:
                log.info("databricks ingest for %s: %s", trip_id, reader.queue_refresh())
            except Exception:
                log.exception("could not queue the databricks ingest job")

    # Short-lived cache of Databricks reads: {key: (loaded_at, value)}.
    dash_cache: dict = {}

    def cached(key: str, ttl_s: float, load):
        hit = dash_cache.get(key)
        if hit and time.time() - hit[0] < ttl_s:
            return hit[1]
        value = load()
        dash_cache[key] = (time.time(), value)
        return value

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

    def check_admin(request: Request, token: Optional[str]) -> None:
        """With ADMIN_TOKEN set, the header must match. Without it, only this machine may call admin
        endpoints (the service binds 0.0.0.0, so anyone on the venue wifi could otherwise)."""
        expected = os.environ.get("ADMIN_TOKEN")
        if expected:
            if token != expected:
                raise HTTPException(401, "bad admin token")
            return
        host = request.client.host if request.client else ""
        if host not in LOCAL_HOSTS:
            raise HTTPException(403, "set ADMIN_TOKEN to use admin endpoints from another machine")

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

    def current_hotspots() -> list[dict]:
        snap = store.load_hotspots()
        model = HotspotSnapshot.model_validate(snap) if snap and snap.get("source") == "databricks" else local_snapshot()
        return [h.model_dump() for h in model.hotspots]

    # Driver history + risky spots for live coaching and the score screen. Databricks publishes it
    # (02_analytics -> publish/coaching_context.json); it is cached so a coaching request never waits
    # on Databricks, and the local trips fill in anything Databricks has not processed yet.
    coaching_cache: dict = {"value": None, "loaded_at": 0.0}

    def coaching_context(force: bool = False) -> dict:
        now = time.time()
        cached = coaching_cache["value"]
        if sink is not None and (force or cached is None or now - coaching_cache["loaded_at"] > COACHING_TTL_S):
            coaching_cache["loaded_at"] = now  # also throttles retries while Databricks is down
            try:
                raw = json.loads(sink.read_file("publish/coaching_context.json"))
                cached = {"source": "databricks", "generatedAt": raw.get("generatedAt"),
                          "drivers": raw.get("drivers") or {}, "riskyLocations": raw.get("riskyLocations") or []}
                coaching_cache["value"] = cached
            except Exception as exc:
                logging.getLogger("cloud").warning("databricks coaching context unavailable: %s", exc)
        local = driver_stats(*rows_from_payloads(store.all_trips()))
        if cached is None:
            return {"source": "local", "generatedAt": int(now * 1000), "drivers": local, "riskyLocations": []}
        return {**cached, "drivers": {**local, **cached["drivers"]}}

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
            background.add_task(sync_and_refresh, trip.tripId)
        return {"tripId": trip.tripId, "created": created}

    @app.get("/drivers/{driver_id}/trips")
    def get_driver_trips(driver_id: str, limit: int = 10) -> dict:
        """The driver's recent trips for the dashboard, from the Databricks `trips` table. Trips the
        service has but Databricks has not ingested yet are added with pending=true."""
        limit = max(1, min(limit, 50))
        mine = [p for p in store.all_trips() if p.get("driverId") == driver_id]
        source, error, rows = "local", None, []
        if reader is not None:
            try:
                rows = cached(f"trips:{driver_id}:{limit}", 30, lambda: reader.driver_trips(driver_id, limit))
                source = "databricks"
            except Exception as exc:
                error = str(exc)[:200]
                log.warning("databricks trips unavailable: %s", exc)
        seen = {r["tripId"] for r in rows}
        pending = [{**local_trip(p), "pending": True} for p in mine if p["tripId"] not in seen]
        trips = sorted([{**r, "pending": False} for r in rows] + pending, key=lambda t: t["start"] or 0, reverse=True)
        return {"source": source, "error": error, "trips": trips[:limit]}

    @app.get("/trips/{trip_id}/summary")
    def get_trip_summary(trip_id: str) -> dict:
        """One trip as Databricks ingested it (trip row, every event with where it happened, what the
        coach said). Falls back to the service's own copy until the ingest job has picked it up."""
        error = None
        if reader is not None:
            try:
                found = cached(f"summary:{trip_id}", 30, lambda: reader.trip_summary(trip_id))
                if found is not None:
                    dash_cache[f"summary:{trip_id}"] = (time.time() + 570, found)  # ingested: stable, keep 10 min
                    return {"source": "databricks", "pending": False, "error": None, **found}
            except Exception as exc:
                error = str(exc)[:200]
                log.warning("databricks summary unavailable: %s", exc)
        trip = store.get_trip(trip_id)
        if trip is None:
            raise HTTPException(404, "unknown trip")
        return {"source": "local", "pending": True, "error": error, **local_summary(trip.model_dump())}

    @app.post("/admin/databricks/ingest")
    def queue_ingest(request: Request, x_admin_token: Optional[str] = Header(default=None)) -> dict:
        """Queue the ingest -> analytics job now (it also runs after every upload)."""
        check_admin(request, x_admin_token)
        if reader is None:
            raise HTTPException(503, "Databricks not configured")
        return {"status": reader.queue_refresh()}

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
    def sync_databricks(request: Request, x_admin_token: Optional[str] = Header(default=None)) -> dict:
        """Retry trips that failed to reach Databricks (e.g. venue wifi was down)."""
        check_admin(request, x_admin_token)
        if sink is None:
            raise HTTPException(503, "Databricks not configured")
        ids = store.unsynced_ids()
        done = sum(1 for i in ids if push_to_databricks(i))
        return {"pending": len(ids), "synced": done}

    @app.get("/hotspots", response_model=HotspotSnapshot)
    def get_hotspots(lat: float, lon: float, radiusM: float = 5000) -> HotspotSnapshot:
        """Crowd hotspots near a point. Phones fetch this once at trip start. Serves the snapshot
        Databricks published, if any; otherwise computes from the local trips on every request, so
        new uploads count immediately and nothing is frozen."""
        snap = store.load_hotspots()
        snap_model = HotspotSnapshot.model_validate(snap) if snap and snap.get("source") == "databricks" else local_snapshot()
        radius = max(100.0, min(radiusM, 50_000.0))
        keep = near([h.model_dump() for h in snap_model.hotspots], lat, lon, radius)
        return snap_model.model_copy(update={"hotspots": [Hotspot(**h) for h in keep]})

    @app.post("/admin/hotspots/refresh")
    def refresh_hotspots(request: Request, source: str = "auto", x_admin_token: Optional[str] = Header(default=None)) -> dict:
        """Pull the latest snapshot Databricks published (auto, if configured), or switch back to
        computing hotspots from local trips (source=local). If Databricks is unreachable, the last
        good Databricks snapshot keeps being served."""
        check_admin(request, x_admin_token)
        if source not in ("auto", "databricks", "local"):
            raise HTTPException(422, "source must be auto, databricks or local")
        if source == "local":
            store.clear_hotspots()
            snap = local_snapshot()
            return {"source": snap.source, "count": len(snap.hotspots), "demo": snap.demo}
        if sink is None:
            if source == "databricks":
                raise HTTPException(503, "Databricks not configured")
            snap = local_snapshot()
            return {"source": snap.source, "count": len(snap.hotspots), "demo": snap.demo}
        try:
            snap = databricks_snapshot()
        except Exception as exc:
            logging.getLogger("cloud").warning("databricks hotspots unavailable: %s", exc)
            if source == "databricks":
                raise HTTPException(502, f"could not read hotspots from Databricks: {exc}")
            previous = store.load_hotspots()
            snap = HotspotSnapshot.model_validate(previous) if previous and previous.get("source") == "databricks" else local_snapshot()
            return {"source": snap.source, "count": len(snap.hotspots), "demo": snap.demo, "stale": True}
        store.save_hotspots(snap.model_dump())
        return {"source": snap.source, "count": len(snap.hotspots), "demo": snap.demo}

    # --- Parent dashboard. Aggregates come from Databricks (cached snapshot); the local trips fill in
    # anything it has not processed yet, so the list is current the moment a drive is uploaded.
    parent_cache: dict = {"value": None, "loaded_at": 0.0}
    link_failures: dict[str, list[float]] = {}

    def parent_histories(force: bool = False) -> tuple[str, Optional[int], dict[str, dict]]:
        now = time.time()
        cached = parent_cache["value"]
        if sink is not None and (force or cached is None or now - parent_cache["loaded_at"] > PARENT_TTL_S):
            parent_cache["loaded_at"] = now  # also throttles retries while Databricks is down
            try:
                raw = json.loads(sink.read_file("publish/parent_dashboard.json"))
                cached = {"generatedAt": raw.get("generatedAt"), "drivers": raw.get("drivers") or {}}
                parent_cache["value"] = cached
            except Exception as exc:
                logging.getLogger("cloud").warning("databricks parent dashboard unavailable: %s", exc)
        if cached is None:
            return "local", None, {}
        return "databricks", cached["generatedAt"], cached["drivers"]

    def driver_view(viewer: Viewer) -> tuple[dict, str, Optional[int]]:
        """(history, source, generatedAt) for one driver: Databricks' rows plus any newer local trips."""
        local = parent_data.driver_history(*parent_data.rows_from_payloads(store.trips_for_driver(viewer.driverId)))
        source, generated, remote = parent_histories()
        empty = {"trips": [], "speeding": []}
        merged = parent_data.merge_histories({viewer.driverId: remote.get(viewer.driverId, empty)},
                                             {viewer.driverId: local.get(viewer.driverId, empty)})
        return merged[viewer.driverId], source, generated

    def current_viewer(authorization: Optional[str] = Header(default=None)) -> Viewer:
        scheme, _, token = (authorization or "").partition(" ")
        found = store.get_viewer(token) if scheme.lower() == "bearer" and token else None
        if found is None:
            raise HTTPException(401, "link this phone to a driver first")
        return Viewer(driverId=found[0], shareLocation=found[1])

    def parent_response(viewer: Viewer, body: dict, source: str, generated: Optional[int]) -> dict:
        body = {**body, "source": source, "generatedAt": generated or int(time.time() * 1000)}
        return body if viewer.shareLocation else parent_data.strip_location(body)

    def check_range(range_: str) -> str:
        if range_ not in parent_data.RANGES:
            raise HTTPException(422, "range must be 7d, 30d or all")
        return range_

    @app.post("/drivers/{driver_id}/share-code")
    def create_share_code(driver_id: str, req: ShareCodeRequest) -> dict:
        """The driver shows this code to a parent (10 minutes, one use). Location stays hidden from the
        parent unless the driver turns it on here."""
        code, expires = store.create_share_code(driver_id, req.shareLocation, int(time.time() * 1000), SHARE_CODE_TTL_MS)
        return {"code": code, "expiresAt": expires, "shareLocation": req.shareLocation}

    @app.post("/parent/link")
    def parent_link(req: LinkRequest, request: Request) -> dict:
        host = request.client.host if request.client else "?"
        now = time.time()
        recent = [t for t in link_failures.get(host, []) if now - t < LINK_WINDOW_S]
        if len(recent) >= LINK_ATTEMPTS:
            raise HTTPException(429, "too many wrong codes, try again in a few minutes")
        redeemed = store.redeem_share_code(req.code, int(now * 1000))
        if redeemed is None:
            link_failures[host] = recent + [now]
            raise HTTPException(404, "that code is wrong or has expired")
        driver_id, share_location = redeemed
        token = store.add_viewer(driver_id, share_location, int(now * 1000))
        return {"viewerToken": token, "driverId": driver_id, "shareLocation": share_location}

    @app.delete("/drivers/{driver_id}/viewers")
    def revoke_viewers(driver_id: str) -> dict:
        return {"revoked": store.revoke_viewers(driver_id)}

    @app.get("/parent/summary")
    def parent_summary(range: str = "30d", viewer: Viewer = Depends(current_viewer)) -> dict:
        history, source, generated = driver_view(viewer)
        body = parent_data.summary(history, check_range(range), int(time.time() * 1000))
        return parent_response(viewer, body, source, generated)

    @app.get("/parent/trends")
    def parent_trends(range: str = "30d", viewer: Viewer = Depends(current_viewer)) -> dict:
        history, source, generated = driver_view(viewer)
        points = parent_data.trends(history, check_range(range), int(time.time() * 1000))
        return parent_response(viewer, {"range": range, "points": points}, source, generated)

    @app.get("/parent/trips")
    def parent_trips(limit: int = 20, before: Optional[int] = None, viewer: Viewer = Depends(current_viewer)) -> dict:
        history, source, generated = driver_view(viewer)
        body = parent_data.trip_page(history, max(1, min(limit, 100)), before)
        return parent_response(viewer, body, source, generated)

    @app.get("/parent/trips/{trip_id}")
    def parent_trip(trip_id: str, viewer: Viewer = Depends(current_viewer)) -> dict:
        trip = store.get_trip(trip_id)
        if trip is None or trip.driverId != viewer.driverId:  # someone else's trip looks the same as none
            raise HTTPException(404, "unknown trip")
        report = store.get_report(trip_id)
        if report is None:
            report = make_report(trip, gemini)
            store.save_report(trip_id, report)
        distance = trip.scores.get("distanceM")
        shown = parent_data.BAD_KINDS | {"speeding", "stop_ok"}
        body = {
            "tripId": trip.tripId, "start": trip.start, "end": trip.end,
            "durationS": max(0, (trip.end - trip.start) // 1000),
            "scores": {k: v for k, v in trip.scores.items() if k != "distanceM"},
            "distanceMiles": round(distance / parent_data.METERS_PER_MILE, 1) if distance else None,
            "events": [
                {"eventId": e.eventId, "t": e.t, "kind": e.kind, "road": e.road,
                 "speedMph": parent_data.mph(e.speedMps), "limitMph": parent_data.mph(e.limitMps),
                 "lat": e.lat, "lon": e.lon, "confirmed": e.confirmed}
                for e in trip.events if e.kind in shown
            ],
            "report": report.model_dump(),
        }
        return parent_response(viewer, body, "local", None)

    @app.get("/parent/speeding")
    def parent_speeding(range: str = "30d", viewer: Viewer = Depends(current_viewer)) -> dict:
        history, source, generated = driver_view(viewer)
        body = parent_data.speeding_report(history, check_range(range), int(time.time() * 1000))
        return parent_response(viewer, body, source, generated)

    @app.post("/admin/parent/refresh")
    def refresh_parent(request: Request, x_admin_token: Optional[str] = Header(default=None)) -> dict:
        """Re-read the dashboard snapshot Databricks published, e.g. right after 02_analytics ran."""
        check_admin(request, x_admin_token)
        source, generated, drivers = parent_histories(force=True)
        return {"source": source, "generatedAt": generated, "drivers": len(drivers)}

    @app.post("/chat", response_model=ChatResponse)
    def post_chat(req: ChatRequest) -> ChatResponse:
        return ChatResponse(reply=answer(req, chat))

    @app.post("/coach", response_model=CoachResponse)
    def post_coach(req: CoachRequest) -> CoachResponse:
        """One live coaching line for a notable moment: the phone's live context plus the driver's
        history and the crowd data around that spot, written by Gemini as text for the phone's voice."""
        ctx = coaching_context()
        stats = ctx["drivers"].get(req.driverId)
        return CoachResponse(text=coach_line(req, chat, stats, current_hotspots(), ctx["riskyLocations"]))

    @app.get("/drivers/{driver_id}/stats")
    def get_driver_stats(driver_id: str) -> dict:
        """The driver's history for the score screen (Databricks, with local trips filling gaps)."""
        ctx = coaching_context()
        return {"source": ctx["source"], "generatedAt": ctx["generatedAt"], "stats": ctx["drivers"].get(driver_id)}

    @app.post("/admin/coaching/refresh")
    def refresh_coaching(request: Request, x_admin_token: Optional[str] = Header(default=None)) -> dict:
        """Re-read the coaching context Databricks published, e.g. right after 02_analytics ran."""
        check_admin(request, x_admin_token)
        ctx = coaching_context(force=True)
        return {"source": ctx["source"], "drivers": len(ctx["drivers"]), "riskyLocations": len(ctx["riskyLocations"])}

    @app.post("/chat/stream")
    async def post_chat_stream(req: ChatRequest) -> StreamingResponse:
        """Streamed coach reply: one JSON packet per sentence with its audio, so the phone can start
        speaking the first sentence while the rest is still being written."""

        async def lines():
            async for packet in stream_reply(req, text_stream, tts.synthesize if tts else None):
                yield json.dumps(packet) + "\n"

        return StreamingResponse(lines(), media_type="application/x-ndjson")

    class TtsRequest(BaseModel):
        text: str = Field(min_length=1, max_length=500)

    @app.post("/tts")
    async def post_tts(req: TtsRequest) -> Response:
        """ElevenLabs speech for text the phone has no bundled clip for, so it keeps one voice.
        503 when ElevenLabs is not configured or fails; the phone then uses its own voice."""
        audio = await tts.synthesize(req.text) if tts else None
        if not audio:
            raise HTTPException(503, "speech unavailable")
        return Response(content=audio, media_type="audio/mpeg")

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
