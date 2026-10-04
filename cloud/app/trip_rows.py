"""Trip / event shapes for the app's dashboard and trip summary, shared by the Databricks reader (Delta
rows read back through the SQL API, every value a string) and the service's local fallback (its own
copy of an uploaded trip). Dependency-free so the Databricks tests can check both stay equal
(databricks/tests/test_dashboard_contract.py)."""
import json
from typing import Optional

# Mirrors databricks/lib/flatten.py.
BAD_KINDS = {"crash", "ran_stop", "rolling_stop", "erratic_driving", "hard_braking", "rapid_acceleration",
             "harsh_cornering"}


def _num(v) -> Optional[float]:
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def _int(v) -> Optional[int]:
    n = _num(v)
    return None if n is None else int(n)


def _bool(v) -> Optional[bool]:
    return None if v is None else str(v).lower() == "true"


def trip_from_row(r: dict) -> dict:
    return {
        "tripId": r["tripId"], "driverId": r["driverId"], "start": _int(r.get("startMs")), "end": _int(r.get("endMs")),
        "durationS": _int(r.get("durationS")), "smoothness": _num(r.get("smoothness")),
        "stopCompliance": _num(r.get("stopCompliance")), "nEvents": _int(r.get("nEvents")),
        "nBadEvents": _int(r.get("nBadEvents")), "hadCrash": _bool(r.get("hadCrash")),
        "nSpeeding": _int(r.get("nSpeeding")), "distanceM": _num(r.get("distanceM")),
    }


def event_from_row(e: dict) -> dict:
    detail = None
    if e.get("detailJson"):
        try:
            detail = json.loads(e["detailJson"])
        except ValueError:
            detail = None
    return {
        "eventId": e["eventId"], "t": _int(e.get("tMs")), "kind": e["kind"], "isBad": _bool(e.get("isBad")),
        "lat": _num(e.get("lat")), "lon": _num(e.get("lon")), "speedMps": _num(e.get("speedMps")),
        "limitMps": _num(e.get("limitMps")), "road": e.get("road"), "score": _num(e.get("score")),
        "confirmed": _bool(e.get("confirmed")), "detail": detail,
    }


def transcript_from_row(s: dict) -> dict:
    return {"t": _int(s.get("tMs")), "role": s["role"], "text": s["text"]}


def local_trip(payload: dict) -> dict:
    events = payload.get("events") or []
    scores = payload.get("scores") or {}
    return {
        "tripId": payload["tripId"], "driverId": payload["driverId"], "start": payload["start"],
        "end": payload["end"], "durationS": max(0, (payload["end"] - payload["start"]) // 1000),
        "smoothness": _num(scores.get("smoothness")), "stopCompliance": _num(scores.get("stopCompliance")),
        "nEvents": len(events), "nBadEvents": sum(1 for e in events if e["kind"] in BAD_KINDS),
        "hadCrash": any(e["kind"] == "crash" and e.get("confirmed") is True for e in events),
        "nSpeeding": sum(1 for e in events if e["kind"] == "speeding"),
        "distanceM": _num(scores.get("distanceM")),
    }


def local_summary(payload: dict) -> dict:
    return {
        "trip": local_trip(payload),
        "events": [
            {"eventId": e["eventId"], "t": e["t"], "kind": e["kind"], "isBad": e["kind"] in BAD_KINDS,
             "lat": e.get("lat"), "lon": e.get("lon"), "speedMps": e.get("speedMps"),
             "limitMps": e.get("limitMps"), "road": e.get("road"), "score": e.get("score"),
             "confirmed": e.get("confirmed"), "detail": e.get("detail")}
            for e in sorted(payload.get("events") or [], key=lambda e: e["t"])
        ],
        "transcript": [{"t": s["t"], "role": s["role"], "text": s["text"]} for s in payload.get("transcript") or []],
    }
