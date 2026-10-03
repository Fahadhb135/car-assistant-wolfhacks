# cloud/

Post-trip FastAPI service (README sections 2, 9). Never in the live safety path.

```
cd cloud && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
GEMINI_API_KEY=... .venv/bin/uvicorn app.main:app_factory --factory --host 0.0.0.0 --port 8000
.venv/bin/python -m pytest
```

- Without `GEMINI_API_KEY`, reports use the deterministic template and `/live-token` returns 503.
- Publish a retrained model by copying `model-vN.onnx` into `cloud/models/` (human-gated).
- `/live-token` is the unverified hour-1 spike; if tokens don't work on a phone, replace with a WebSocket proxy.

Also: `POST /chat` (push-to-talk coach, plain Gemini text call, default conversation path),
Databricks sync via `DATABRICKS_HOST` / `DATABRICKS_TOKEN` (see `databricks/README.md`).

## Crowd hotspots
`GET /hotspots?lat&lon&radiusM` serves places where several different drivers rolled/ran a stop or
drove erratically (at least 2 drivers, clustered within 50 m; crashes are excluded and no driver or
trip ids are exposed). The phone fetches it once at trip start.

- Source of truth: Databricks. Notebook `02_analytics` (or `cloud/publish_hotspots.py`, a local stand-in)
  writes `publish/hotspots.json` into the Volume; `POST /admin/hotspots/refresh` reads it.
  `source=auto` (default) falls back to the local SQLite trips if Databricks is unreachable.
- Demo data: `cloud/seed_demo.py --lat .. --lon ..` uploads synthetic `demo-N` drivers through the real
  upload path. Hotspots they contribute to are flagged `demo: true`.
- Replay it end to end: `npx tsx scripts/try-hotspots.mts http://localhost:8000 <lat> <lon> <heading> 500 25`
