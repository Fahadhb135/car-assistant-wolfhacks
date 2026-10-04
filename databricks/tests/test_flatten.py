from lib.flatten import flatten_trip, grid_cell, transcript_rows

TRIP = {
    "tripId": "t1", "driverId": "d1", "start": 1_000, "end": 61_000,
    "scores": {"smoothness": 82, "stopCompliance": 0.75},
    "events": [
        {"eventId": "e1", "t": 5, "kind": "rolling_stop", "lat": 43.47012, "lon": -80.54049},
        {"eventId": "e2", "t": 6, "kind": "stop_ok"},
        {"eventId": "e3", "t": 7, "kind": "crash", "confirmed": False, "lat": 43.47, "lon": -80.54},
        {"eventId": "e4", "t": 8, "kind": "hard_braking", "score": 0.8,
         "evidence": {"peakAccelerationG": 0.5, "durationMs": 300}},
    ],
    "features": [[1, 2], [3, 4]],
}


def test_trip_row_summarises():
    t, _, _ = flatten_trip(TRIP)
    assert t["durationS"] == 60 and t["nEvents"] == 4 and t["nBadEvents"] == 3
    assert t["hadCrash"] is False  # an unconfirmed motion candidate is not a confirmed crash
    assert t["smoothness"] == 82


def test_trip_row_has_distance_and_counts_speeding_separately_from_bad_events():
    trip = {**TRIP, "scores": {"smoothness": 82, "distanceM": 8046.7},
            "events": TRIP["events"] + [{"eventId": "s", "t": 9, "kind": "speeding", "speedMps": 20, "limitMps": 13}]}
    t = flatten_trip(trip)[0]
    assert t["distanceM"] == 8046.7 and t["nSpeeding"] == 1
    assert t["nBadEvents"] == 3  # unchanged: speeding is not a problem event here
    old = flatten_trip(TRIP)[0]
    assert old["distanceM"] is None and old["nSpeeding"] == 0


def test_confirmed_crash_sets_trip_flag():
    confirmed = {**TRIP, "events": [{"eventId": "c", "t": 8, "kind": "crash", "confirmed": True}]}
    assert flatten_trip(confirmed)[0]["hadCrash"] is True


def test_event_rows_flag_bad_and_grid():
    _, ev, _ = flatten_trip(TRIP)
    assert [e["isBad"] for e in ev] == [True, False, True, True]
    assert ev[0]["gridCell"] == "43.470,-80.540"
    assert ev[1]["gridCell"] is None
    assert ev[2]["confirmed"] is False
    assert ev[3]["evidenceJson"] == '{"durationMs": 300, "peakAccelerationG": 0.5}'


def test_event_rows_keep_where_the_car_was_and_the_details():
    trip = {**TRIP, "events": [{"eventId": "h", "t": 9, "kind": "highway_entering", "lat": 35.8, "lon": -78.6,
                                "speedMps": 17.0, "limitMps": 29.1, "road": "I-40",
                                "detail": {"advice": "speed_up", "targetSpeedMps": 29.1}}]}
    row = flatten_trip(trip)[1][0]
    assert (row["speedMps"], row["limitMps"], row["road"]) == (17.0, 29.1, "I-40")
    assert row["detailJson"] == '{"advice": "speed_up", "targetSpeedMps": 29.1}'
    assert row["isBad"] is False and row["gridCell"] == "35.800,-78.600"
    old = flatten_trip(TRIP)[1][1]  # older uploads without these fields still flatten
    assert old["speedMps"] is None and old["detailJson"] is None


def test_transcript_rows():
    trip = {**TRIP, "transcript": [{"t": 10, "role": "assistant", "text": "Nice full stop."},
                                   {"t": 20, "role": "driver", "text": "How was that?"}]}
    assert transcript_rows(trip) == [
        {"tripId": "t1", "driverId": "d1", "turnIdx": 0, "tMs": 10, "role": "assistant", "text": "Nice full stop."},
        {"tripId": "t1", "driverId": "d1", "turnIdx": 1, "tMs": 20, "role": "driver", "text": "How was that?"},
    ]
    assert transcript_rows(TRIP) == []


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
