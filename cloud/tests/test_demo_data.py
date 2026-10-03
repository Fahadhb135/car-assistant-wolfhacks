from datetime import datetime, timezone

import pytest

from app.hotspots import aggregate_events, events_from_trips
from app.schemas import Trip
from demo_data import MAYA_TRIPS, N_FEATURES, STOPS, WINDOWS_PER_TRIP, build_story

NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def story():
    return build_story(NOW)


def test_all_trips_are_valid_uploads_with_safe_unique_ids(story):
    ids = [t["tripId"] for t in story]
    assert len(ids) == len(set(ids))
    for t in story:
        Trip.model_validate(t)  # same validation the API applies


def test_everything_is_marked_fake(story):
    assert all(t["driverId"].startswith("demo-") for t in story)


def test_deterministic(story):
    assert build_story(NOW) == story


def test_maya_improves_over_the_three_weeks(story):
    maya = sorted((t for t in story if t["driverId"] == "demo-maya"), key=lambda t: t["start"])
    assert len(maya) == MAYA_TRIPS
    first, last = maya[:3], maya[-3:]
    avg = lambda ts, k: sum(t["scores"][k] for t in ts) / len(ts)
    assert avg(last, "stopCompliance") > avg(first, "stopCompliance") + 0.3
    assert avg(last, "smoothness") > avg(first, "smoothness") + 10
    span_days = (maya[-1]["start"] - maya[0]["start"]) / 86_400_000
    assert 18 <= span_days <= 21


def test_features_are_present_numeric_and_enough_to_retrain(story):
    windows = [row for t in story for row in t["features"]]
    assert len(windows) == len(story) * WINDOWS_PER_TRIP >= 100
    assert all(len(r) == N_FEATURES and all(isinstance(x, float) for x in r) for r in windows)
    assert "features" not in build_story(NOW, with_features=False)[0]


def test_privacy_rule_hides_single_driver_stops_and_shows_crowd_ones(story):
    hot = aggregate_events(events_from_trips(story))
    # B (rolling) and C (running) are shared by several drivers; A and D only have Maya's early mistakes
    assert len(hot) == 2
    by_kind = {h["topKind"] for h in hot}
    assert by_kind == {"rolling_stop", "ran_stop"}
    assert all(h["drivers"] >= 2 and h["demo"] for h in hot)
    lats = sorted(h["lat"] for h in hot)
    assert abs(lats[0] - STOPS["B"][0]) < 0.0004 and abs(lats[1] - STOPS["C"][0]) < 0.0004
