from app import parent as p

NOW = 100 * p.DAY_MS


def trip(trip_id, start_days_ago, smoothness=80, compliance=None, distance_m=None, driver="d1", events=(), minutes=20):
    start = NOW - start_days_ago * p.DAY_MS
    scores = {"smoothness": smoothness}
    if compliance is not None:
        scores["stopCompliance"] = compliance
    if distance_m is not None:
        scores["distanceM"] = distance_m
    return {"tripId": trip_id, "driverId": driver, "start": start, "end": start + minutes * 60_000,
            "scores": scores, "events": [{"eventId": f"{trip_id}-{i}", "t": start + 1000 * i, **e} for i, e in enumerate(events)]}


def history(*payloads, driver="d1"):
    return p.driver_history(*p.rows_from_payloads(payloads))[driver]


SPEED = {"kind": "speeding", "speedMps": 20.1168, "limitMps": 13.4112, "road": "Main St"}  # 45 in a 30: 15 mph over


def test_summary_totals_and_distance():
    h = history(
        trip("a", 20, 70, 0.5, 8046.72, events=[{"kind": "rolling_stop"}, {"kind": "rolling_stop"}, {"kind": "hard_braking"}]),
        trip("b", 10, 80, 1.0, 1609.344, events=[SPEED, {"kind": "stop_ok"}]),
        trip("c", 1, 90, events=[]),
    )
    s = p.summary(h, "30d", NOW)
    assert s["trips"] == 3 and s["minutes"] == 60
    assert s["distanceMiles"] == 6.0  # 5 + 1 mi; the trip with no distance adds nothing
    assert s["avgSmoothness"] == 80.0 and s["firstSmoothness"] == 80.0 and s["recentSmoothness"] == 80.0
    assert s["stopCompliancePct"] == 75  # mean of 0.5 and 1.0; trip c had no judged stops
    assert s["problemEvents"] == 3 and s["speedingCount"] == 1 and s["tripsWithSpeeding"] == 1
    assert s["problemEventsPerTrip"] == {"rolling_stop": 0.7, "hard_braking": 0.3}  # speeding and stop_ok are not problems
    assert s["topIssue"] == "rolling_stop"
    assert s["lastTripAt"] == NOW - p.DAY_MS


def test_speeding_is_not_a_problem_event_but_is_counted():
    h = history(trip("a", 1, events=[SPEED, SPEED]))
    s = p.summary(h, "all", NOW)
    assert s["problemEvents"] == 0 and s["speedingCount"] == 2
    assert s["topIssue"] is None and "speeding" not in s["problemEventsPerTrip"]


def test_distance_is_none_not_zero_when_never_recorded():
    assert p.summary(history(trip("a", 1)), "all", NOW)["distanceMiles"] is None


def test_range_filters_trips_and_their_speeding():
    h = history(trip("old", 40, events=[SPEED]), trip("new", 3, events=[SPEED, SPEED]))
    assert p.summary(h, "7d", NOW)["trips"] == 1
    assert p.summary(h, "7d", NOW)["speedingCount"] == 2
    assert p.summary(h, "30d", NOW)["trips"] == 1
    assert p.summary(h, "all", NOW)["speedingCount"] == 3
    assert p.speeding_report(h, "7d", NOW)["totals"]["count"] == 2


def test_empty_history_is_all_empty_not_an_error():
    empty = {"trips": [], "speeding": []}
    s = p.summary(empty, "30d", NOW)
    assert s["trips"] == 0 and s["avgSmoothness"] is None and s["lastTripAt"] is None and s["topIssue"] is None
    assert p.trends(empty, "all", NOW) == []
    assert p.speeding_report(empty, "all", NOW)["totals"]["sharePctOfTrips"] == 0
    assert p.trip_page(empty, 10, None) == {"trips": [], "nextBefore": None}


