# Databricks notebook source
# Loads trip JSON files (written by the cloud service) from a Volume into Delta tables.
# Idempotent: re-running upserts by key. All parsing lives in lib/flatten.py (unit-tested).
# NOT run against a real workspace yet.

# COMMAND ----------
import json, os, sys

sys.path.append(os.path.abspath(os.path.join(os.getcwd(), "..")))  # repo's databricks/ folder
from lib.flatten import flatten_trip

dbutils.widgets.text("catalog", "carassistant")
dbutils.widgets.text("schema", "default")
dbutils.widgets.text("volume", "trips")
CAT, SCH, VOL = (dbutils.widgets.get(k) for k in ("catalog", "schema", "volume"))
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CAT}.{SCH}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {CAT}.{SCH}.{VOL}")

# COMMAND ----------
spark.sql(f"""CREATE TABLE IF NOT EXISTS {CAT}.{SCH}.trips (
  tripId STRING, driverId STRING, startMs BIGINT, endMs BIGINT, durationS BIGINT,
  smoothness DOUBLE, stopCompliance DOUBLE, nEvents INT, nBadEvents INT, hadCrash BOOLEAN)""")
spark.sql(f"""CREATE TABLE IF NOT EXISTS {CAT}.{SCH}.events (
  tripId STRING, driverId STRING, eventId STRING, tMs BIGINT, kind STRING, isBad BOOLEAN,
  lat DOUBLE, lon DOUBLE, score DOUBLE, gridCell STRING)""")
spark.sql(f"""CREATE TABLE IF NOT EXISTS {CAT}.{SCH}.features (
  tripId STRING, driverId STRING, windowIdx INT, features ARRAY<DOUBLE>)""")

# COMMAND ----------
files = spark.read.option("wholetext", True).text(f"/Volumes/{CAT}/{SCH}/{VOL}/trips/*.json").collect()
trips, events, feats = [], [], []
for row in files:
    t, e, f = flatten_trip(json.loads(row.value))
    trips.append(t); events += e; feats += f
print(f"{len(trips)} trips, {len(events)} events, {len(feats)} feature windows")

# COMMAND ----------
def upsert(rows, table, keys):
    if not rows:
        return
    spark.createDataFrame(rows, schema=spark.table(f"{CAT}.{SCH}.{table}").schema).createOrReplaceTempView(f"_stage_{table}")
    on = " AND ".join(f"t.{k} = s.{k}" for k in keys)
    spark.sql(f"MERGE INTO {CAT}.{SCH}.{table} t USING _stage_{table} s ON {on} "
              "WHEN MATCHED THEN UPDATE SET * WHEN NOT MATCHED THEN INSERT *")

upsert(trips, "trips", ["tripId"])
upsert(events, "events", ["tripId", "eventId"])
upsert(feats, "features", ["tripId", "windowIdx"])
