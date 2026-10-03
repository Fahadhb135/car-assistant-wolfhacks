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


def test_databricks_host_pasted_with_path_and_query_is_reduced_to_origin():
    assert DatabricksSink("https://dbc-1.cloud.databricks.com/explore/data?o=123", "t", "/Volumes/x").host == "https://dbc-1.cloud.databricks.com"


from app.gemini_util import retry_after_seconds, worth_retrying  # noqa: E402


def test_parses_googles_retry_hint():
    assert retry_after_seconds("Please retry in 1h30m4.86s.") == 5404.86
    assert retry_after_seconds("Please retry in 34s") == 34
    assert retry_after_seconds("Please retry in 2m") == 120
    assert retry_after_seconds("no hint here") is None


def test_daily_quota_is_not_retried_but_a_short_wait_is():
    assert worth_retrying("503 UNAVAILABLE high demand")
    assert worth_retrying("429 RESOURCE_EXHAUSTED. Please retry in 3s")
    assert not worth_retrying("429 RESOURCE_EXHAUSTED. Please retry in 1h30m4.8s")  # next model instead
    assert not worth_retrying("404 NOT_FOUND no longer available")


def test_daily_quota_moves_to_the_next_model_without_sleeping():
    calls, slept = [], []

    def fn(model):
        calls.append(model)
        if model == "flash":
            raise RuntimeError("429 RESOURCE_EXHAUSTED. Please retry in 1h30m")
        return "ok"

    assert call_with_fallback(["flash", "lite"], fn, sleep=slept.append) == "ok"
    assert calls == ["flash", "lite"] and slept == []
