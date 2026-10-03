"""The notebook feeds Delta `events` rows (lib/flatten.py) into the cloud's aggregator.
These tests make sure both sides agree on cells and row shape."""
import random

from app.hotspots import aggregate_events, events_from_trips, grid_cell as cloud_cell
from lib.flatten import flatten_trip, grid_cell as notebook_cell


def test_grid_cells_agree_everywhere():
    rng = random.Random(1)
    for _ in range(500):
        lat, lon = rng.uniform(-80, 80), rng.uniform(-179, 179)
        assert cloud_cell(lat, lon) == notebook_cell(lat, lon)
    assert cloud_cell(None, 1.0) is None and notebook_cell(None, 1.0) is None


def trip(tid, driver, lat, lon):
    return {"tripId": tid, "driverId": driver, "start": 0, "end": 1000,
            "events": [{"eventId": "e1", "t": 1, "kind": "rolling_stop", "lat": lat, "lon": lon}]}


def test_notebook_rows_give_the_same_hotspots_as_cloud_rows():
    trips = [trip("t1", "demo-1", 35.7832, -78.633), trip("t2", "demo-2", 35.78321, -78.63301)]
    notebook_rows = [row for t in trips for row in flatten_trip(t)[1]]  # the Delta `events` rows
    assert aggregate_events(notebook_rows) == aggregate_events(events_from_trips(trips))
    assert len(aggregate_events(notebook_rows)) == 1
