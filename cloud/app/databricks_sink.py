"""Writes finished trips to a Unity Catalog Volume as JSON via the Databricks Files API.
A notebook (databricks/notebooks/01_ingest.py) loads them into Delta tables. Databricks
being slow or down must never affect uploads: SQLite is the source of truth and unsynced
trips are retried."""
import re
from typing import Optional
from urllib.parse import urlparse

import httpx

from .schemas import Trip

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class DatabricksSink:
    def __init__(self, host: str, token: str, volume_path: str, client: Optional[httpx.Client] = None):
        host = host.strip()
        if not host.startswith(("http://", "https://")):
            host = "https://" + host
        parsed = urlparse(host)  # keep scheme + host only: users paste URLs like .../explore/data?o=123
        self.host = f"{parsed.scheme}://{parsed.netloc}"
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

    def _url(self, rel_path: str) -> str:
        if ".." in rel_path.split("/") or rel_path.startswith("/"):
            raise ValueError("unsafe path")
        return f"{self.host}/api/2.0/fs/files{self.volume_path}/{rel_path}"

    def write_file(self, rel_path: str, data: bytes) -> None:
        resp = self.client.put(
            self._url(rel_path),
            params={"overwrite": "true"},
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/octet-stream"},
            content=data,
        )
        resp.raise_for_status()

    def read_file(self, rel_path: str) -> bytes:
        resp = self.client.get(self._url(rel_path), headers={"Authorization": f"Bearer {self.token}"})
        resp.raise_for_status()
        return resp.content

    def list_dir(self, rel_dir: str) -> list[str]:
        if ".." in rel_dir.split("/") or rel_dir.startswith("/"):
            raise ValueError("unsafe path")
        resp = self.client.get(
            f"{self.host}/api/2.0/fs/directories{self.volume_path}/{rel_dir.strip('/')}/",
            headers={"Authorization": f"Bearer {self.token}"},
        )
        resp.raise_for_status()
        return [c["name"] for c in resp.json().get("contents", []) if not c.get("is_directory")]
