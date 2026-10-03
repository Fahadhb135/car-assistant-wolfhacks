# Databricks notebook source
# Risky locations and per-driver trends for the dashboard. NOT run against a real workspace yet.

# COMMAND ----------
dbutils.widgets.text("catalog", "carassistant")
dbutils.widgets.text("schema", "default")
CAT, SCH = dbutils.widgets.get("catalog"), dbutils.widgets.get("schema")

# COMMAND ----------
# Risky locations: ~110 m grid cells ranked by problem events (needs >= 1 GPS fix per event).
spark.sql(f"""
CREATE OR REPLACE TABLE {CAT}.{SCH}.risky_locations AS
SELECT gridCell,
       AVG(lat) AS lat, AVG(lon) AS lon,
       COUNT(*) AS badEvents,
       COUNT(DISTINCT tripId) AS trips,
       COUNT_IF(kind = 'ran_stop') AS ranStops,
       COUNT_IF(kind = 'rolling_stop') AS rollingStops
FROM {CAT}.{SCH}.events
WHERE isBad AND gridCell IS NOT NULL
GROUP BY gridCell
ORDER BY badEvents DESC""")
display(spark.table(f"{CAT}.{SCH}.risky_locations").limit(20))

# COMMAND ----------
# Per-driver trend, oldest to newest trip: is smoothness / stop compliance improving?
spark.sql(f"""
CREATE OR REPLACE TABLE {CAT}.{SCH}.driver_trends AS
SELECT driverId, tripId, FROM_UNIXTIME(startMs / 1000) AS startedAt,
       smoothness, stopCompliance, nBadEvents,
       ROW_NUMBER() OVER (PARTITION BY driverId ORDER BY startMs) AS tripNumber,
       AVG(smoothness) OVER (PARTITION BY driverId ORDER BY startMs ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS smoothness3TripAvg
FROM {CAT}.{SCH}.trips""")
display(spark.table(f"{CAT}.{SCH}.driver_trends").orderBy("driverId", "tripNumber"))

# COMMAND ----------
# Publish crowd hotspots for the phone. The cloud service reads publish/hotspots.json from
# the trips Volume (POST /admin/hotspots/refresh) and serves it to phones at trip start.
# Aggregation lives in cloud/app/hotspots.py (unit-tested, shared with the service) and only
# reports places where at least 2 different drivers had problems (clustered within 50 m), so no single driver is exposed.
import json, os, sys, time

sys.path.append(os.path.abspath(os.path.join(os.getcwd(), "..", "..", "cloud")))
from app.hotspots import aggregate_events

dbutils.widgets.text("volume", "trips")
dbutils.widgets.text("min_drivers", "2")
VOL = dbutils.widgets.get("volume")
rows = [r.asDict() for r in spark.table(f"{CAT}.{SCH}.events")
        .select("tripId", "driverId", "kind", "lat", "lon", "gridCell").collect()]
hotspots = aggregate_events(rows, min_drivers=int(dbutils.widgets.get("min_drivers")))
snapshot = {"generatedAt": int(time.time() * 1000), "demo": any(h["demo"] for h in hotspots), "hotspots": hotspots}
out = f"/Volumes/{CAT}/{SCH}/{VOL}/publish/hotspots.json"
dbutils.fs.mkdirs(os.path.dirname(out))
dbutils.fs.put(out, json.dumps(snapshot), True)
print(f"published {len(snapshot['hotspots'])} hotspots (demo={snapshot['demo']}) to {out}")
