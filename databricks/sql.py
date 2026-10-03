"""Run SQL on the workspace's SQL warehouse from the command line (uses ../.env).

  cloud/.venv/bin/python databricks/sql.py "SELECT * FROM carassistant.default.trips LIMIT 5"
The first query after the warehouse has been idle takes ~12 s (cold start)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import workspace as w  # noqa: E402


def warehouse_id() -> str:
    return w.api("GET", "/api/2.0/sql/warehouses")["warehouses"][0]["id"]


def query(stmt: str, wh: str | None = None) -> list[dict]:
    r = w.api("POST", "/api/2.0/sql/statements",
              json={"warehouse_id": wh or warehouse_id(), "statement": stmt, "wait_timeout": "50s"})
    if r["status"]["state"] != "SUCCEEDED":
        raise RuntimeError(f"{r['status']}")
    cols = [c["name"] for c in r["manifest"]["schema"]["columns"]]
    return [dict(zip(cols, row)) for row in (r.get("result", {}).get("data_array") or [])]


if __name__ == "__main__":
    wh = warehouse_id()
    for s in sys.argv[1:]:
        print(">>", s)
        try:
            for row in query(s, wh):
                print("  ", row)
        except Exception as exc:
            print("   ERROR:", str(exc)[:400])
