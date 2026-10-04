import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.databricks_reader import DatabricksReader
from app.trip_rows import local_summary
from app.main import create_app

TRIP = {
    "tripId": "t1", "driverId": "maya", "start": 1_000, "end": 601_000,
    "scores": {"smoothness": 90, "stopCompliance": 0.5},
    "events": [
        {"eventId": "e2", "t": 9_000, "kind": "rolling_stop", "lat": 35.78, "lon": -78.63, "speedMps": 2.0,
         "limitMps": 11.2, "road": "Wilmington St", "detail": {"minSpeedMps": 2.0, "featureId": 42}},
        {"eventId": "e1", "t": 5_000, "kind": "stop_ok"},
    ],
    "transcript": [{"t": 9_500, "role": "assistant", "text": "Count to three at the line."}],
}


def statement(cols, rows, state="SUCCEEDED", sid="s1"):
    return {"statement_id": sid, "status": {"state": state},
            "manifest": {"schema": {"columns": [{"name": c} for c in cols]}},
            "result": {"data_array": rows}}


class FakeDatabricks:
    """Just enough of the SQL Statement Execution and Jobs APIs."""

    def __init__(self, tables, active_runs=0, slow=False):
        self.tables, self.active_runs, self.slow = tables, active_runs, slow
        self.statements, self.run_now = [], []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/2.0/sql/warehouses":
            return httpx.Response(200, json={"warehouses": [{"id": "wh1"}]})
        if path == "/api/2.0/sql/statements" and request.method == "POST":
            body = json.loads(request.content)
            self.statements.append(body)
            table = body["statement"].split(" FROM ")[1].split()[0].split(".")[-1]
            cols, rows = self.tables[table]
            trip = next((p["value"] for p in body["parameters"] if p["name"] == "trip"), None)
            if trip is not None:
                rows = [r for r in rows if r[0] == trip or table != "trips"]
            if self.slow:
                self.pending = statement(cols, rows)
                return httpx.Response(200, json={"statement_id": "s9", "status": {"state": "PENDING"}})
            return httpx.Response(200, json=statement(cols, rows))
        if path == "/api/2.0/sql/statements/s9":
            return httpx.Response(200, json=self.pending)
        if path == "/api/2.1/jobs/list":
            return httpx.Response(200, json={"jobs": [{"job_id": 77}]})
        if path == "/api/2.1/jobs/runs/list":
            return httpx.Response(200, json={"runs": [{}] * self.active_runs})
        if path == "/api/2.1/jobs/run-now":
            self.run_now.append(json.loads(request.content))
            return httpx.Response(200, json={"run_id": 1})
        return httpx.Response(404)


TRIP_COLS = ["tripId", "driverId", "startMs", "endMs", "durationS", "smoothness", "stopCompliance", "nEvents",
             "nBadEvents", "hadCrash", "nSpeeding", "distanceM"]
EVENT_COLS = ["eventId", "tMs", "kind", "isBad", "lat", "lon", "speedMps", "limitMps", "road", "score",
              "confirmed", "detailJson"]
TABLES = {
    "trips": (TRIP_COLS, [["t1", "maya", "1000", "601000", "600", "90.0", "0.5", "2", "1", "false", "0", None]]),
    "events": (EVENT_COLS, [
        ["e1", "5000", "stop_ok", "false", None, None, None, None, None, None, None, None],
        ["e2", "9000", "rolling_stop", "true", "35.78", "-78.63", "2.0", "11.2", "Wilmington St", None, None,
         '{"featureId": 42, "minSpeedMps": 2.0}'],
    ]),
    "transcript": (["tMs", "role", "text"], [["9500", "assistant", "Count to three at the line."]]),
}


def reader(fake):
    return DatabricksReader("dbc.example.com", "tok", "/Volumes/carassistant/default/trips",
                            client=httpx.Client(transport=httpx.MockTransport(fake), base_url="https://dbc.example.com"))


def test_reader_queries_are_parameterized_and_typed():
    fake = FakeDatabricks(TABLES)
    s = reader(fake).trip_summary("t1")
    assert s == local_summary(TRIP)  # Databricks rows and the service's copy have the same shape
    first = fake.statements[0]
    assert "carassistant.default.trips" in first["statement"] and ":trip" in first["statement"]
    assert first["parameters"] == [{"name": "trip", "value": "t1", "type": "STRING"}]
    assert "t1" not in first["statement"]  # never interpolated


def test_reader_waits_for_a_starting_warehouse():
    fake = FakeDatabricks(TABLES, slow=True)
    rows = reader(fake).driver_trips("maya", 5)
    assert rows[0]["smoothness"] == 90.0 and rows[0]["hadCrash"] is False
    assert fake.statements[0]["parameters"] == [{"name": "driver", "value": "maya", "type": "STRING"}]
    assert fake.statements[0]["statement"].endswith("LIMIT 5")


def test_queue_refresh_runs_once_in_progress_plus_once_queued():
    fake = FakeDatabricks(TABLES)
    assert reader(fake).queue_refresh() == "queued"
    assert fake.run_now == [{"job_id": 77, "queue": {"enabled": True}}]
    busy = FakeDatabricks(TABLES, active_runs=2)
    assert reader(busy).queue_refresh() == "already queued" and busy.run_now == []


def test_reader_rejects_odd_volume_paths():
    with pytest.raises(ValueError):
        DatabricksReader("h", "t", "/Volumes/x; DROP TABLE/y/z")


@pytest.fixture
def make(tmp_path):
    def _make(**kw):
        return TestClient(create_app(db_path=str(tmp_path / "t.db"), models_dir=tmp_path, **kw))
    return _make


def test_summary_and_trips_come_from_databricks(make):
    c = make(reader=reader(FakeDatabricks(TABLES)))
    s = c.get("/trips/t1/summary").json()
    assert s["source"] == "databricks" and s["pending"] is False
    assert [e["kind"] for e in s["events"]] == ["stop_ok", "rolling_stop"]
    assert s["events"][1]["road"] == "Wilmington St" and s["events"][1]["detail"]["minSpeedMps"] == 2.0
    assert s["transcript"][0]["text"] == "Count to three at the line."
    t = c.get("/drivers/maya/trips").json()
    assert t["source"] == "databricks" and t["trips"][0]["tripId"] == "t1" and t["trips"][0]["pending"] is False


def test_not_yet_ingested_trip_falls_back_to_the_service_copy(make):
    empty = {k: (cols, []) for k, (cols, _) in TABLES.items()}
    c = make(reader=reader(FakeDatabricks(empty)))
    c.post("/trips", json=TRIP)
    s = c.get("/trips/t1/summary").json()
    assert s["source"] == "local" and s["pending"] is True and s["trip"]["stopCompliance"] == 0.5
    t = c.get("/drivers/maya/trips").json()
    assert t["source"] == "databricks" and t["trips"][0]["pending"] is True
    assert c.get("/trips/nope/summary").status_code == 404


def test_databricks_down_still_serves_local_trips(make):
    def down(request):
        return httpx.Response(503)
    c = make(reader=reader(down))
    c.post("/trips", json=TRIP)
    t = c.get("/drivers/maya/trips").json()
    assert t["source"] == "local" and t["error"] and t["trips"][0]["tripId"] == "t1"
    assert c.get("/trips/t1/summary").json()["source"] == "local"


def test_upload_queues_the_ingest_job(make):
    class Sink:
        def write_trip(self, trip):
            pass
    fake = FakeDatabricks(TABLES)
    make(sink=Sink(), reader=reader(fake)).post("/trips", json=TRIP)
    assert fake.run_now == [{"job_id": 77, "queue": {"enabled": True}}]
