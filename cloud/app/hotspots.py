"""Crowd hotspots: places where several different drivers rolled or ran a stop or drove
erratically. Pure stdlib so the cloud service and the Databricks notebook share one tested
implementation. Output is aggregated per ~110 m grid cell and only includes cells with at
least `min_drivers` distinct drivers, so no single driver's trip can be read from it."""
import math
from typing import Iterable, Optional

HOTSPOT_KINDS = ("ran_stop", "rolling_stop", "erratic_driving")  # crash is deliberately excluded
MIN_DRIVERS = 2
_EARTH_M = 6_371_008.8


def grid_cell(lat: Optional[float], lon: Optional[float], precision: int = 3) -> Optional[str]:
    """Must match databricks/lib/flatten.py (a cross-test enforces it)."""
    if lat is None or lon is None:
        return None
    return f"{round(lat, precision):.{precision}f},{round(lon, precision):.{precision}f}"


def events_from_trips(trips: Iterable[dict]) -> list[dict]:
    """Flatten uploaded trip JSON to the same row shape as the Delta `events` table."""
    rows = []
    for trip in trips:
        for e in trip.get("events") or []:
            rows.append(
                {
                    "tripId": trip["tripId"],
                    "driverId": trip["driverId"],
                    "kind": e["kind"],
                    "lat": e.get("lat"),
                    "lon": e.get("lon"),
                    "gridCell": grid_cell(e.get("lat"), e.get("lon")),
                }
            )
    return rows


CLUSTER_RADIUS_M = 50.0
DEMO_PREFIX = "demo-"


def aggregate_events(
    event_rows: Iterable[dict], min_drivers: int = MIN_DRIVERS, radius_m: float = CLUSTER_RADIUS_M
) -> list[dict]:
    """Group problem events into places by proximity (not a fixed grid, which would split an
    intersection that sits on a cell border), then keep places with >= `min_drivers` drivers."""
    rows = [
        r for r in event_rows
        if r["kind"] in HOTSPOT_KINDS and r.get("lat") is not None and r.get("lon") is not None
    ]
    rows.sort(key=lambda r: (r["lat"], r["lon"], str(r["tripId"])))  # deterministic

    clusters: list[dict] = []
    for r in rows:
        best, best_d = None, radius_m
        for c in clusters:
            d = distance_m(c["lat"], c["lon"], r["lat"], r["lon"])
            if d <= best_d:
                best, best_d = c, d
        if best is None:
            best = {"lat": 0.0, "lon": 0.0, "n": 0, "trips": set(), "drivers": set(), "byKind": {}}
            clusters.append(best)
        best["lat"] = (best["lat"] * best["n"] + r["lat"]) / (best["n"] + 1)  # running centroid
        best["lon"] = (best["lon"] * best["n"] + r["lon"]) / (best["n"] + 1)
        best["n"] += 1
        best["trips"].add(r["tripId"])
        best["drivers"].add(r["driverId"])
        best["byKind"][r["kind"]] = best["byKind"].get(r["kind"], 0) + 1

    out = []
    for c in clusters:
        if len(c["drivers"]) < min_drivers:
            continue
        # most frequent kind; ties go to the more serious one (HOTSPOT_KINDS is ordered)
        top = max(c["byKind"], key=lambda k: (c["byKind"][k], -HOTSPOT_KINDS.index(k)))
        out.append(
            {
                "cell": f"{c['lat']:.5f},{c['lon']:.5f}",
                "lat": round(c["lat"], 6),
                "lon": round(c["lon"], 6),
                "bad": c["n"],
                "trips": len(c["trips"]),
                "drivers": len(c["drivers"]),
                "byKind": c["byKind"],
                "topKind": top,
                # true when any seeded demo driver contributed; never exposes who
                "demo": any(str(d).startswith(DEMO_PREFIX) for d in c["drivers"]),
            }
        )
    out.sort(key=lambda h: (-h["bad"], h["cell"]))
    return out


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * _EARTH_M * math.asin(math.sqrt(a))


def near(hotspots: Iterable[dict], lat: float, lon: float, radius_m: float) -> list[dict]:
    return [h for h in hotspots if distance_m(lat, lon, h["lat"], h["lon"]) <= radius_m]
