"""What a parent sees: a teen's past drives, score trends and speeding (README sections 4, 9).

Pure functions, shared by the Databricks analytics notebook (which publishes the result as
publish/parent_dashboard.json) and by the cloud service (which computes the same thing from its
local SQLite trips for anything Databricks has not processed yet). Both feed `driver_history` the same
flattened rows: trips (tripId, driverId, startMs, endMs, durationS, smoothness, stopCompliance,
distanceM, hadCrash) and events (tripId, driverId, tMs, kind, lat, lon, speedMps, limitMps, road).

"Problem events" keep the same meaning as the Delta tables' isBad (BAD_KINDS). Speeding is reported
separately (`speedingCount`) so adding this screen does not change anyone's existing scores. A speeding
event is a coach *alert* (one per minute at most while the car stays over the limit), not a duration."""
from collections import Counter, defaultdict
from typing import Any, Iterable, Optional

BAD_KINDS = frozenset({
    "crash", "ran_stop", "rolling_stop", "erratic_driving",
    "hard_braking", "rapid_acceleration", "harsh_cornering",
})  # keep in step with databricks/lib/flatten.py
RANGES = {"7d": 7, "30d": 30, "all": None}
DAY_MS = 86_400_000
MPS_TO_MPH = 2.2369362920544
METERS_PER_MILE = 1609.344
WINDOW = 3  # compare the first and the latest few trips, like driver_stats
SPEEDING_BUCKETS_MPH = (5, 10, 15)  # the coach warns from 5 mph over
MAX_SPEEDING_ROWS = 200


def _avg(values: list[float]) -> Optional[float]:
    return round(sum(values) / len(values), 1) if values else None


def mph(mps: Optional[float]) -> Optional[float]:
    return None if mps is None else round(mps * MPS_TO_MPH, 1)


