from lib.flatten import flatten_trip, grid_cell

TRIP = {
    "tripId": "t1", "driverId": "d1", "start": 1_000, "end": 61_000,
    "scores": {"smoothness": 82, "stopCompliance": 0.75},
    "events": [
        {"eventId": "e1", "t": 5, "kind": "rolling_stop", "lat": 43.47012, "lon": -80.54049},
        {"eventId": "e2", "t": 6, "kind": "stop_ok"},
        {"eventId": "e3", "t": 7, "kind": "crash", "lat": 43.47, "lon": -80.54},
    ],
    "features": [[1, 2], [3, 4]],
}


def test_trip_row_summarises():
    t, _, _ = flatten_trip(TRIP)
    assert t["durationS"] == 60 and t["nEvents"] == 3 and t["nBadEvents"] == 2 and t["hadCrash"] is True
    assert t["smoothness"] == 82


def test_event_rows_flag_bad_and_grid():
    _, ev, _ = flatten_trip(TRIP)
    assert [e["isBad"] for e in ev] == [True, False, True]
    assert ev[0]["gridCell"] == "43.470,-80.540"
    assert ev[1]["gridCell"] is None


def test_nearby_events_share_a_cell_far_ones_do_not():
    assert grid_cell(43.4701, -80.5402) == grid_cell(43.4704, -80.5399)
    assert grid_cell(43.4701, -80.5402) != grid_cell(43.4801, -80.5402)


def test_feature_rows_and_missing_sections():
    _, _, f = flatten_trip(TRIP)
    assert f == [
        {"tripId": "t1", "driverId": "d1", "windowIdx": 0, "features": [1.0, 2.0]},
        {"tripId": "t1", "driverId": "d1", "windowIdx": 1, "features": [3.0, 4.0]},
    ]
    t, ev, f = flatten_trip({"tripId": "x", "driverId": "d", "start": 0, "end": 0})
    assert ev == [] and f == [] and t["nEvents"] == 0 and t["smoothness"] is None
