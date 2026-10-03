# Databricks notebook source
# Retrains the anomaly model on pooled windows and writes model-vN.onnx to a Volume.
# HUMAN-GATED: nothing is published automatically. Download the file and copy it into
# cloud/models/ to publish. All logic lives in lib/retrain.py (unit-tested).
# Pipeline demo only: few drivers, one car. NOT run against a real workspace yet.

# COMMAND ----------
import os, sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.append(os.path.abspath(os.path.join(os.getcwd(), "..")))
from lib.retrain import FEATURE_SCHEMA_VERSION, train_and_export

dbutils.widgets.text("catalog", "carassistant")
dbutils.widgets.text("schema", "default")
CAT, SCH = dbutils.widgets.get("catalog"), dbutils.widgets.get("schema")

# COMMAND ----------
rows = [r.features for r in spark.table(f"{CAT}.{SCH}.features").select("features").collect()]
width = Counter(len(r) for r in rows).most_common(1)[0][0]  # drop windows from older schemas
X = np.array([r for r in rows if len(r) == width], dtype=np.float32)
print(f"training on {len(X)} windows x {width} features (schema v{FEATURE_SCHEMA_VERSION}); dropped {len(rows) - len(X)}")

# COMMAND ----------
spark.sql(f"CREATE VOLUME IF NOT EXISTS {CAT}.{SCH}.models")
out = Path(f"/Volumes/{CAT}/{SCH}/models")
out.mkdir(parents=True, exist_ok=True)
result = train_and_export(X, out)
print(result)
print("To publish: download the .onnx from the Volume into cloud/models/ on the service host.")
