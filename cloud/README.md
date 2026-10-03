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
