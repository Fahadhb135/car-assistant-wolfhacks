"""The app's trip summary reads Delta rows (written by lib/flatten.py) back through the cloud's
DatabricksReader, and shows the service's own copy (local_trip) until ingest runs. Both views of a
trip must agree, or a trip would change on screen once Databricks picks it up."""
import json

from app.trip_rows import event_from_row, local_summary, transcript_from_row, trip_from_row
from lib.flatten import flatten_trip, transcript_rows

TRIP = {
    "tripId": "t1", "driverId": "d1", "start": 1_000, "end": 61_000,
    "scores": {"smoothness": 82, "stopCompliance": 0.5},
    "events": [
        {"eventId": "e1", "t": 5, "kind": "rolling_stop", "lat": 43.47, "lon": -80.54, "speedMps": 2.0,
         "limitMps": 11.1, "road": "King St", "detail": {"featureId": 7, "minSpeedMps": 2.0}},
        {"eventId": "e2", "t": 6, "kind": "crash", "confirmed": False},
        {"eventId": "e3", "t": 7, "kind": "hard_braking", "score": 0.8},
    ],
    "transcript": [{"t": 8, "role": "assistant", "text": "Nice recovery."}],
}


def as_api(row: dict) -> dict:
    """What the SQL Statement API returns: every value as a string (or None)."""
    out = {}
    for k, v in row.items():
        if v is None:
            out[k] = None
        elif isinstance(v, bool):
            out[k] = "true" if v else "false"
        else:
            out[k] = str(v)
    return out


def test_databricks_rows_read_back_exactly_like_the_service_copy():
    trip_row, event_rows, _ = flatten_trip(TRIP)
    from_databricks = {
        "trip": trip_from_row(as_api(trip_row)),
        "events": [event_from_row(as_api(e)) for e in event_rows],
        "transcript": [transcript_from_row(as_api(r)) for r in transcript_rows(TRIP)],
    }
    assert json.dumps(from_databricks, sort_keys=True) == json.dumps(local_summary(TRIP), sort_keys=True)
