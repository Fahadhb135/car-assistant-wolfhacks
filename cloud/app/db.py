import json
import os
import sqlite3
from typing import Optional

from .schemas import Report, Trip

SCHEMA = """
CREATE TABLE IF NOT EXISTS trips (
  trip_id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  report TEXT,
  received_at INTEGER NOT NULL
);
"""


class TripStore:
    def __init__(self, path: str):
        os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.execute(SCHEMA)
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
