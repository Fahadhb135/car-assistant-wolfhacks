"""Regression tests for the PR #11 review findings (cloud side)."""
import httpx
import pytest
from fastapi.testclient import TestClient

from app.databricks_sink import DatabricksSink
from app.main import create_app

LAT, LON = 35.7832, -78.6330


def trip(tid, driver, events):
    return {"tripId": tid, "driverId": driver, "start": 1, "end": 2, "events": events}


def roll(i, lat=LAT):
    return {"eventId": f"e{i}", "t": i, "kind": "rolling_stop", "lat": lat, "lon": LON}


@pytest.fixture
def app_for(tmp_path):
    def make(client_host="testclient", **kw):
        app = create_app(db_path=str(tmp_path / "t.db"), models_dir=tmp_path, **kw)
        return TestClient(app, client=(client_host, 50000))

    return make


# finding: new app event kinds made POST /trips reject the whole trip
def test_trips_with_new_event_kinds_and_extra_fields_are_accepted(app_for):
    c = app_for()
    events = [
        {"eventId": "a", "t": 1, "kind": "traffic_light_ahead", "distanceM": 140, "featureId": 9},
        {"eventId": "b", "t": 2, "kind": "highway_entering", "speedMps": 20, "advice": "speed_up"},
        {"eventId": "c", "t": 3, "kind": "hotspot_ahead", "cell": "x", "topKind": "ran_stop", "drivers": 3},
        {"eventId": "d", "t": 4, "kind": "rolling_stop", "lat": LAT, "lon": LON},
    ]
    assert c.post("/trips", json=trip("t1", "d1", events)).status_code == 201
    assert c.get("/trips/t1/report").status_code == 200  # the report still works with unknown kinds


def test_malformed_event_kinds_are_still_rejected(app_for):
    c = app_for()
    for bad in ("", "Rolling Stop", "x" * 41, "drop table;"):
        r = c.post("/trips", json=trip("t1", "d1", [{"eventId": "a", "t": 1, "kind": bad}]))
        assert r.status_code == 422, bad


# finding: the first local snapshot was saved and served forever
def test_hotspots_reflect_trips_uploaded_after_the_first_request(app_for):
    c = app_for()
    assert c.get("/hotspots", params={"lat": LAT, "lon": LON}).json()["hotspots"] == []
    c.post("/trips", json=trip("t1", "demo-1", [roll(1)]))
    c.post("/trips", json=trip("t2", "demo-2", [roll(2, LAT + 0.00005)]))
    body = c.get("/hotspots", params={"lat": LAT, "lon": LON}).json()
    assert body["source"] == "local" and len(body["hotspots"]) == 1  # no admin refresh needed


PUBLISHED = {"generatedAt": 1, "demo": False, "hotspots": [
    {"cell": "c", "lat": LAT, "lon": LON, "bad": 9, "trips": 5, "drivers": 4, "byKind": {"ran_stop": 9}, "topKind": "ran_stop"}]}


def test_a_failed_databricks_refresh_keeps_serving_the_last_good_snapshot(app_for):
    up = {"v": True}
    sink = DatabricksSink("https://x", "t", "/Volumes/c/s/v", httpx.Client(transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json=PUBLISHED) if up["v"] else httpx.Response(503))))
    c = app_for(sink=sink)
    assert c.post("/admin/hotspots/refresh").json()["source"] == "databricks"
    up["v"] = False
    r = c.post("/admin/hotspots/refresh").json()
    assert r["source"] == "databricks" and r["stale"] is True
    assert c.get("/hotspots", params={"lat": LAT, "lon": LON}).json()["hotspots"][0]["topKind"] == "ran_stop"
    # and the operator can switch back to live local data on purpose
    assert c.post("/admin/hotspots/refresh?source=local").json()["source"] == "local"
    assert c.get("/hotspots", params={"lat": LAT, "lon": LON}).json()["source"] == "local"


# finding: admin endpoints were open to the whole network when ADMIN_TOKEN was unset
def test_admin_endpoints_are_local_only_without_a_token(app_for, monkeypatch):
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    assert app_for("10.0.0.7").post("/admin/hotspots/refresh?source=local").status_code == 403
    assert app_for("127.0.0.1").post("/admin/hotspots/refresh?source=local").status_code == 200
    # non-admin endpoints stay open to the phone on the network
    assert app_for("10.0.0.7").get("/health").status_code == 200


def test_admin_endpoints_need_the_token_when_it_is_set(app_for, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "s3cret")
    remote = app_for("10.0.0.7")
    assert remote.post("/admin/hotspots/refresh?source=local").status_code == 401
    assert remote.post("/admin/hotspots/refresh?source=local", headers={"X-Admin-Token": "s3cret"}).status_code == 200
    assert app_for("127.0.0.1").post("/admin/hotspots/refresh?source=local").status_code == 401  # token beats locality
