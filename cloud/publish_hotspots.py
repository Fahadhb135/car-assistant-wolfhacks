"""Local stand-in for the last cell of databricks/notebooks/02_analytics.py.
Reads every trip JSON from the Databricks Volume, aggregates hotspots with the same shared
function, and publishes publish/hotspots.json back to the Volume. Use it when you can't run
the notebook; the cloud's POST /admin/hotspots/refresh then reads the published file.

  cloud/.venv/bin/python cloud/publish_hotspots.py        (keys from ../.env or the environment)"""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.databricks_sink import DatabricksSink  # noqa: E402
from app.hotspots import aggregate_events, events_from_trips  # noqa: E402

env = Path(__file__).resolve().parent.parent / ".env"
if env.exists():
    for line in env.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

sink = DatabricksSink(
    os.environ["DATABRICKS_HOST"],
    os.environ["DATABRICKS_TOKEN"],
    os.environ.get("DATABRICKS_VOLUME_PATH", "/Volumes/carassistant/default/trips"),
)
trips = [json.loads(sink.read_file(f"trips/{name}")) for name in sink.list_dir("trips") if name.endswith(".json")]
hotspots = aggregate_events(events_from_trips(trips))
snapshot = {"generatedAt": int(time.time() * 1000), "demo": any(h["demo"] for h in hotspots), "hotspots": hotspots}
sink.write_file("publish/hotspots.json", json.dumps(snapshot).encode())
print(f"read {len(trips)} trips from the Volume; published {len(snapshot['hotspots'])} hotspots (demo={snapshot['demo']})")
