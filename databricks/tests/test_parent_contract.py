"""The Delta rows (lib/flatten.py) and the service's local rows (cloud/app/parent.py) must give the same
parent dashboard, because the service merges the two and the notebook claims they cannot disagree."""
import json

from app import parent
from lib.flatten import flatten_trip

TRIPS = [
    {"tripId": "t1", "driverId": "d1", "start": 1_000, "end": 1_201_000,
     "scores": {"smoothness": 80, "stopCompliance": 0.5, "distanceM": 3218.688},
     "events": [
         {"eventId": "e1", "t": 5, "kind": "rolling_stop", "lat": 35.78, "lon": -78.63},
         {"eventId": "e2", "t": 6, "kind": "speeding", "speedMps": 20.1168, "limitMps": 13.4112, "road": "Main St", "lat": 35.78, "lon": -78.63},
         {"eventId": "e3", "t": 7, "kind": "crash", "confirmed": True},
     ]},
    {"tripId": "t2", "driverId": "d1", "start": 2_000_000, "end": 2_600_000, "scores": {"smoothness": 90}, "events": []},
    {"tripId": "t3", "driverId": "d2", "start": 3_000_000, "end": 3_060_000, "scores": {}, "events": [{"eventId": "e1", "t": 1, "kind": "speeding"}]},
]


def from_delta_rows():
    flat = [flatten_trip(t) for t in TRIPS]
    return parent.driver_history([t for t, _, _ in flat], [e for _, evs, _ in flat for e in evs])


def test_delta_and_local_paths_agree():
    assert from_delta_rows() == parent.driver_history(*parent.rows_from_payloads(TRIPS))


def test_the_published_file_survives_json_and_keeps_the_shape_the_service_reads():
    published = json.loads(json.dumps({"generatedAt": 1, "drivers": from_delta_rows()}, default=float))
    d1 = published["drivers"]["d1"]
    assert [t["tripId"] for t in d1["trips"]] == ["t1", "t2"]
    assert d1["trips"][0]["speedingCount"] == 1 and d1["trips"][0]["hadCrash"] is True
    assert d1["speeding"][0]["overByMph"] == 15.0
    assert parent.summary(d1, "all", 10**10)["speedingCount"] == 1
