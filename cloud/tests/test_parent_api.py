import json
import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

NOW_MS = int(time.time() * 1000)
SPEEDING = {"eventId": "s1", "kind": "speeding", "speedMps": 20.1168, "limitMps": 13.4112,
            "road": "Main St", "lat": 35.78, "lon": -78.63}


def trip(trip_id, driver="maya", days_ago=1, **extra):
    start = NOW_MS - days_ago * 86_400_000
    return {"tripId": trip_id, "driverId": driver, "start": start, "end": start + 1_200_000,
            "scores": {"smoothness": 85, "stopCompliance": 0.5, "distanceM": 3218.688},
            "events": [{"eventId": "e1", "t": start + 5, "kind": "rolling_stop", "lat": 35.78, "lon": -78.63}, SPEEDING | {"t": start + 9}],
            **extra}


class FakeSink:
    def __init__(self, files=None):
        self.files = files or {}

    def read_file(self, rel):
        if rel not in self.files:
            raise OSError("no such file")
        return self.files[rel]


@pytest.fixture
def make(tmp_path):
    def _make(**kw):
        return TestClient(create_app(db_path=str(tmp_path / "t.db"), models_dir=tmp_path, **kw))
    return _make


def test_a_driver_with_no_trips_gets_empty_answers_not_errors(make):
    c = make()
    s = c.get("/drivers/new/summary").json()
    assert s["trips"] == 0 and s["avgSmoothness"] is None and s["source"] == "local"
    assert c.get("/drivers/new/trips").json()["trips"] == []
    assert c.get("/drivers/new/trends").json()["points"] == []
    assert c.get("/drivers/new/speeding").json()["totals"]["count"] == 0


def test_only_that_drivers_trips_are_counted(make):
    c = make()
    c.post("/trips", json=trip("maya-1", "maya"))
    c.post("/trips", json=trip("sam-1", "sam"))
    assert c.get("/drivers/maya/summary").json()["trips"] == 1
    assert [t["tripId"] for t in c.get("/drivers/maya/trips").json()["trips"]] == ["maya-1"]
    assert c.get("/drivers/maya/trips/maya-1").status_code == 200
    # another driver's trip looks exactly like a trip that does not exist
    assert c.get("/drivers/maya/trips/sam-1").status_code == 404
    assert c.get("/drivers/maya/trips/nope").status_code == 404


def test_gps_positions_are_never_returned(make):
    c = make()
    c.post("/trips", json=trip("t1"))
    for path in ("/drivers/maya/trips/t1", "/drivers/maya/speeding", "/drivers/maya/summary",
                 "/drivers/maya/trends", "/drivers/maya/trips"):
        text = c.get(path).text
        assert '"lat"' not in text and '"lon"' not in text, path


def test_dashboard_numbers_end_to_end(make):
    c = make()
    c.post("/trips", json=trip("t1", days_ago=2))
    c.post("/trips", json=trip("t2", days_ago=1))
    s = c.get("/drivers/maya/summary?range=7d").json()
    assert (s["trips"], s["minutes"], s["distanceMiles"], s["speedingCount"], s["topIssue"]) == (2, 40, 4.0, 2, "rolling_stop")
    assert s["source"] == "local" and s["generatedAt"] > 0
    assert [p["tripId"] for p in c.get("/drivers/maya/trends").json()["points"]] == ["t1", "t2"]
    sp = c.get("/drivers/maya/speeding").json()
    assert sp["totals"]["maxOverByMph"] == 15.0 and sp["byRoad"][0]["road"] == "Main St"
    detail = c.get("/drivers/maya/trips/t1").json()
    assert detail["distanceMiles"] == 2.0 and "distanceM" not in detail["scores"]
    assert {e["kind"] for e in detail["events"]} == {"rolling_stop", "speeding"}
    assert detail["report"]["headline"]  # the template report, with no Gemini key