def test_first_and_recent_smoothness_use_the_first_and_latest_three():
    h = history(*[trip(f"t{i}", 30 - i, smoothness=60 + 5 * i) for i in range(8)])
    s = p.summary(h, "all", NOW)
    assert s["firstSmoothness"] == 65.0 and s["recentSmoothness"] == 90.0


def test_trends_are_oldest_first_with_a_rolling_average():
    h = history(trip("a", 3, 60, 0.5), trip("b", 2, 70, 1.0), trip("c", 1, 80, 1.0), trip("d", 0, 100))
    pts = p.trends(h, "all", NOW)
    assert [pt["tripNumber"] for pt in pts] == [1, 2, 3, 4]
    assert [pt["smoothness3TripAvg"] for pt in pts] == [60.0, 65.0, 70.0, 83.3]
    assert pts[3]["stopCompliance"] is None


def test_trip_page_is_newest_first_and_keyset_paged():
    h = history(*[trip(f"t{i}", 10 - i) for i in range(5)])
    first = p.trip_page(h, 2, None)
    assert [t["tripId"] for t in first["trips"]] == ["t4", "t3"] and "byKind" not in first["trips"][0]
    second = p.trip_page(h, 2, first["nextBefore"])
    assert [t["tripId"] for t in second["trips"]] == ["t2", "t1"]
    last = p.trip_page(h, 2, second["nextBefore"])
    assert [t["tripId"] for t in last["trips"]] == ["t0"] and last["nextBefore"] is None


def test_speeding_report_over_by_roads_and_buckets():
    slow = {"kind": "speeding", "speedMps": 15.6464, "limitMps": 13.4112, "road": "Main St"}  # 5 mph over
    other = {"kind": "speeding", "speedMps": 29.0576, "limitMps": 24.5872}  # 10 mph over, no road name
    unknown = {"kind": "speeding", "road": "Oak Ave"}  # no speeds recorded
    h = history(trip("a", 2, events=[SPEED, slow]), trip("b", 1, events=[other, unknown]), trip("c", 0))
    r = p.speeding_report(h, "30d", NOW)
    t = r["totals"]
    assert (t["count"], t["trips"], t["tripsWithSpeeding"], t["sharePctOfTrips"]) == (4, 3, 2, 67)
    assert t["maxOverByMph"] == 15.0
    assert t["overByBuckets"] == {"5+": 3, "10+": 2, "15+": 1}  # the event without speeds is in no bucket
    assert r["byRoad"][0] == {"road": "Main St", "count": 2, "maxOverByMph": 15.0}
    assert {x["road"] for x in r["byRoad"]} == {"Main St", "Unknown road", "Oak Ave"}
    assert r["events"][0]["tripId"] == "b"  # newest first
    assert r["events"][-1]["limitMph"] == 30.0


def test_merge_prefers_databricks_rows_and_adds_newer_local_trips():
    remote = history(trip("a", 5, smoothness=71, events=[SPEED]))
    local = history(trip("a", 5, smoothness=99, events=[SPEED]), trip("b", 1, events=[SPEED]))
    merged = p.merge_histories({"d1": remote}, {"d1": local})["d1"]
    assert [t["tripId"] for t in merged["trips"]] == ["a", "b"]
    assert merged["trips"][0]["smoothness"] == 71
    assert len(merged["speeding"]) == 2  # not 3: trip a's alert is not counted twice


def test_confirmed_crash_only_counts_when_confirmed():
    h = history(trip("a", 1, events=[{"kind": "crash", "confirmed": False}]), trip("b", 0, events=[{"kind": "crash", "confirmed": True}]))
    assert [t["hadCrash"] for t in h["trips"]] == [False, True]
    assert p.summary(h, "all", NOW)["crashCandidates"] == 1


def test_strip_location_removes_lat_lon_at_any_depth():
    body = {"lat": 1, "events": [{"lat": 2, "lon": 3, "road": "Main St", "nested": {"lon": 4, "x": 5}}], "n": 1}
    assert p.strip_location(body) == {"events": [{"road": "Main St", "nested": {"x": 5}}], "n": 1}
