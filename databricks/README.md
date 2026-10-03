# databricks/

Long-term analysis and retraining (README sections 3, 15). Free Edition is enough.

```
trip upload -> cloud service -> SQLite (source of truth)
                             -> Files API PUT -> /Volumes/carassistant/default/trips/trips/<tripId>.json
01_ingest     Volume JSON -> Delta tables trips / events / features (MERGE, idempotent)
02_analytics  risky_locations, driver_trends -> dashboard
03_retrain    features -> IsolationForest -> model-vN.onnx (+ .meta.json) in a Volume
              -> a person copies it into cloud/models/ -> GET /model/latest -> phone validates + swaps
```

Setup: set `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_VOLUME_PATH` (default
`/Volumes/carassistant/default/trips`) on the service. Create the Volume first (01_ingest does it).
If the venue wifi drops, `POST /admin/databricks/sync` retries unsynced trips.

Local tests (logic only): `cloud/.venv/bin/python -m pytest` from this folder.
The notebooks themselves are thin Spark wrappers and are **not tested locally**.
`FEATURE_SCHEMA_VERSION` in `lib/retrain.py` must be updated to match Person B's feature spec.
