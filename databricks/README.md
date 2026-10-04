# databricks/

Long-term analysis and retraining (README sections 3, 15). Free Edition is enough.

```
trip upload -> cloud service -> SQLite (source of truth)
                             -> Files API PUT -> /Volumes/carassistant/default/trips/trips/<tripId>.json
01_ingest     Volume JSON -> Delta tables trips / events / features (MERGE, idempotent)
02_analytics  risky_locations, driver_trends -> dashboard
              + publishes publish/hotspots.json (crowd hotspots, >=2 drivers, 50 m clusters)
              + publishes publish/coaching_context.json (per-driver history for live coaching)
              + publishes publish/parent_dashboard.json (per driver: a summary row per trip + every
                speeding alert; the app's Parent view reads it through the service, README section 9)
03_retrain    features -> IsolationForest -> model-vN.onnx (+ .meta.json) in a Volume
              -> a person copies it into cloud/models/ -> GET /model/latest -> phone validates + swaps
```

Setup: set `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_VOLUME_PATH` (default
`/Volumes/carassistant/default/trips`) on the service. Create the Volume first (01_ingest does it).
If the venue wifi drops, `POST /admin/databricks/sync` retries unsynced trips.

`trips` gained `distanceM` and `nSpeeding`. `01_ingest` adds them to an existing table with `ALTER TABLE`, so
re-run it, then `02_analytics`, then `POST /admin/parent/refresh` on the service. Older trips have no distance
(`NULL`, shown as "Not recorded"). `speeding` is not in `BAD_KINDS`, so `nBadEvents`, `risky_locations` and the
existing scores are unchanged; speeding alerts are counted in `nSpeeding`. The aggregation is `cloud/app/parent.py`;
`tests/test_parent_contract.py` checks that the Delta rows and the service's local rows give the same dashboard.

Local tests (logic only): `cloud/.venv/bin/python -m pytest` from this folder.
The notebooks themselves are thin Spark wrappers and are **not tested locally**.
`FEATURE_SCHEMA_VERSION` in `lib/retrain.py` must be updated to match Person B's feature spec.