def test_a_new_upload_shows_up_straight_away_as_the_last_drive(make):
    c = make()
    assert c.get("/drivers/maya/trips?limit=1").json()["trips"] == []
    c.post("/trips", json=trip("older", days_ago=3))
    c.post("/trips", json=trip("latest", days_ago=0))
    last = c.get("/drivers/maya/trips?limit=1").json()["trips"]
    assert [t["tripId"] for t in last] == ["latest"]
    assert last[0]["smoothness"] == 85 and last[0]["distanceM"] == 3218.688


def test_bad_range_and_paging_limits(make):
    c = make()
    assert c.get("/drivers/maya/summary?range=1y").status_code == 422
    assert c.get("/drivers/maya/trips?limit=0").status_code == 200  # clamped, not an error


def test_trip_list_pages_with_a_cursor(make):
    c = make()
    for i in range(5):
        c.post("/trips", json=trip(f"t{i}", days_ago=10 - i))
    first = c.get("/drivers/maya/trips?limit=2").json()
    assert [t["tripId"] for t in first["trips"]] == ["t4", "t3"]
    second = c.get(f"/drivers/maya/trips?limit=2&before={first['nextBefore']}").json()
    assert [t["tripId"] for t in second["trips"]] == ["t2", "t1"]


def test_databricks_snapshot_is_used_and_local_trips_fill_the_gap(make):
    # Databricks has processed one older trip (and counts 3 speeding alerts for it); the app just uploaded another.
    old = NOW_MS - 5 * 86_400_000
    snapshot = {"generatedAt": NOW_MS - 3_600_000, "drivers": {"maya": {
        "trips": [{"tripId": "dbx-1", "start": old, "end": old + 600_000, "durationS": 600, "smoothness": 70,
                   "stopCompliance": None, "distanceM": None, "hadCrash": False, "nBadEvents": 0,
                   "speedingCount": 3, "byKind": {"speeding": 3}}],
        "speeding": [{"tripId": "dbx-1", "t": old + i, "road": "Oak Ave", "speedMph": 40.0, "limitMph": 30.0,
                      "overByMph": 10.0, "lat": 1.0, "lon": 2.0} for i in range(3)],
    }}}
    sink = FakeSink({"publish/parent_dashboard.json": json.dumps(snapshot).encode()})
    c = make(sink=sink)
    c.post("/trips", json=trip("fresh-1"))
    s = c.get("/drivers/maya/summary").json()
    assert s["source"] == "databricks" and s["generatedAt"] == snapshot["generatedAt"]
    assert s["trips"] == 2 and s["speedingCount"] == 4
    assert [t["tripId"] for t in c.get("/drivers/maya/trips").json()["trips"]] == ["fresh-1", "dbx-1"]
    assert '"lat"' not in c.get("/drivers/maya/speeding").text


def test_databricks_down_falls_back_to_local(make):
    c = make(sink=FakeSink())  # every read raises
    c.post("/trips", json=trip("t1"))
    s = c.get("/drivers/maya/summary").json()
    assert s["source"] == "local" and s["trips"] == 1


def test_admin_refresh_reloads_the_snapshot(make):
    sink = FakeSink({"publish/parent_dashboard.json": json.dumps({"generatedAt": 1, "drivers": {}}).encode()})
    c = make(sink=sink)
    assert c.post("/admin/dashboard/refresh").json() == {"source": "databricks", "generatedAt": 1, "drivers": 0}
    sink.files["publish/parent_dashboard.json"] = json.dumps({"generatedAt": 2, "drivers": {"maya": {"trips": [], "speeding": []}}}).encode()
    assert c.post("/admin/dashboard/refresh").json() == {"source": "databricks", "generatedAt": 2, "drivers": 1}


def test_the_pairing_endpoints_are_gone(make):
    c = make()
    assert c.post("/drivers/maya/share-code", json={}).status_code in (404, 405)
    assert c.post("/parent/link", json={"code": "123456"}).status_code == 404
    assert c.delete("/drivers/maya/viewers").status_code in (404, 405)
