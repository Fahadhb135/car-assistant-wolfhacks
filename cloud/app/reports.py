"""Post-trip reports. Gemini writes the prose, but every event reference is checked
against the trip, and a deterministic template covers Gemini being down."""
import json
from typing import Callable, Optional

from .gemini_util import call_with_fallback
from .schemas import Issue, Report, Trip, TripEvent

# (trip_json, schema_class) -> Report JSON string. Injected so tests need no network.
GeminiFn = Callable[[str], Optional[str]]

BAD_KINDS = {
    "crash", "ran_stop", "rolling_stop", "erratic_driving",
    "hard_braking", "rapid_acceleration", "harsh_cornering",
}

PROMPT = """You are a supportive driving coach for new drivers. Write a short trip report.
Rules: only reference eventRef values that appear in the events list. A crash event with
confirmed=false is only a possible motion-sensor candidate; never state that a crash occurred.
Hard-braking, rapid-acceleration, harsh-cornering, and erratic-driving events are also experimental
motion candidates, not confirmed violations. Never claim to detect intoxication. Be specific,
kind and concise.

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
        topIssues=[Issue(eventRef=e.eventId, advice=_advice(e)) for e in bad[:3]],
        praise=f"{len(ok)} full stop{'s' if len(ok) != 1 else ''} done right." if ok else "Thanks for driving carefully.",
        nextGoal="Come to a complete stop at every stop sign." if bad else "Keep it up.",
    )


def _advice(event: TripEvent) -> str:
    if event.kind == "crash":
        return (
            "A crash was confirmed. Check in with whoever was driving."
            if event.confirmed
            else "A possible crash was flagged by the motion sensor. Review what happened."
        )
    return {
        "ran_stop": "Run-through at a stop sign. Start slowing down earlier.",
        "rolling_stop": "Rolling stop. Come to a full stop and count one second.",
        "erratic_driving": "Unsteady driving was flagged. Keep both hands on the wheel and look further ahead.",
        "hard_braking": "Firm braking was flagged. Leave more space and begin braking earlier.",
        "rapid_acceleration": "Quick acceleration was flagged. Ease onto the accelerator.",
        "harsh_cornering": "A sharp corner was flagged. Slow before the turn and steer smoothly.",
    }[event.kind]


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


def gemini_from_env(api_key: str, models: list[str]) -> GeminiFn:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    def call(prompt: str) -> Optional[str]:
        def one(model: str) -> Optional[str]:
            return client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json", response_schema=Report
                ),
            ).text

        return call_with_fallback(models, one)

    return call
