# cloud/

Post-trip FastAPI service (README sections 2, 9). Never in the live safety path.

```
cd cloud && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
GEMINI_API_KEY=... .venv/bin/uvicorn app.main:app_factory --factory --host 0.0.0.0 --port 8000
.venv/bin/python -m pytest
```

- Admin endpoints (`/admin/*`) need `X-Admin-Token: $ADMIN_TOKEN`; with no `ADMIN_TOKEN` set they only answer requests from this machine.
- Without `GEMINI_API_KEY`, reports use the deterministic template and chat answers with a fallback line.
- Publish a retrained model by copying `model-vN.onnx` into `cloud/models/` (human-gated).

Also: `POST /chat/stream` (streamed reply: one JSON line per sentence with its ElevenLabs audio, so the phone speaks sentence 1 while the rest is still being written), `POST /chat` (push-to-talk coach, plain Gemini text call, default conversation path),
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

## Parent dashboard
`/parent/*` lets a parent follow one driver: summary, per-drive trends, past drives, one drive's detail,
and a speeding report (`range=7d|30d|all`). Full endpoint list and the privacy rules are in the README (section 9).

- Linking: the driver's phone calls `POST /drivers/{id}/share-code` (6 digits, one use, 10 minutes, location
  hidden unless asked); the parent trades it at `POST /parent/link` for a bearer token scoped to that driver.
  `DELETE /drivers/{id}/viewers` revokes everyone. Tokens are stored hashed; wrong codes are rate limited per client.
- Data: Databricks publishes `publish/parent_dashboard.json` (`02_analytics`); the service caches it
  (10 min) and adds local trips it has not processed, with the same code (`app/parent.py`). Responses carry
  `source` and `generatedAt`. `POST /admin/parent/refresh` reloads the snapshot right after the notebook ran.
- Try it with the seeded story: `cloud/seed_demo.py`, then `POST /drivers/demo-maya/share-code`
  and `POST /parent/link`. Maya's smoothness climbs, her speeding alerts fall to none, and she has trip distances.
- Tests: `tests/test_parent.py` (aggregation), `tests/test_parent_api.py` (auth, scoping, location, revocation, Databricks fallback).

## Gemini models and quota (read this before demo day)
- Free-tier **standard flash (`gemini-flash-latest`) allows only 20 requests per day**; it was exhausted
  during testing. Chat and reports default to **`gemini-flash-lite-latest`** (about 0.5 s to first token),
  with the standard model as a fallback. Override with `GEMINI_MODEL` / `GEMINI_CHAT_MODEL` (comma lists).
- A quota that resets in hours is not retried: the service moves straight to the next model.
- Reports are cached per trip in SQLite, so each trip costs at most one generation. For the demo, the app
  also bundles two pre-generated reports (`fixtures/reports/`) as an offline fallback.
- Streamed chat measured against the real services: first spoken audio about 0.8 to 1.06 s after the request.
- For a safe demo, consider a paid Gemini key or confirming the lite quota the day before.
