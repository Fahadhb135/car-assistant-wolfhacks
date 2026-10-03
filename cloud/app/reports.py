"""Post-trip reports. Gemini writes the prose, but every event reference is checked
against the trip, and a deterministic template covers Gemini being down."""
import json
from typing import Callable, Optional

from .schemas import Issue, Report, Trip

# (trip_json, schema_class) -> Report JSON string. Injected so tests need no network.
GeminiFn = Callable[[str], Optional[str]]

BAD_KINDS = {"crash", "ran_stop", "rolling_stop", "erratic_driving"}

PROMPT = """You are a supportive driving coach for new drivers. Write a short trip report.
Rules: only reference eventRef values that appear in the events list. Never give safety
instructions or claim to detect intoxication. Be specific, kind and concise.

Trip:
"""


def template_report(trip: Trip) -> Report:
    bad = [e for e in trip.events if e.kind in BAD_KINDS]
    ok = [e for e in trip.events if e.kind == "stop_ok"]
    smooth = trip.scores.get("smoothness")
    headline = (
        "Clean drive with no issues flagged."
        if not bad
        else f"{len(bad)} thing{'s' if len(bad) != 1 else ''} to work on this trip."
    )
    return Report(
        headline=headline,
        scoreExplanation=f"Smoothness score: {smooth:.0f}." if smooth is not None else "No smoothness score recorded.",
        topIssues=[Issue(eventRef=e.eventId, advice=_advice(e.kind)) for e in bad[:3]],
        praise=f"{len(ok)} full stop{'s' if len(ok) != 1 else ''} done right." if ok else "Thanks for driving carefully.",
        nextGoal="Come to a complete stop at every stop sign." if bad else "Keep it up.",
    )


def _advice(kind: str) -> str:
    return {
        "crash": "A crash was flagged. Check in with whoever was driving.",
        "ran_stop": "Run-through at a stop sign. Start slowing down earlier.",
        "rolling_stop": "Rolling stop. Come to a full stop and count one second.",
        "erratic_driving": "Unsteady driving detected. Keep both hands on the wheel and look further ahead.",
    }[kind]


def _sanitize(report: Report, trip: Trip) -> Report:
    valid = {e.eventId for e in trip.events}
    return report.model_copy(update={"topIssues": [i for i in report.topIssues if i.eventRef in valid]})


def make_report(trip: Trip, gemini: Optional[GeminiFn]) -> Report:
    if gemini is not None:
        try:
            raw = gemini(PROMPT + trip.model_dump_json(exclude={"features", "rawWindows"}))
            if raw:
                return _sanitize(Report.model_validate(json.loads(raw)), trip)
        except Exception:
            pass  # fall through to the deterministic report
    return template_report(trip)


def gemini_from_env(api_key: str, model: str) -> GeminiFn:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    def call(prompt: str) -> Optional[str]:
        resp = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json", response_schema=Report
            ),
        )
        return resp.text

    return call
