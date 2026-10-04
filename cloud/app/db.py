import hashlib
import json
import os
import secrets
import sqlite3
from typing import Optional

from .schemas import Report, Trip

SCHEMA = """
CREATE TABLE IF NOT EXISTS trips (
  trip_id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  report TEXT,
  received_at INTEGER NOT NULL,
  dbx_synced INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS hotspot_snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS share_codes (
  code TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL,
  share_location INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS viewers (
  token_hash TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL,
  share_location INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trips_by_driver ON trips (driver_id);
"""


class TripStore:
    def __init__(self, path: str):
        os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.executescript(SCHEMA)
        try:  # databases created before Databricks support
            self.conn.execute("ALTER TABLE trips ADD COLUMN dbx_synced INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        self.conn.commit()

    def insert_if_new(self, trip: Trip, now_ms: int) -> bool:
        """Idempotent by trip id. Returns True if this was a new trip."""
        cur = self.conn.execute(
            "INSERT OR IGNORE INTO trips (trip_id, driver_id, payload, received_at) VALUES (?,?,?,?)",
            (trip.tripId, trip.driverId, trip.model_dump_json(), now_ms),
        )
        self.conn.commit()
        return cur.rowcount == 1

    def get_trip(self, trip_id: str) -> Optional[Trip]:
        row = self.conn.execute("SELECT payload FROM trips WHERE trip_id=?", (trip_id,)).fetchone()
        return Trip.model_validate_json(row[0]) if row else None

    def get_report(self, trip_id: str) -> Optional[Report]:
        row = self.conn.execute("SELECT report FROM trips WHERE trip_id=?", (trip_id,)).fetchone()
        return Report.model_validate_json(row[0]) if row and row[0] else None

    def save_report(self, trip_id: str, report: Report) -> None:
        self.conn.execute("UPDATE trips SET report=? WHERE trip_id=?", (report.model_dump_json(), trip_id))
        self.conn.commit()

    def all_trips(self) -> list[dict]:
        rows = self.conn.execute("SELECT payload FROM trips ORDER BY received_at").fetchall()
        return [json.loads(r[0]) for r in rows]

    def mark_synced(self, trip_id: str) -> None:
        self.conn.execute("UPDATE trips SET dbx_synced=1 WHERE trip_id=?", (trip_id,))
        self.conn.commit()

    def unsynced_ids(self) -> list[str]:
        rows = self.conn.execute("SELECT trip_id FROM trips WHERE dbx_synced=0 ORDER BY received_at").fetchall()
        return [r[0] for r in rows]

    def save_hotspots(self, snapshot: dict) -> None:
        self.conn.execute(
            "INSERT INTO hotspot_snapshot (id, payload) VALUES (1, ?) "
            "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            (json.dumps(snapshot),),
        )
        self.conn.commit()

    def load_hotspots(self) -> Optional[dict]:
        row = self.conn.execute("SELECT payload FROM hotspot_snapshot WHERE id=1").fetchone()
        return json.loads(row[0]) if row else None

    def clear_hotspots(self) -> None:
        self.conn.execute("DELETE FROM hotspot_snapshot")
        self.conn.commit()

    # --- Parent access: a short-lived share code the driver shows, traded for a viewer token ---

    def trips_for_driver(self, driver_id: str) -> list[dict]:
        rows = self.conn.execute(
            "SELECT payload FROM trips WHERE driver_id=? ORDER BY received_at", (driver_id,)
        ).fetchall()
        return [json.loads(r[0]) for r in rows]

    def create_share_code(self, driver_id: str, share_location: bool, now_ms: int, ttl_ms: int) -> tuple[str, int]:
        """A new 6-digit code. Replaces the driver's earlier unused codes and drops expired ones."""
        expires = now_ms + ttl_ms
        self.conn.execute("DELETE FROM share_codes WHERE expires_at<=? OR driver_id=?", (now_ms, driver_id))
        while True:
            code = f"{secrets.randbelow(1_000_000):06d}"
            try:
                self.conn.execute(
                    "INSERT INTO share_codes (code, driver_id, share_location, expires_at) VALUES (?,?,?,?)",
                    (code, driver_id, int(share_location), expires),
                )
                break
            except sqlite3.IntegrityError:  # another driver holds this code right now
                continue
        self.conn.commit()
        return code, expires

    def redeem_share_code(self, code: str, now_ms: int) -> Optional[tuple[str, bool]]:
        """One use only: returns (driver_id, share_location), or None if unknown or expired."""
        row = self.conn.execute(
            "SELECT driver_id, share_location, expires_at FROM share_codes WHERE code=?", (code,)
        ).fetchone()
        if row is None:
            return None
        deleted = self.conn.execute("DELETE FROM share_codes WHERE code=?", (code,)).rowcount
        self.conn.commit()
        if deleted != 1 or row[2] <= now_ms:
            return None
        return row[0], bool(row[1])

    @staticmethod
    def _hash(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def add_viewer(self, driver_id: str, share_location: bool, now_ms: int) -> str:
        """Returns the token once; only its hash is stored."""
        token = secrets.token_urlsafe(32)
        self.conn.execute(
            "INSERT INTO viewers (token_hash, driver_id, share_location, created_at) VALUES (?,?,?,?)",
            (self._hash(token), driver_id, int(share_location), now_ms),
        )
        self.conn.commit()
        return token

    def get_viewer(self, token: str) -> Optional[tuple[str, bool]]:
        row = self.conn.execute(
            "SELECT driver_id, share_location FROM viewers WHERE token_hash=?", (self._hash(token),)
        ).fetchone()
        return (row[0], bool(row[1])) if row else None

    def revoke_viewers(self, driver_id: str) -> int:
        """Revokes every parent of this driver and any code not yet used."""
        self.conn.execute("DELETE FROM share_codes WHERE driver_id=?", (driver_id,))
        n = self.conn.execute("DELETE FROM viewers WHERE driver_id=?", (driver_id,)).rowcount
        self.conn.commit()
        return n