def rows_from_payloads(payloads: Iterable[dict]) -> tuple[list[dict], list[dict]]:
    """Raw uploaded trips (the service's SQLite) -> the same rows the Delta tables hold."""
    trips, events = [], []
    for p in payloads:
        scores = p.get("scores") or {}
        evs = p.get("events") or []
        trips.append({
            "tripId": p["tripId"], "driverId": p["driverId"], "startMs": p["start"], "endMs": p["end"],
            "durationS": max(0, (p["end"] - p["start"]) // 1000),
            "smoothness": scores.get("smoothness"), "stopCompliance": scores.get("stopCompliance"),
            "distanceM": scores.get("distanceM"),
            "hadCrash": any(e["kind"] == "crash" and e.get("confirmed") is True for e in evs),
        })
        events.extend({
            "tripId": p["tripId"], "driverId": p["driverId"], "tMs": e["t"], "kind": e["kind"],
            "lat": e.get("lat"), "lon": e.get("lon"), "speedMps": e.get("speedMps"),
            "limitMps": e.get("limitMps"), "road": e.get("road"),
        } for e in evs)
    return trips, events


def driver_history(trips: Iterable[dict], events: Iterable[dict]) -> dict[str, dict]:
    """{driverId: {"trips": [per-trip summary rows, oldest first], "speeding": [speeding alerts]}}.
    This is what Databricks publishes; ranges and totals are worked out per request by the functions below."""
    by_trip: dict[str, Counter] = defaultdict(Counter)
    speeding: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        if e["kind"] in BAD_KINDS:
            by_trip[e["tripId"]][e["kind"]] += 1
        elif e["kind"] == "speeding":
            by_trip[e["tripId"]]["speeding"] += 1
            over = None
            if e.get("speedMps") is not None and e.get("limitMps") is not None:
                over = round((e["speedMps"] - e["limitMps"]) * MPS_TO_MPH, 1)
            speeding[e["driverId"]].append({
                "tripId": e["tripId"], "t": e["tMs"], "road": e.get("road"),
                "speedMph": mph(e.get("speedMps")), "limitMph": mph(e.get("limitMps")), "overByMph": over,
                "lat": e.get("lat"), "lon": e.get("lon"),
            })

    out: dict[str, dict] = {}
    for t in sorted(trips, key=lambda t: t["startMs"]):
        kinds = by_trip.get(t["tripId"], Counter())
        row = {
            "tripId": t["tripId"], "start": t["startMs"], "end": t["endMs"], "durationS": t["durationS"],
            "smoothness": t.get("smoothness"), "stopCompliance": t.get("stopCompliance"),
            "distanceM": t.get("distanceM"), "hadCrash": bool(t.get("hadCrash")),
            "nBadEvents": sum(n for k, n in kinds.items() if k in BAD_KINDS),
            "speedingCount": kinds["speeding"],
            "byKind": {k: n for k, n in sorted(kinds.items())},
        }
        out.setdefault(t["driverId"], {"trips": [], "speeding": []})["trips"].append(row)
    for driver, rows in speeding.items():
        if driver in out:
            out[driver]["speeding"] = sorted(rows, key=lambda r: r["t"])
    return out


def merge_histories(preferred: dict[str, dict], filler: dict[str, dict]) -> dict[str, dict]:
    """Databricks' view wins for trips it has; local trips it has not processed yet fill in."""
    merged: dict[str, dict] = {}
    for driver in {*preferred, *filler}:
        a = preferred.get(driver) or {"trips": [], "speeding": []}
        b = filler.get(driver) or {"trips": [], "speeding": []}
        known = {t["tripId"] for t in a["trips"]}
        extra = [t for t in b["trips"] if t["tripId"] not in known]
        extra_ids = {t["tripId"] for t in extra}
        trips = sorted(a["trips"] + extra, key=lambda t: t["start"])
        speeding = a["speeding"] + [s for s in b["speeding"] if s["tripId"] in extra_ids]
        merged[driver] = {"trips": trips, "speeding": sorted(speeding, key=lambda s: s["t"])}
    return merged


def _in_range(history: dict, range_: str, now_ms: int) -> tuple[list[dict], list[dict]]:
    days = RANGES[range_]
    since = None if days is None else now_ms - days * DAY_MS
    trips = [t for t in history["trips"] if since is None or t["start"] >= since]
    keep = {t["tripId"] for t in trips}
    return trips, [s for s in history["speeding"] if s["tripId"] in keep]


def _top_issue(per_trip: dict[str, float]) -> Optional[str]:
    issues = {k: v for k, v in per_trip.items() if k in BAD_KINDS and k != "crash"}
    return max(issues, key=lambda k: issues[k]) if issues else None


def summary(history: dict, range_: str, now_ms: int) -> dict:
    trips, speeding = _in_range(history, range_, now_ms)
    kinds: Counter = Counter()
    for t in trips:
        kinds.update(t["byKind"])
    n = len(trips)
    smooth = [t["smoothness"] for t in trips if t.get("smoothness") is not None]
    compliance = [t["stopCompliance"] for t in trips if t.get("stopCompliance") is not None]
    distance = [t["distanceM"] for t in trips if t.get("distanceM") is not None]
    per_trip = {k: round(c / n, 1) for k, c in kinds.items() if k != "speeding"} if n else {}
    return {
        "range": range_,
        "trips": n,
        "minutes": round(sum(t["durationS"] for t in trips) / 60),
        # None (not 0) when no trip in range recorded a distance, so the app can say "not recorded".
        "distanceMiles": round(sum(distance) / METERS_PER_MILE, 1) if distance else None,
        "avgSmoothness": _avg(smooth),
        "firstSmoothness": _avg(smooth[:WINDOW]),
        "recentSmoothness": _avg(smooth[-WINDOW:]),
        "stopCompliancePct": round(100 * sum(compliance) / len(compliance)) if compliance else None,
        "problemEventsPerTrip": per_trip,
        "problemEvents": sum(t["nBadEvents"] for t in trips),
        "speedingCount": len(speeding),
        "tripsWithSpeeding": sum(1 for t in trips if t["speedingCount"]),
        "crashCandidates": sum(1 for t in trips if t["hadCrash"]),
        "topIssue": _top_issue(per_trip),
        "lastTripAt": trips[-1]["start"] if trips else None,
    }


def trends(history: dict, range_: str, now_ms: int) -> list[dict]:
    """One point per trip, oldest first, for the charts (the same shape as the driver_trends table)."""
    trips, _ = _in_range(history, range_, now_ms)
    out = []
    for i, t in enumerate(trips):
        recent = [x["smoothness"] for x in trips[max(0, i - 2): i + 1] if x.get("smoothness") is not None]
        out.append({
            "tripNumber": i + 1, "tripId": t["tripId"], "startedAt": t["start"],
            "smoothness": t.get("smoothness"), "stopCompliance": t.get("stopCompliance"),
            "smoothness3TripAvg": _avg(recent), "nBadEvents": t["nBadEvents"],
        })
    return out


def trip_page(history: dict, limit: int, before: Optional[int]) -> dict:
    """Newest first, keyset-paged on the trip's start time (stable while new trips arrive)."""
    rows = [t for t in reversed(history["trips"]) if before is None or t["start"] < before]
    page = rows[:limit]
    return {
        "trips": [{k: v for k, v in t.items() if k != "byKind"} for t in page],
        "nextBefore": page[-1]["start"] if len(rows) > limit else None,
    }


def speeding_report(history: dict, range_: str, now_ms: int) -> dict:
    trips, speeding = _in_range(history, range_, now_ms)
    overs = [s["overByMph"] for s in speeding if s["overByMph"] is not None]
    by_road: dict[str, dict] = {}
    for s in speeding:
        road = s["road"] or "Unknown road"
        r = by_road.setdefault(road, {"road": road, "count": 0, "maxOverByMph": None})
        r["count"] += 1
        if s["overByMph"] is not None and (r["maxOverByMph"] is None or s["overByMph"] > r["maxOverByMph"]):
            r["maxOverByMph"] = s["overByMph"]
    with_speeding = {s["tripId"] for s in speeding}
    return {
        "range": range_,
        "totals": {
            "count": len(speeding),
            "trips": len(trips),
            "tripsWithSpeeding": len(with_speeding),
            "sharePctOfTrips": round(100 * len(with_speeding) / len(trips)) if trips else 0,
            "maxOverByMph": max(overs) if overs else None,
            "overByBuckets": {f"{b}+": sum(1 for o in overs if o >= b) for b in SPEEDING_BUCKETS_MPH},
        },
        "byRoad": sorted(by_road.values(), key=lambda r: (-r["count"], r["road"])),
        "events": sorted(speeding, key=lambda s: -s["t"])[:MAX_SPEEDING_ROWS],
    }


def strip_location(value: Any) -> Any:
    """Drop lat/lon everywhere (README privacy rule: no raw location for parents unless the driver opted in)."""
    if isinstance(value, dict):
        return {k: strip_location(v) for k, v in value.items() if k not in ("lat", "lon")}
    if isinstance(value, list):
        return [strip_location(v) for v in value]
    return value
