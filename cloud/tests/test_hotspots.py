import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.databricks_sink import DatabricksSink
from app.hotspots import aggregate_events, distance_m, events_from_trips, grid_cell, near
from app.main import create_app

LAT, LON = 35.7832, -78.6330


def trip(tid, driver, events):
    return {"tripId": tid, "driverId": driver, "start": 1, "end": 2, "events": events}


def ev(i, kind, lat=LAT, lon=LON):
    return {"eventId": f"e{i}", "t": i, "kind": kind, "lat": lat, "lon": lon}


def test_requires_two_distinct_drivers():
    one = [trip("trip-xyz1", "driver-alpha", [ev(1, "rolling_stop"), ev(2, "rolling_stop")])]  # same driver twice
    assert aggregate_events(events_from_trips(one)) == []
    two = one + [trip("trip-xyz2", "driver-beta", [ev(3, "rolling_stop")])]
    h = aggregate_events(events_from_trips(two))
    assert len(h) == 1 and h[0]["drivers"] == 2 and h[0]["trips"] == 2 and h[0]["bad"] == 3
    leaked = json.dumps(h)
    assert not any(x in leaked for x in ("driver-alpha", "driver-beta", "trip-xyz1", "trip-xyz2"))  # no ids leak


def test_crash_and_good_events_are_not_hotspots():
    ts = [trip("t1", "a", [ev(1, "crash"), ev(2, "stop_ok")]), trip("t2", "b", [ev(3, "crash"), ev(4, "stop_ok")])]
    assert aggregate_events(events_from_trips(ts)) == []


def test_top_kind_and_tie_break_to_more_serious():
    ts = [trip("t1", "a", [ev(1, "rolling_stop"), ev(2, "ran_stop")]), trip("t2", "b", [ev(3, "rolling_stop")])]
    assert aggregate_events(events_from_trips(ts))[0]["topKind"] == "rolling_stop"
    tie = [trip("t1", "a", [ev(1, "rolling_stop")]), trip("t2", "b", [ev(2, "ran_stop")])]
    assert aggregate_events(events_from_trips(tie))[0]["topKind"] == "ran_stop"


def test_one_intersection_straddling_a_grid_border_is_still_one_hotspot():
    # 35.7845 is exactly on a 3-decimal grid boundary: these two points are ~15 m apart but in different cells
    north, south = ev(1, "rolling_stop", 35.78451, LON), ev(2, "rolling_stop", 35.78449, LON)
    assert grid_cell(north["lat"], north["lon"]) != grid_cell(south["lat"], south["lon"])
    ts = [trip("t1", "driver-a", [north]), trip("t2", "driver-b", [south])]
    h = aggregate_events(events_from_trips(ts))
    assert len(h) == 1 and h[0]["drivers"] == 2


def test_far_apart_events_are_separate_places_and_each_needs_two_drivers():
    ts = [trip("t1", "a", [ev(1, "ran_stop", LAT, LON)]), trip("t2", "b", [ev(2, "ran_stop", LAT + 0.01, LON)])]
    assert aggregate_events(events_from_trips(ts)) == []  # ~1.1 km apart: one driver each
    ts += [trip("t3", "c", [ev(3, "ran_stop", LAT, LON)])]
    h = aggregate_events(events_from_trips(ts))
    assert len(h) == 1 and h[0]["drivers"] == 2


def test_demo_flag_means_a_demo_driver_contributed_without_naming_anyone():
    mixed = [trip("t1", "demo-1", [ev(1, "ran_stop")]), trip("t2", "real-driver-77", [ev(2, "ran_stop")])]
    h = aggregate_events(events_from_trips(mixed))
    assert h[0]["demo"] is True and "real-driver-77" not in json.dumps(h)
    real = [trip("t1", "x", [ev(1, "ran_stop")]), trip("t2", "y", [ev(2, "ran_stop")])]
    assert aggregate_events(events_from_trips(real))[0]["demo"] is False


def test_results_do_not_depend_on_event_order():
    ts = [trip(f"t{i}", f"d{i}", [ev(i, "rolling_stop", LAT + i * 0.00002, LON)]) for i in range(5)]
    assert aggregate_events(events_from_trips(ts)) == aggregate_events(events_from_trips(list(reversed(ts))))


