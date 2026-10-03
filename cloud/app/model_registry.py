"""Serves the newest `model-vN.onnx` in the models folder. A person copies a retrained
model here by hand: nothing auto-publishes (human-gated, per the design)."""
import hashlib
import re
from pathlib import Path
from typing import Optional

from .schemas import ModelInfo

PATTERN = re.compile(r"^model-v(\d+)\.onnx$")


def latest_model(folder: Path, base_url: str, feature_schema_version: int = 1) -> Optional[ModelInfo]:
    best: Optional[tuple[int, Path]] = None
    for p in folder.glob("model-v*.onnx"):
        m = PATTERN.match(p.name)
        if m and (best is None or int(m.group(1)) > best[0]):
            best = (int(m.group(1)), p)
    if best is None:
        return None
    version, path = best
    return ModelInfo(
        version=version,
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        url=f"{base_url}/model/files/{path.name}",
        featureSchemaVersion=feature_schema_version,
    )
