import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

TRIP = {
    "tripId": "t1",
    "driverId": "anon",
    "start": 1,
    "end": 2,
    "scores": {"smoothness": 82},
    "events": [
        {"eventId": "e1", "t": 5, "kind": "rolling_stop"},
        {"eventId": "e2", "t": 6, "kind": "stop_ok"},
    ],
}


@pytest.fixture
def make(tmp_path):
    def _make(**kw):
        return TestClient(create_app(db_path=str(tmp_path / "t.db"), models_dir=tmp_path, **kw))

    return _make


def test_health(make):
    assert make().get("/health").json() == {"ok": True}


def test_trip_upload_is_idempotent(make):
    c = make()
    assert c.post("/trips", json=TRIP).json()["created"] is True
    assert c.post("/trips", json=TRIP).json()["created"] is False


def test_report_falls_back_to_template_without_gemini(make):
    c = make()
    c.post("/trips", json=TRIP)
    r = c.get("/trips/t1/report").json()
    assert r["topIssues"][0]["eventRef"] == "e1"
    assert "1 thing" in r["headline"]


def test_unconfirmed_crash_stays_qualified_in_report(make):
    trip = {
        **TRIP,
        "tripId": "candidate-crash",
        "events": [{"eventId": "c1", "t": 5, "kind": "crash", "confirmed": False}],
    }
    c = make()
    assert c.post("/trips", json=trip).status_code == 201
    issue = c.get("/trips/candidate-crash/report").json()["topIssues"][0]
    assert "possible crash" in issue["advice"].lower()


def test_behavior_candidate_evidence_reaches_report(make):
    trip = {
        **TRIP,
        "tripId": "hard-brake",
        "events": [{
            "eventId": "b1", "t": 5, "kind": "hard_braking", "score": 0.8,
            "evidence": {"durationMs": 300, "peakAccelerationG": 0.5},
        }],
    }
    c = make()
    assert c.post("/trips", json=trip).status_code == 201
    report = c.get("/trips/hard-brake/report").json()
    assert report["topIssues"][0]["eventRef"] == "b1"
    assert "braking" in report["topIssues"][0]["advice"].lower()


def test_gemini_report_drops_hallucinated_event_refs(make):
    fake = lambda prompt: json.dumps(
        {
            "headline": "ok",
            "scoreExplanation": "s",
            "topIssues": [{"eventRef": "e1", "advice": "a"}, {"eventRef": "ghost", "advice": "b"}],
            "praise": "p",
            "nextGoal": "g",
        }
    )
    c = make(gemini=fake)
    c.post("/trips", json=TRIP)
    refs = [i["eventRef"] for i in c.get("/trips/t1/report").json()["topIssues"]]
    assert refs == ["e1"]


def test_gemini_failure_uses_template(make):
    def boom(prompt):
        raise RuntimeError("down")

    c = make(gemini=boom)
    c.post("/trips", json=TRIP)
    assert c.get("/trips/t1/report").status_code == 200


def test_unknown_trip_404(make):
    assert make().get("/trips/nope/report").status_code == 404



def test_model_latest_picks_highest_version_with_checksum(make, tmp_path):
    c = make()
    assert c.get("/model/latest").status_code == 404
    (tmp_path / "model-v1.onnx").write_bytes(b"a")
    (tmp_path / "model-v2.onnx").write_bytes(b"bb")
    info = c.get("/model/latest").json()
    assert info["version"] == 2
    assert len(info["sha256"]) == 64
    assert c.get("/model/files/model-v2.onnx").content == b"bb"
    assert c.get("/model/files/..%2Fsecret").status_code == 404


def test_chat_uses_gemini_with_trip_context(make):
    seen = {}

    def fake(system, message):
        seen["system"], seen["message"] = system, message
        return " Pretty smooth. "

    c = make(chat=fake)
    r = c.post("/chat", json={"message": "how was that turn?", "recentEvents": ["rolled a stop"], "smoothness": 82.4})
    assert r.json() == {"reply": "Pretty smooth."}
    assert "never decide anything about safety".replace("never decide", "never decide") in seen["system"]
    assert "rolled a stop" in seen["system"] and "82/100" in seen["system"]


def test_chat_falls_back_and_validates(make):
    assert "can't answer" in make().post("/chat", json={"message": "hi"}).json()["reply"]

    def boom(s, m):
        raise RuntimeError("down")

    assert "can't answer" in make(chat=boom).post("/chat", json={"message": "hi"}).json()["reply"]
    assert make().post("/chat", json={"message": ""}).status_code == 422
