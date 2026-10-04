"""Turns one uploaded trip JSON into rows for the Delta tables. Plain Python so it is
unit-tested locally; the ingest notebook only wraps it in Spark."""
import json
from typing import Optional

BAD_KINDS = {
    "crash", "ran_stop", "rolling_stop", "erratic_driving",
    "hard_braking", "rapid_acceleration", "harsh_cornering",
}


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
        "distanceM": scores.get("distanceM"),  # None for trips uploaded before the app recorded distance
        "nEvents": len(events),
        "nBadEvents": sum(1 for e in events if e["kind"] in BAD_KINDS),
        # Speeding is not in BAD_KINDS (that would change every existing score and risky-location
        # count), so the parent dashboard reads it from here. These are coach alerts, not minutes.
        "nSpeeding": sum(1 for e in events if e["kind"] == "speeding"),
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
            "speedMps": e.get("speedMps"),
            "limitMps": e.get("limitMps"),
            "road": e.get("road"),
            "detailJson": json.dumps(e.get("detail"), sort_keys=True) if e.get("detail") else None,
            "score": e.get("score"),
            "confirmed": e.get("confirmed"),
            "evidenceJson": json.dumps(e.get("evidence"), sort_keys=True) if e.get("evidence") else None,
            "gridCell": grid_cell(e.get("lat"), e.get("lon")),
        }
        for e in events
    ]
    feature_rows = [
        {"tripId": trip_id, "driverId": driver, "windowIdx": i, "features": [float(x) for x in row]}
        for i, row in enumerate(trip.get("features") or [])
    ]
    return trip_row, event_rows, feature_rows


def transcript_rows(trip: dict) -> list[dict]:
    """What was said during the drive: the live coach's remarks and push-to-talk Q&A."""
    return [
        {"tripId": trip["tripId"], "driverId": trip["driverId"], "turnIdx": i, "tMs": turn["t"],
         "role": turn["role"], "text": turn["text"]}
        for i, turn in enumerate(trip.get("transcript") or [])
    ]
