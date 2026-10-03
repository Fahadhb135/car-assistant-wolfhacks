import pytest

from app.gemini_util import call_with_fallback
from app.databricks_sink import DatabricksSink


def test_retries_transient_then_succeeds():
    calls = []

    def fn(model):
        calls.append(model)
        if len(calls) == 1:
            raise RuntimeError("503 UNAVAILABLE high demand")
        return "ok"

    assert call_with_fallback(["a", "b"], fn, sleep=lambda s: None) == "ok"
    assert calls == ["a", "a"]


def test_retired_model_moves_to_next_immediately():
    calls = []

    def fn(model):
        calls.append(model)
        if model == "old":
            raise RuntimeError("404 NOT_FOUND no longer available")
        return "ok"

    assert call_with_fallback(["old", "new"], fn, sleep=lambda s: None) == "ok"
    assert calls == ["old", "new"]


def test_exhausted_raises_last_error():
    def fn(model):
        raise RuntimeError("503 UNAVAILABLE")

    with pytest.raises(RuntimeError):
        call_with_fallback(["a", "b"], fn, sleep=lambda s: None)


def test_databricks_host_without_scheme_is_normalised():
    assert DatabricksSink("dbc-1.cloud.databricks.com/", "t", "/Volumes/x").host == "https://dbc-1.cloud.databricks.com"
    assert DatabricksSink("https://h.com", "t", "/Volumes/x").host == "https://h.com"
