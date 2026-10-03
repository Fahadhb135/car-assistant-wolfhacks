"""Live checks of every external service, against a running cloud service.
Usage: cloud/.venv/bin/python cloud/smoke.py [base_url]   (keys come from ../.env or the environment)"""
import os
import sys
import time
import uuid
from pathlib import Path

import httpx

env = Path(__file__).resolve().parent.parent / ".env"
if env.exists():
    for line in env.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
results = []


def check(name, fn):
    try:
        ok, detail = fn()
    except Exception as exc:  # report, never crash the whole run
        ok, detail = False, f"{type(exc).__name__}: {exc}"
    results.append(ok)
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")


def skip(name, why):
    print(f"[SKIP] {name}: {why}")


c = httpx.Client(timeout=30)
check("service reachable", lambda: (c.get(f"{base}/health").json() == {"ok": True}, base))

trip_id = f"smoke-{uuid.uuid4().hex[:8]}"
now = int(time.time() * 1000)
trip = {"tripId": trip_id, "driverId": "smoke", "start": now - 60_000, "end": now,
        "scores": {"smoothness": 80}, "events": [{"eventId": "e1", "t": now - 30_000, "kind": "rolling_stop", "lat": 43.47, "lon": -80.54}]}
check("trip upload", lambda: (c.post(f"{base}/trips", json=trip).status_code == 201, trip_id))

if os.environ.get("GEMINI_API_KEY"):
    def report():
        r = c.get(f"{base}/trips/{trip_id}/report").json()
        return bool(r["headline"]), r["headline"]
    check("Gemini report (check it reads like Gemini, not the template)", report)

    def chat():
        reply = c.post(f"{base}/chat", json={"message": "In one sentence, what is a rolling stop?"}).json()["reply"]
        return "can't answer" not in reply, reply
    check("Gemini chat", chat)
    check("Gemini Live token", lambda: ((r := c.post(f"{base}/live-token")).status_code == 200, f"HTTP {r.status_code} {r.text[:80]}"))
else:
    skip("Gemini report / chat / live token", "GEMINI_API_KEY not set")

if os.environ.get("DATABRICKS_HOST") and os.environ.get("DATABRICKS_TOKEN"):
    def dbx():
        r = c.post(f"{base}/admin/databricks/sync", headers={"X-Admin-Token": os.environ.get("ADMIN_TOKEN", "")}).json()
        return r["pending"] == r["synced"], f"{r} (every uploaded trip, incl. {trip_id}, should now be in the Volume)"
    check("Databricks sync", dbx)
else:
    skip("Databricks sync", "DATABRICKS_HOST / DATABRICKS_TOKEN not set")

key, voice = os.environ.get("ELEVENLABS_API_KEY"), os.environ.get("ELEVENLABS_VOICE_ID")
if key and voice:
    def eleven():
        r = c.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
                   headers={"xi-api-key": key}, json={"text": "Stop sign ahead.", "model_id": "eleven_flash_v2_5"})
        return r.status_code == 200 and len(r.content) > 1000, f"HTTP {r.status_code}, {len(r.content)} bytes"
    check("ElevenLabs TTS", eleven)
else:
    skip("ElevenLabs TTS", "ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID not set")

sys.exit(0 if all(results) else 1)
