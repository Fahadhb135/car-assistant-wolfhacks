from fastapi.testclient import TestClient

from app.coach import CoachRequest, build_prompt, coach_line
from app.driver_stats import driver_stats, rows_from_payloads
from app.main import create_app


def trip(i, driver, smooth, kinds, lat=35.7847, lon=-78.6329):
    return {"tripId": f"{driver}-{i}", "driverId": driver, "start": 1_000 * i, "end": 1_000 * i + 500,
            "scores": {"smoothness": smooth},
            "events": [{"eventId": f"e{j}", "t": 1_000 * i + j, "kind": k, "lat": lat, "lon": lon}
                       for j, k in enumerate(kinds)]}


def test_driver_stats_compares_first_and_latest_trips():
    payloads = [trip(i, "maya", s, k) for i, (s, k) in enumerate([
        (60, ["rolling_stop"] * 3), (65, ["rolling_stop"] * 3), (70, ["rolling_stop"] * 3),
        (80, ["rolling_stop"]), (85, ["stop_ok"]), (90, ["rolling_stop", "hard_braking"]),
    ])]
    s = driver_stats(*rows_from_payloads(payloads))["maya"]
    assert s["trips"] == 6
    assert s["firstSmoothness"] == 65.0 and s["recentSmoothness"] == 85.0
    assert s["perTripFirst"] == {"rolling_stop": 3.0}
    assert s["perTripRecent"] == {"rolling_stop": 0.7, "hard_braking": 0.3, "stop_ok": 0.3}
    assert s["topIssue"] == "rolling_stop"


def test_crashes_are_never_coaching_material():
    s = driver_stats(*rows_from_payloads([trip(0, "d", 50, ["crash"])]))["d"]
    assert s["perTripRecent"] == {} and s["topIssue"] is None


def test_prompt_carries_live_context_history_and_the_crowd_at_this_spot():
    req = CoachRequest(driverId="maya", trigger="full stop at the stop sign", spokenAlert="Nice stop.",
                       lat=35.7847, lon=-78.6329, speedKmh=0, limitKmh=40, recentEvents=["rolling stop 4 min ago"])
    stats = {"trips": 12, "avgSmoothness": 78, "firstSmoothness": 70, "recentSmoothness": 84,
             "perTripFirst": {"rolling_stop": 4}, "perTripRecent": {"rolling_stop": 1}, "topIssue": "rolling_stop"}
    hotspots = [{"lat": 35.78466, "lon": -78.63293, "drivers": 5, "bad": 20, "topKind": "rolling_stop"},
                {"lat": 36.0, "lon": -79.0, "drivers": 9, "bad": 99, "topKind": "ran_stop"}]  # far away
    p = build_prompt(req, stats, hotspots, [])
    assert "full stop at the stop sign" in p and '"Nice stop."' in p
    assert "limit 25 mph" in p and "rolling stop 4 min ago" in p
    assert "rolling stop per trip: 4 early vs 1 lately" in p
    assert "5 drivers had 20 problems there, mostly rolling stop" in p
    assert "99 problems" not in p


def test_coach_line_is_none_without_gemini_or_on_failure():
    req = CoachRequest(driverId="d", trigger="x")
    assert coach_line(req, None, None, [], []) is None
    def boom(system, msg):
        raise RuntimeError("quota")
    assert coach_line(req, boom, None, [], []) is None
    assert coach_line(req, lambda s, m: ' "Nice and smooth." ', None, [], []) == "Nice and smooth."


def test_coach_endpoint_uses_the_drivers_history(tmp_path):
    seen = {}
    def chat(system, message):
        seen["message"] = message
        return "You stopped fully where most drivers roll it, great work."
    c = TestClient(create_app(db_path=str(tmp_path / "t.db"), models_dir=tmp_path, chat=chat))
    for i in range(3):
        assert c.post("/trips", json=trip(i, "maya", 70 + i, ["rolling_stop"])).status_code == 201
    r = c.post("/coach", json={"driverId": "maya", "trigger": "full stop", "lat": 35.7847, "lon": -78.6329})
    assert r.json() == {"text": "You stopped fully where most drivers roll it, great work."}
    assert "3 past trips" in seen["message"]


def test_driver_stats_endpoint_falls_back_to_local_trips(tmp_path):
    c = TestClient(create_app(db_path=str(tmp_path / "t.db"), models_dir=tmp_path))
    c.post("/trips", json=trip(0, "maya", 81, []))
    body = c.get("/drivers/maya/stats").json()
    assert body["source"] == "local" and body["stats"]["trips"] == 1 and body["stats"]["avgSmoothness"] == 81.0
    assert c.get("/drivers/nobody/stats").json()["stats"] is None
