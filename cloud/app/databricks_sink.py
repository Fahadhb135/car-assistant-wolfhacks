"""Writes finished trips to a Unity Catalog Volume as JSON via the Databricks Files API.
A notebook (databricks/notebooks/01_ingest.py) loads them into Delta tables. Databricks
being slow or down must never affect uploads: SQLite is the source of truth and unsynced
trips are retried."""
import re
from typing import Optional

import httpx

from .schemas import Trip

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class DatabricksSink:
    def __init__(self, host: str, token: str, volume_path: str, client: Optional[httpx.Client] = None):
        self.host = host.rstrip("/")
        self.token = token
        self.volume_path = volume_path.rstrip("/")
        self.client = client or httpx.Client(timeout=15)

    def write_trip(self, trip: Trip) -> None:
        if not SAFE_ID.match(trip.tripId):
            raise ValueError("unsafe trip id")
        resp = self.client.put(
            f"{self.host}/api/2.0/fs/files{self.volume_path}/trips/{trip.tripId}.json",
            params={"overwrite": "true"},
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/octet-stream"},
            content=trip.model_dump_json().encode(),
        )
        resp.raise_for_status()
