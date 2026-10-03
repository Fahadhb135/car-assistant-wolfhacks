import httpx
import pytest
from fastapi.testclient import TestClient

from app.databricks_sink import DatabricksSink
from app.main import create_app
from app.schemas import Trip
from tests.test_api import TRIP


def sink_with(handler):
    return DatabricksSink("https://dbx.example/", "tok", "/Volumes/main/c/trips/", httpx.Client(transport=httpx.MockTransport(handler)))


def test_put_to_files_api_with_auth_and_overwrite():
    seen = {}

    def handler(req: httpx.Request):
        seen.update(method=req.method, url=str(req.url), auth=req.headers["authorization"], body=req.content)
        return httpx.Response(200)

    sink_with(handler).write_trip(Trip(**TRIP))
    assert seen["method"] == "PUT"
    assert seen["url"] == "https://dbx.example/api/2.0/fs/files/Volumes/main/c/trips/trips/t1.json?overwrite=true"
    assert seen["auth"] == "Bearer tok"
    assert b'"tripId":"t1"' in seen["body"]


def test_http_error_raises():
    with pytest.raises(httpx.HTTPStatusError):
        sink_with(lambda r: httpx.Response(500)).write_trip(Trip(**TRIP))


def test_rejects_path_traversal_trip_ids():
    with pytest.raises(Exception):
        Trip(**{**TRIP, "tripId": "../../x"})


def test_upload_survives_databricks_outage_and_resync_recovers(tmp_path):
    up = {"v": False}

    def handler(req):
        return httpx.Response(200) if up["v"] else httpx.Response(503)

    c = TestClient(create_app(db_path=str(tmp_path / "t.db"), models_dir=tmp_path, sink=sink_with(handler)))
    assert c.post("/trips", json=TRIP).status_code == 201  # outage does not fail the upload
    assert c.post("/admin/databricks/sync").json() == {"pending": 1, "synced": 0}
    up["v"] = True
    assert c.post("/admin/databricks/sync").json() == {"pending": 1, "synced": 1}
    assert c.post("/admin/databricks/sync").json() == {"pending": 0, "synced": 0}


def test_sync_requires_config_and_admin_token(tmp_path, monkeypatch):
    c = TestClient(create_app(db_path=str(tmp_path / "t.db"), models_dir=tmp_path))
    assert c.post("/admin/databricks/sync").status_code == 503
    monkeypatch.setenv("ADMIN_TOKEN", "s3")
    c2 = TestClient(create_app(db_path=str(tmp_path / "t2.db"), models_dir=tmp_path, sink=sink_with(lambda r: httpx.Response(200))))
    assert c2.post("/admin/databricks/sync").status_code == 401
    assert c2.post("/admin/databricks/sync", headers={"X-Admin-Token": "s3"}).status_code == 200
