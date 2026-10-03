"""Synthetic demo history for the teen-driver story. Pure and deterministic (seeded), so it is
unit-tested and idempotent: re-seeding produces the same trip ids.

Everything here is FAKE: drivers are named demo-*, and the IMU "features" are synthetic
placeholders (6 columns) standing in for Person B's real feature spec.

The story: Maya (demo-maya) is a new driver. Over three weeks her stops go from mostly
rolling to mostly full, and her smoothness rises. Four peers (demo-1..4) repeatedly roll
through stop B and run stop C, which makes those two real intersections crowd hotspots.
Stops A and D only ever have Maya's early mistakes (one driver), so the 2-driver privacy
rule keeps them OUT of the hotspot list."""
import math
import random
from datetime import datetime, timezone

# Real OpenStreetMap stop signs on one road in downtown Raleigh (nodes 6575323135,
# 195438853, 195438854, 195438857), ~120-230 m apart.
STOPS = {
    "A": (35.7836086, -78.6330127),
    "B": (35.7846924, -78.6329528),
    "C": (35.7859883, -78.6328660),
    "D": (35.7880720, -78.6327600),
}
MAYA_TRIPS = 12
PEERS = ("demo-1", "demo-2", "demo-3", "demo-4")
PEER_TRIPS = 3
WINDOWS_PER_TRIP = 40
N_FEATURES = 6
DAY_MS = 86_400_000


def _jitter(rng: random.Random, lat: float, lon: float, meters: float = 15.0) -> tuple[float, float]:
    return (
        lat + rng.uniform(-meters, meters) / 111_320,
        lon + rng.uniform(-meters, meters) / (111_320 * math.cos(math.radians(lat))),
    )


def _features(rng: random.Random, roughness: float) -> list[list[float]]:
    rows = []
    for _ in range(WINDOWS_PER_TRIP):
        scale = 3.0 if rng.random() < 0.02 else 1.0  # a few outlier windows
        rows.append([round(abs(rng.gauss(1.0, 0.15)) * roughness * scale, 4) for _ in range(N_FEATURES)])
    return rows


def _trip(trip_id, driver, start_ms, outcomes, rng, smoothness, roughness, erratic=0, with_features=True):
    events, n = [], 0
    for i, (stop, kind) in enumerate(outcomes):
        lat, lon = _jitter(rng, *STOPS[stop])
        n += 1
        events.append({"eventId": f"e{n}", "t": start_ms + (2 + i * 4) * 60_000, "kind": kind, "lat": lat, "lon": lon})
    for j in range(erratic):
        n += 1
        events.append({"eventId": f"e{n}", "t": start_ms + (3 + j * 5) * 60_000 + 30_000, "kind": "erratic_driving", "score": round(rng.uniform(0.6, 0.9), 2)})
    events.sort(key=lambda e: e["t"])
    ok = sum(1 for _, k in outcomes if k == "stop_ok")
    trip = {
        "tripId": trip_id,
        "driverId": driver,
        "start": start_ms,
        "end": start_ms + 22 * 60_000,
        "scores": {"smoothness": round(smoothness, 1), "stopCompliance": round(ok / len(outcomes), 2)},
        "events": events,
    }
    if with_features:
        trip["features"] = _features(rng, roughness)
    return trip


def build_story(now: datetime | None = None, days: int = 21, with_features: bool = True) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    midnight = int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
    trips = []

    # Maya: improving.
    for i in range(MAYA_TRIPS):
        p = i / (MAYA_TRIPS - 1)
        rng = random.Random(f"maya-{i}")
        outcomes = []
        for stop in "ABCD":
            if rng.random() < 0.25 + 0.7 * p:
                kind = "stop_ok"
            else:
                kind = "ran_stop" if (p < 0.4 and rng.random() < 0.25) else "rolling_stop"
            outcomes.append((stop, kind))
        day = round(i * (days - 1) / (MAYA_TRIPS - 1))
        start = midnight - (days - 1 - day) * DAY_MS + 16 * 3_600_000
        trips.append(_trip(
            f"demo-maya-{i + 1:02d}", "demo-maya", start, outcomes, rng,
            smoothness=66 + 24 * p + rng.uniform(-2, 2), roughness=1.35 - 0.35 * p,
            erratic=2 if p < 0.2 else (1 if p < 0.4 else 0), with_features=with_features,
        ))

    # Peers: consistently roll B and run C (until the last driver, who only rolls C).
    for d, driver in enumerate(PEERS):
        for i in range(PEER_TRIPS):
            rng = random.Random(f"{driver}-{i}")
            outcomes = [("A", "stop_ok"), ("B", "rolling_stop"),
                        ("C", "ran_stop" if d < 3 else "rolling_stop"), ("D", "stop_ok")]
            day = (d * 5 + i * 6) % days
            start = midnight - (days - 1 - day) * DAY_MS + 17 * 3_600_000
            trips.append(_trip(
                f"demo-{driver[-1]}-s{i + 1}", driver, start, outcomes, rng,
                smoothness=74 + rng.uniform(-6, 6), roughness=1.0, with_features=with_features,
            ))
    return trips
