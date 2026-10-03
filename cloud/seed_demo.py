"""Upload synthetic demo trips through the real POST /trips path so hotspots have data.
Drivers are named demo-N, so snapshots built only from them are flagged demo=true.

  cloud/.venv/bin/python cloud/seed_demo.py --lat 35.7832 --lon -78.6330 [--base-url http://localhost:8000]

Idempotent (trip ids are deterministic). One driver also has a lone event far away, so you
can see that single-driver places are NOT reported as hotspots."""
import argparse
import math
import random

import httpx

ap = argparse.ArgumentParser()
ap.add_argument("--lat", type=float, required=True)
ap.add_argument("--lon", type=float, required=True)
ap.add_argument("--base-url", default="http://localhost:8000")
ap.add_argument("--drivers", type=int, default=4)
ap.add_argument("--kind", default="rolling_stop", choices=["rolling_stop", "ran_stop", "erratic_driving"])
args = ap.parse_args()

rng = random.Random(7)


def jitter(lat: float, lon: float, meters: float) -> tuple[float, float]:
    dlat = rng.uniform(-meters, meters) / 111_320
    dlon = rng.uniform(-meters, meters) / (111_320 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


c = httpx.Client(timeout=20)
start = 1_730_000_000_000
for d in range(1, args.drivers + 1):
    lat, lon = jitter(args.lat, args.lon, 25)  # same intersection, different GPS noise
    events = [{"eventId": f"e{d}-1", "t": start + d * 60_000, "kind": args.kind, "lat": lat, "lon": lon}]
    if d == 1:  # a one-driver place, which must stay out of the hotspot list
        far_lat, far_lon = jitter(args.lat + 0.02, args.lon, 10)
        events.append({"eventId": f"e{d}-2", "t": start + d * 60_000 + 5, "kind": "ran_stop", "lat": far_lat, "lon": far_lon})
    trip = {
        "tripId": f"demo-d{d}-1", "driverId": f"demo-{d}", "start": start + d * 50_000, "end": start + d * 70_000,
        "scores": {"smoothness": 80.0 - d}, "events": events,
    }
    r = c.post(f"{args.base_url}/trips", json=trip)
    print(f"demo-d{d}-1:", r.status_code, r.json())
