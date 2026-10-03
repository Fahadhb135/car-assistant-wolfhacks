"""Upload the synthetic teen-driver story through the real POST /trips path.

  cloud/.venv/bin/python cloud/seed_demo.py [--base-url http://localhost:8000] [--days 21] [--no-features]

Idempotent (fixed trip ids). All drivers are demo-*; hotspots they create are flagged demo=true.
See demo_data.py for the story and what stays hidden by the 2-driver privacy rule."""
import argparse
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from demo_data import build_story  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--base-url", default="http://localhost:8000")
ap.add_argument("--days", type=int, default=21)
ap.add_argument("--no-features", action="store_true", help="skip the synthetic IMU feature windows")
args = ap.parse_args()

c = httpx.Client(timeout=30)
created = existing = 0
for trip in build_story(days=args.days, with_features=not args.no_features):
    r = c.post(f"{args.base_url}/trips", json=trip)
    r.raise_for_status()
    if r.json()["created"]:
        created += 1
    else:
        existing += 1
print(f"seeded {created} new trips ({existing} already present) -> {args.base_url}")