def test_events_without_a_fix_are_ignored():
    ts = [trip("t1", "a", [{"eventId": "x", "t": 1, "kind": "ran_stop"}]), trip("t2", "b", [{"eventId": "y", "t": 1, "kind": "ran_stop"}])]
    assert aggregate_events(events_from_trips(ts)) == []


def test_distance_and_near():
    assert 100 < distance_m(LAT, LON, LAT + 0.001, LON) < 120
    hs = [{"lat": LAT, "lon": LON}, {"lat": LAT + 0.1, "lon": LON}]
    assert near(hs, LAT, LON, 1000) == [hs[0]]


# ---- endpoints ----

@pytest.fixture
def client(tmp_path):
    def make(**kw):
        return TestClient(create_app(db_path=str(tmp_path / "t.db"), models_dir=tmp_path, **kw))

    return make


def seed(c, drivers=("demo-1", "demo-2", "demo-3")):
    for i, d in enumerate(drivers):
        t = trip(f"tr-{i}", d, [ev(i, "rolling_stop", LAT + i * 0.00005, LON)])
        assert c.post("/trips", json=t).status_code == 201


def test_hotspots_built_lazily_from_local_trips_and_flagged_demo(client):
    c = client()
    assert c.get("/hotspots", params={"lat": LAT, "lon": LON}).json()["hotspots"] == []
    c = client()
    seed(c)
    r = c.post("/admin/hotspots/refresh?source=local").json()
    assert r == {"source": "local", "count": 1, "demo": True}
    body = c.get("/hotspots", params={"lat": LAT, "lon": LON}).json()
    assert body["demo"] is True and body["hotspots"][0]["topKind"] == "rolling_stop"


def test_demo_flag_is_set_when_a_demo_driver_contributed(client):
    c = client()
    seed(c, drivers=("demo-1", "real-2", "demo-3"))
    assert c.post("/admin/hotspots/refresh?source=local").json()["demo"] is True  # a demo driver contributed


def test_radius_filter(client):
    c = client()
    seed(c)
    c.post("/admin/hotspots/refresh?source=local")
    assert len(c.get("/hotspots", params={"lat": LAT, "lon": LON, "radiusM": 500}).json()["hotspots"]) == 1
    assert c.get("/hotspots", params={"lat": LAT + 0.5, "lon": LON, "radiusM": 500}).json()["hotspots"] == []


PUBLISHED = {
    "generatedAt": 1, "demo": False,
    "hotspots": [{"cell": "35.783,-78.633", "lat": LAT, "lon": LON, "bad": 9, "trips": 5, "drivers": 4,
                  "byKind": {"ran_stop": 9}, "topKind": "ran_stop"}],
}


def sink(handler):
    return DatabricksSink("https://x", "tok", "/Volumes/c/s/v", httpx.Client(transport=httpx.MockTransport(handler)))


def test_refresh_reads_snapshot_published_by_databricks(client):
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        return httpx.Response(200, json=PUBLISHED)

    c = client(sink=sink(handler))
    assert c.post("/admin/hotspots/refresh").json() == {"source": "databricks", "count": 1, "demo": False}
    assert seen["url"] == "https://x/api/2.0/fs/files/Volumes/c/s/v/publish/hotspots.json"
    assert c.get("/hotspots", params={"lat": LAT, "lon": LON}).json()["source"] == "databricks"


def test_auto_falls_back_to_local_when_databricks_fails_but_explicit_does_not(client):
    c = client(sink=sink(lambda r: httpx.Response(404)))
    seed(c)
    assert c.post("/admin/hotspots/refresh").json()["source"] == "local"
    assert c.post("/admin/hotspots/refresh?source=databricks").status_code == 502


def test_malformed_databricks_snapshot_is_rejected(client):
    c = client(sink=sink(lambda r: httpx.Response(200, json={"hotspots": [{"cell": "x"}]})))
    assert c.post("/admin/hotspots/refresh?source=databricks").status_code == 502


def test_refresh_validation_and_admin_token(client, monkeypatch):
    c = client()
    assert c.post("/admin/hotspots/refresh?source=nope").status_code == 422
    assert c.post("/admin/hotspots/refresh?source=databricks").status_code == 503
    monkeypatch.setenv("ADMIN_TOKEN", "s")
    assert c.post("/admin/hotspots/refresh?source=local").status_code == 401
    assert c.post("/admin/hotspots/refresh?source=local", headers={"X-Admin-Token": "s"}).status_code == 200
