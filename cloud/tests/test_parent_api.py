import json
import time

import pytest
from fastapi.testclient import TestClient

from app import main
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


def link(client, driver="maya", share_location=False):
    code = client.post(f"/drivers/{driver}/share-code", json={"shareLocation": share_location}).json()["code"]
    r = client.post("/parent/link", json={"code": code})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['viewerToken']}"}


def test_every_parent_endpoint_needs_a_viewer_token(make):
    c = make()
    for path in ("/parent/summary", "/parent/trends", "/parent/trips", "/parent/trips/t1", "/parent/speeding"):
        assert c.get(path).status_code == 401, path
        assert c.get(path, headers={"Authorization": "Bearer nope"}).status_code == 401, path
    assert c.get("/parent/summary", headers={"Authorization": "Basic abc"}).status_code == 401


def test_knowing_a_driver_id_is_not_enough(make):
    c = make()
    c.post("/trips", json=trip("t1"))
    assert c.get("/drivers/maya/stats").status_code == 200  # the existing driver-side endpoint is unchanged
    assert c.get("/parent/summary").status_code == 401


def test_link_code_is_single_use_and_wrong_codes_are_rejected(make):
    c = make()
    code = c.post("/drivers/maya/share-code", json={}).json()["code"]
    assert len(code) == 6 and code.isdigit()
    assert c.post("/parent/link", json={"code": code}).status_code == 200
    assert c.post("/parent/link", json={"code": code}).status_code == 404  # already used
    assert c.post("/parent/link", json={"code": "12ab56"}).status_code == 422
    assert c.post("/parent/link", json={"code": "1234"}).status_code == 422


def test_expired_code_is_rejected(make, monkeypatch):
    c = make()
    code = c.post("/drivers/maya/share-code", json={}).json()["code"]
    real = time.time
    monkeypatch.setattr(main.time, "time", lambda: real() + main.SHARE_CODE_TTL_MS / 1000 + 1)
    assert c.post("/parent/link", json={"code": code}).status_code == 404


def test_new_code_replaces_the_drivers_earlier_one(make):
    c = make()
    first = c.post("/drivers/maya/share-code", json={}).json()["code"]
    second = c.post("/drivers/maya/share-code", json={}).json()["code"]
    if first != second:
        assert c.post("/parent/link", json={"code": first}).status_code == 404
    assert c.post("/parent/link", json={"code": second}).status_code == 200


def test_guessing_codes_is_rate_limited(make):
    c = make()
    c.post("/drivers/maya/share-code", json={})
    statuses = [c.post("/parent/link", json={"code": f"{900000 + i}"}).status_code for i in range(main.LINK_ATTEMPTS + 2)]
    assert statuses[: main.LINK_ATTEMPTS] == [404] * main.LINK_ATTEMPTS
    assert statuses[-1] == 429


def test_parent_only_sees_their_own_driver(make):
    c = make()
    c.post("/trips", json=trip("maya-1", "maya"))
    c.post("/trips", json=trip("sam-1", "sam"))
    maya = link(c, "maya")
    assert c.get("/parent/summary", headers=maya).json()["trips"] == 1
    ids = [t["tripId"] for t in c.get("/parent/trips", headers=maya).json()["trips"]]
    assert ids == ["maya-1"]
    assert c.get("/parent/trips/maya-1", headers=maya).status_code == 200
    # another driver's trip looks exactly like a trip that does not exist
    assert c.get("/parent/trips/sam-1", headers=maya).status_code == 404
    assert c.get("/parent/trips/nope", headers=maya).status_code == 404


def test_location_is_hidden_unless_the_driver_opted_in(make):
    c = make()
    c.post("/trips", json=trip("t1"))
    private, shared = link(c, "maya", False), link(c, "maya", True)
    for path in ("/parent/trips/t1", "/parent/speeding", "/parent/summary", "/parent/trends", "/parent/trips"):
        assert '"lat"' not in c.get(path, headers=private).text, path
        assert '"lon"' not in c.get(path, headers=private).text, path
    assert c.get("/parent/trips/t1", headers=shared).json()["events"][0]["lat"] == 35.78
    assert c.get("/parent/speeding", headers=shared).json()["events"][0]["lat"] == 35.78


