"""Reads the ingested Delta tables (trips, events, transcript) back for the app's dashboard and trip
summary, through a SQL warehouse (Statement Execution API, parameterized queries only), and
queues the ingest -> analytics job after an upload so new trips reach those tables on their own.

Databricks is never on a path that can break an upload or a drive: callers fall back to the
service's own copy of each trip when a query fails or a trip has not been ingested yet."""
import time
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

from .trip_rows import event_from_row, transcript_from_row, trip_from_row

REFRESH_JOB_NAME = "car-assistant refresh (ingest -> analytics)"  # databricks/workspace.py creates it
SQL_TYPES = {str: "STRING", int: "BIGINT", float: "DOUBLE"}


class DatabricksReader:
    def __init__(self, host: str, token: str, volume_path: str, warehouse_id: Optional[str] = None,
                 client: Optional[httpx.Client] = None, wait_s: float = 45.0):
        host = host.strip()
        host = host if host.startswith(("http://", "https://")) else "https://" + host
        p = urlparse(host)
        self.host = f"{p.scheme}://{p.netloc}"
        self.client = client or httpx.Client(headers={"Authorization": f"Bearer {token}"}, timeout=60)
        # /Volumes/<catalog>/<schema>/<volume> -> <catalog>.<schema>
        parts = volume_path.strip("/").split("/")
        if len(parts) < 3 or parts[0] != "Volumes" or not all(x.replace("_", "").isalnum() for x in parts[1:3]):
            raise ValueError(f"unexpected volume path {volume_path!r}")
        self.schema = f"{parts[1]}.{parts[2]}"
        self.warehouse_id = warehouse_id
        self.wait_s = wait_s
        self._job_id: Optional[int] = None

    def _api(self, method: str, path: str, **kw) -> dict:
        r = self.client.request(method, f"{self.host}{path}", **kw)
        r.raise_for_status()
        return r.json() if r.content else {}

    def _warehouse(self) -> str:
        if not self.warehouse_id:
            warehouses = self._api("GET", "/api/2.0/sql/warehouses").get("warehouses") or []
            if not warehouses:
                raise RuntimeError("no SQL warehouse in this workspace")
            self.warehouse_id = warehouses[0]["id"]
        return self.warehouse_id

    def query(self, sql: str, params: Optional[dict[str, Any]] = None) -> list[dict]:
        """Rows as dicts (values are strings or None, as the API returns them). A stopped warehouse
        starts on the first query, so this waits up to `wait_s` before giving up."""
        body = {
            "warehouse_id": self._warehouse(),
            "statement": sql.replace("{schema}", self.schema),
            "wait_timeout": "30s",
            "on_wait_timeout": "CONTINUE",
            "parameters": [{"name": k, "value": None if v is None else str(v), "type": SQL_TYPES[type(v)]}
                           for k, v in (params or {}).items()],
        }
        r = self._api("POST", "/api/2.0/sql/statements", json=body)
        deadline = time.time() + self.wait_s
        while r["status"]["state"] in ("PENDING", "RUNNING"):
            if time.time() > deadline:
                self._api("POST", f"/api/2.0/sql/statements/{r['statement_id']}/cancel")
                raise TimeoutError("Databricks query timed out (warehouse starting?)")
            time.sleep(1)
            r = self._api("GET", f"/api/2.0/sql/statements/{r['statement_id']}")
        if r["status"]["state"] != "SUCCEEDED":
            raise RuntimeError(f"Databricks query failed: {r['status']}")
        cols = [c["name"] for c in r["manifest"]["schema"]["columns"]]
        return [dict(zip(cols, row)) for row in (r.get("result") or {}).get("data_array") or []]

    # --- the app's views -------------------------------------------------------------------------

    def driver_trips(self, driver_id: str, limit: int) -> list[dict]:
        rows = self.query(
            "SELECT tripId, driverId, startMs, endMs, durationS, smoothness, stopCompliance, nEvents, "
            # LIMIT cannot take a parameter in Databricks SQL; it is an int we clamp, never user text.
            "nBadEvents, hadCrash, nSpeeding, distanceM FROM {schema}.trips WHERE driverId = :driver ORDER BY startMs DESC "
            f"LIMIT {max(1, min(int(limit), 200))}",
            {"driver": driver_id},
        )
        return [trip_from_row(r) for r in rows]

    def trip_summary(self, trip_id: str) -> Optional[dict]:
        trips = self.query(
            "SELECT tripId, driverId, startMs, endMs, durationS, smoothness, stopCompliance, nEvents, "
            "nBadEvents, hadCrash, nSpeeding, distanceM FROM {schema}.trips WHERE tripId = :trip", {"trip": trip_id})
        if not trips:
            return None
        events = self.query(
            "SELECT eventId, tMs, kind, isBad, lat, lon, speedMps, limitMps, road, score, confirmed, detailJson "
            "FROM {schema}.events WHERE tripId = :trip ORDER BY tMs", {"trip": trip_id})
        try:
            said = self.query("SELECT tMs, role, text FROM {schema}.transcript WHERE tripId = :trip ORDER BY turnIdx",
                              {"trip": trip_id})
        except Exception:
            said = []  # workspaces ingested before the transcript table existed
        return {
            "trip": trip_from_row(trips[0]),
            "events": [event_from_row(e) for e in events],
            "transcript": [transcript_from_row(s) for s in said],
        }

    # --- keeping the tables fresh ----------------------------------------------------------------

    def queue_refresh(self) -> str:
        """Queue the ingest -> analytics job. One run in progress plus one waiting covers any number
        of uploads (each run ingests every file in the Volume), so further requests are skipped."""
        if self._job_id is None:
            jobs = self._api("GET", "/api/2.1/jobs/list", params={"name": REFRESH_JOB_NAME}).get("jobs") or []
            if not jobs:
                return "no refresh job (run: databricks/workspace.py job)"
            self._job_id = int(jobs[0]["job_id"])
        active = self._api("GET", "/api/2.1/jobs/runs/list",
                           params={"job_id": self._job_id, "active_only": "true"}).get("runs") or []
        if len(active) >= 2:
            return "already queued"
        self._api("POST", "/api/2.1/jobs/run-now", json={"job_id": self._job_id, "queue": {"enabled": True}})
        return "queued"

