"""Retrains the erratic-driving anomaly model and exports a versioned ONNX file.

This is a pipeline demonstration, not a validated improvement: pooled data comes from
few drivers and one car. It is human-gated: it writes files, a person decides to publish.
The feature schema must match Person B's feature spec (FEATURE_SCHEMA_VERSION)."""
import hashlib
import json
import re
from pathlib import Path

import numpy as np
from skl2onnx import to_onnx
from sklearn.ensemble import IsolationForest

FEATURE_SCHEMA_VERSION = 1
MIN_SAMPLES = 100
CAVEAT = "Pipeline demo trained on pooled drives from few drivers and one car; not a validated improvement."


def next_version(out_dir: Path) -> int:
    versions = [int(m.group(1)) for p in out_dir.glob("model-v*.onnx") if (m := re.match(r"model-v(\d+)\.onnx$", p.name))]
    return max(versions, default=0) + 1


def train_and_export(
    X: np.ndarray,
    out_dir: Path,
    contamination: float = 0.02,
    seed: int = 0,
    min_samples: int = MIN_SAMPLES,
) -> dict:
    X = np.asarray(X, dtype=np.float32)
    if X.ndim != 2 or X.shape[1] == 0:
        raise ValueError("features must be a 2-D array")
    if not np.isfinite(X).all():
        raise ValueError("features contain NaN or inf")
    if len(X) < min_samples:
        raise ValueError(f"need at least {min_samples} windows, got {len(X)}")

    model = IsolationForest(n_estimators=100, contamination=contamination, random_state=seed).fit(X)
    onnx_model = to_onnx(model, X[:1], target_opset={"": 17, "ai.onnx.ml": 3})

    out_dir.mkdir(parents=True, exist_ok=True)
    version = next_version(out_dir)
    path = out_dir / f"model-v{version}.onnx"
    path.write_bytes(onnx_model.SerializeToString())

    agreement = verify_export(path, model, X)
    if agreement < 0.99:
        path.unlink()
        raise RuntimeError(f"ONNX export disagrees with sklearn ({agreement:.3f}); not publishing")

    meta = {
        "version": version,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "nFeatures": int(X.shape[1]),
        "nSamples": int(len(X)),
        "contamination": contamination,
        "labelAgreement": agreement,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "caveat": CAVEAT,
    }
    (out_dir / f"model-v{version}.meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    return {**meta, "path": str(path)}


def verify_export(path: Path, model: IsolationForest, X: np.ndarray) -> float:
    """Fraction of windows where the ONNX label matches sklearn's (-1 anomaly, 1 normal)."""
    import onnxruntime as ort

    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    labels = sess.run(None, {sess.get_inputs()[0].name: X})[0].reshape(-1)
    return float((labels == model.predict(X)).mean())
