"""Per-driver history for live coaching ("rolling stops are down from 3 per trip to 1").

Shared by the Databricks analytics notebook, which publishes it as publish/coaching_context.json,
and by the cloud service, which computes the same thing from its local trips when Databricks is
unreachable. Inputs are the flattened rows of the Delta tables (trips: driverId, tripId, startMs,
smoothness; events: tripId, kind), so both callers feed it the same shape."""
from collections import Counter, defaultdict
from typing import Iterable, Optional

# Kinds a coach can usefully track as habits (crashes are never coaching material).
HABIT_KINDS = ("rolling_stop", "ran_stop", "hard_braking", "rapid_acceleration", "harsh_cornering",
               "erratic_driving", "speeding", "stop_ok")
WINDOW = 3  # compare the first and the latest few trips


def _avg(values: list[float]) -> Optional[float]:
    return round(sum(values) / len(values), 1) if values else None


def driver_stats(trips: Iterable[dict], events: Iterable[dict]) -> dict[str, dict]:
    """{driverId: {trips, avgSmoothness, firstSmoothness, recentSmoothness, perTripFirst,
    perTripRecent, topIssue}}. Per-trip rates use the first and latest WINDOW trips."""
    by_trip: dict[str, Counter] = defaultdict(Counter)
    for e in events:
        if e.get("kind") in HABIT_KINDS:
            by_trip[e["tripId"]][e["kind"]] += 1

    by_driver: dict[str, list[dict]] = defaultdict(list)
    for t in trips:
        by_driver[t["driverId"]].append(t)

    out: dict[str, dict] = {}
    for driver, ts in by_driver.items():
        ts = sorted(ts, key=lambda t: t["startMs"])
        first, recent = ts[:WINDOW], ts[-WINDOW:]

        def rate(group: list[dict]) -> dict[str, float]:
            total: Counter = Counter()
            for t in group:
                total.update(by_trip.get(t["tripId"], Counter()))
            return {k: round(total[k] / len(group), 1) for k in HABIT_KINDS if total[k]}

        smooth = [t["smoothness"] for t in ts if t.get("smoothness") is not None]
        recent_rate = rate(recent)
        issues = {k: v for k, v in recent_rate.items() if k != "stop_ok"}
        out[driver] = {
            "trips": len(ts),
            "avgSmoothness": _avg(smooth),
            "firstSmoothness": _avg([t["smoothness"] for t in first if t.get("smoothness") is not None]),
            "recentSmoothness": _avg([t["smoothness"] for t in recent if t.get("smoothness") is not None]),
            "perTripFirst": rate(first),
            "perTripRecent": recent_rate,
            "topIssue": max(issues, key=issues.get) if issues else None,
        }
    return out


def rows_from_payloads(payloads: Iterable[dict]) -> tuple[list[dict], list[dict]]:
    """Raw uploaded trips (the service's SQLite) -> the same rows the Delta tables hold."""
    trips, events = [], []
    for p in payloads:
        trips.append({"driverId": p["driverId"], "tripId": p["tripId"], "startMs": p["start"],
                      "smoothness": (p.get("scores") or {}).get("smoothness")})
        events.extend({"tripId": p["tripId"], "kind": e["kind"]} for e in p.get("events") or [])
    return trips, events
