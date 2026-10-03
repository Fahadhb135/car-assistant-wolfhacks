import hashlib
import json

import numpy as np
import onnxruntime as ort
import pytest

from lib.retrain import next_version, train_and_export


def data(n=300, d=6, seed=1):
    return np.random.default_rng(seed).normal(size=(n, d))


def test_exports_runnable_versioned_onnx_with_meta(tmp_path):
    res = train_and_export(data(), tmp_path)
    assert res["version"] == 1 and (tmp_path / "model-v1.onnx").is_file()
    assert res["sha256"] == hashlib.sha256((tmp_path / "model-v1.onnx").read_bytes()).hexdigest()
    meta = json.loads((tmp_path / "model-v1.meta.json").read_text())
    assert meta["nFeatures"] == 6 and "not a validated" in meta["caveat"]
    sess = ort.InferenceSession(str(tmp_path / "model-v1.onnx"))
    out = sess.run(None, {sess.get_inputs()[0].name: data(5).astype(np.float32)})
    assert len(out) == 2


def test_flags_obvious_outliers(tmp_path):
    X = data(500)
    res = train_and_export(X, tmp_path)
    sess = ort.InferenceSession(res["path"])
    far = np.full((5, 6), 12.0, dtype=np.float32)
    labels = sess.run(None, {sess.get_inputs()[0].name: far})[0].reshape(-1)
    assert (labels == -1).all()


def test_versions_increment_and_never_overwrite(tmp_path):
    train_and_export(data(), tmp_path)
    assert train_and_export(data(seed=2), tmp_path)["version"] == 2
    assert next_version(tmp_path) == 3


@pytest.mark.parametrize(
    "bad",
    [np.zeros((10, 6)), np.array([[np.nan] * 6] * 200), np.zeros((200, 0)), np.zeros(200)],
)
def test_rejects_bad_training_data(tmp_path, bad):
    with pytest.raises(ValueError):
        train_and_export(bad, tmp_path)
    assert not list(tmp_path.glob("model-*"))