def test_dashboard_numbers_end_to_end(make):
    c = make()
    c.post("/trips", json=trip("t1", days_ago=2))
    c.post("/trips", json=trip("t2", days_ago=1))
    h = link(c)
    s = c.get("/parent/summary?range=7d", headers=h).json()
    assert (s["trips"], s["minutes"], s["distanceMiles"], s["speedingCount"], s["topIssue"]) == (2, 40, 4.0, 2, "rolling_stop")
    assert s["source"] == "local" and s["generatedAt"] > 0
    pts = c.get("/parent/trends", headers=h).json()["points"]
    assert [p["tripId"] for p in pts] == ["t1", "t2"]
    sp = c.get("/parent/speeding", headers=h).json()
    assert sp["totals"]["maxOverByMph"] == 15.0 and sp["byRoad"][0]["road"] == "Main St"
    detail = c.get("/parent/trips/t1", headers=h).json()
    assert detail["distanceMiles"] == 2.0 and "distanceM" not in detail["scores"]
    assert {e["kind"] for e in detail["events"]} == {"rolling_stop", "speeding"}
    assert detail["report"]["headline"]  # the template report, with no Gemini key


def test_bad_range_and_paging_limits(make):
    c = make()
    h = link(c)
    assert c.get("/parent/summary?range=1y", headers=h).status_code == 422
    assert c.get("/parent/trips?limit=0", headers=h).status_code == 200  # clamped, not an error


def test_trip_list_pages_with_a_cursor(make):
    c = make()
    for i in range(5):
        c.post("/trips", json=trip(f"t{i}", days_ago=10 - i))
    h = link(c)
    first = c.get("/parent/trips?limit=2", headers=h).json()
    assert [t["tripId"] for t in first["trips"]] == ["t4", "t3"]
    second = c.get(f"/parent/trips?limit=2&before={first['nextBefore']}", headers=h).json()
    assert [t["tripId"] for t in second["trips"]] == ["t2", "t1"]


def test_revoking_cuts_off_every_parent_and_unused_codes(make):
    c = make()
    h1, h2 = link(c), link(c)
    pending = c.post("/drivers/maya/share-code", json={}).json()["code"]
    assert c.delete("/drivers/maya/viewers").json() == {"revoked": 2}
    assert c.get("/parent/summary", headers=h1).status_code == 401
    assert c.get("/parent/summary", headers=h2).status_code == 401
    assert c.post("/parent/link", json={"code": pending}).status_code == 404


def test_tokens_are_stored_hashed(make, tmp_path):
    c = make()
    token = link(c)["Authorization"].split()[1]
    import sqlite3
    raw = sqlite3.connect(str(tmp_path / "t.db")).execute("SELECT token_hash FROM viewers").fetchone()[0]
    assert token not in raw and len(raw) == 64


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
    h = link(c)
    s = c.get("/parent/summary", headers=h).json()
    assert s["source"] == "databricks" and s["generatedAt"] == snapshot["generatedAt"]
    assert s["trips"] == 2 and s["speedingCount"] == 4
    assert [t["tripId"] for t in c.get("/parent/trips", headers=h).json()["trips"]] == ["fresh-1", "dbx-1"]
    assert '"lat"' not in c.get("/parent/speeding", headers=h).text


def test_databricks_down_falls_back_to_local(make):
    c = make(sink=FakeSink())  # every read raises
    c.post("/trips", json=trip("t1"))
    s = c.get("/parent/summary", headers=link(c)).json()
    assert s["source"] == "local" and s["trips"] == 1


def test_admin_refresh_reloads_the_snapshot(make):
    sink = FakeSink({"publish/parent_dashboard.json": json.dumps({"generatedAt": 1, "drivers": {}}).encode()})
    c = make(sink=sink)
    assert c.post("/admin/parent/refresh").json() == {"source": "databricks", "generatedAt": 1, "drivers": 0}
    sink.files["publish/parent_dashboard.json"] = json.dumps({"generatedAt": 2, "drivers": {"maya": {"trips": [], "speeding": []}}}).encode()
    assert c.post("/admin/parent/refresh").json() == {"source": "databricks", "generatedAt": 2, "drivers": 1}
