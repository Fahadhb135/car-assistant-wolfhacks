"""Turns one uploaded trip JSON into rows for the Delta tables. Plain Python so it is
unit-tested locally; the ingest notebook only wraps it in Spark."""
from typing import Optional

BAD_KINDS = {"crash", "ran_stop", "rolling_stop", "erratic_driving"}


def grid_cell(lat: Optional[float], lon: Optional[float], precision: int = 3) -> Optional[str]:
    """~110 m cells at precision 3. None when the event has no fix."""
    if lat is None or lon is None:
        return None
    return f"{round(lat, precision):.{precision}f},{round(lon, precision):.{precision}f}"


def flatten_trip(trip: dict) -> tuple[dict, list[dict], list[dict]]:
    events = trip.get("events") or []
    scores = trip.get("scores") or {}
    trip_id, driver = trip["tripId"], trip["driverId"]

    trip_row = {
        "tripId": trip_id,
        "driverId": driver,
        "startMs": trip["start"],
        "endMs": trip["end"],
        "durationS": max(0, (trip["end"] - trip["start"]) // 1000),
        "smoothness": scores.get("smoothness"),
        "stopCompliance": scores.get("stopCompliance"),
        "nEvents": len(events),
        "nBadEvents": sum(1 for e in events if e["kind"] in BAD_KINDS),
        # A heuristic motion candidate must never become a confirmed crash in analytics.
        "hadCrash": any(e["kind"] == "crash" and e.get("confirmed") is True for e in events),
    }
    event_rows = [
        {
            "tripId": trip_id,
            "driverId": driver,
            "eventId": e["eventId"],
            "tMs": e["t"],
            "kind": e["kind"],
            "isBad": e["kind"] in BAD_KINDS,
            "lat": e.get("lat"),
            "lon": e.get("lon"),
            "score": e.get("score"),
            "confirmed": e.get("confirmed"),
            "gridCell": grid_cell(e.get("lat"), e.get("lon")),
        }
        for e in events
    ]
    feature_rows = [
        {"tripId": trip_id, "driverId": driver, "windowIdx": i, "features": [float(x) for x in row]}
        for i, row in enumerate(trip.get("features") or [])
    ]
    return trip_row, event_rows, feature_rows
