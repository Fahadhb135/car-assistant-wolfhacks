"""Publish the newest retrained model: download model-vN.onnx from the Databricks Volume, verify its
sha256 against the metadata the retraining notebook wrote, and put it in cloud/models/ where
GET /model/latest serves it. This is the human gate: nothing is published until someone runs this.

  cloud/.venv/bin/python cloud/fetch_model.py        (keys from ../.env or the environment)"""
import hashlib
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.databricks_sink import DatabricksSink  # noqa: E402

env = Path(__file__).resolve().parent.parent / ".env"
if env.exists():
    for line in env.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

# models live in a sibling Volume of the trips Volume (notebook 03 writes /Volumes/<cat>/<schema>/models)
trips_path = os.environ.get("DATABRICKS_VOLUME_PATH", "/Volumes/carassistant/default/trips")
sink = DatabricksSink(os.environ["DATABRICKS_HOST"], os.environ["DATABRICKS_TOKEN"], trips_path.rsplit("/", 1)[0] + "/models")
dest = Path(os.environ.get("MODELS_DIR") or Path(__file__).resolve().parent / "models")

versions = sorted(int(m.group(1)) for n in sink.list_dir("") if (m := re.match(r"model-v(\d+)\.onnx$", n)))
if not versions:
    sys.exit("no model-vN.onnx in the models Volume yet: run notebook 03_retrain")
v = versions[-1]
meta = json.loads(sink.read_file(f"model-v{v}.meta.json"))
blob = sink.read_file(f"model-v{v}.onnx")
digest = hashlib.sha256(blob).hexdigest()
if digest != meta["sha256"]:
    sys.exit(f"checksum mismatch for v{v}: refusing to publish")
dest.mkdir(parents=True, exist_ok=True)
(dest / f"model-v{v}.onnx").write_bytes(blob)
print(f"published model v{v} ({len(blob)} bytes, {meta['nSamples']} training windows, "
      f"featureSchemaVersion {meta['featureSchemaVersion']}) -> {dest}")
print("note:", meta["caveat"])
