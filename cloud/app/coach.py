"""Live coaching: one on-the-spot Gemini text call per notable moment of a drive. The phone sends the
moment (what happened, where, how fast, the limit, recent events); this adds the driver's history
and the crowd data around that spot (both from Databricks), and Gemini writes one short sentence
that the phone speaks with its built-in voice. It never makes safety decisions: the app's fixed
alerts already played, and this only adds a personal, specific remark."""
import math
from typing import Optional

from pydantic import BaseModel, Field

from .chat import ChatFn

RULES = (
    "You are a calm, encouraging driving coach riding along with a new teen driver. Something just "
    "happened on the drive. Reply with ONE short spoken sentence (at most 18 words) that is specific "
    "to this moment and place: use the driver's history and what other drivers do at this spot when "
    "it is relevant. The driver already heard the app's own alert, so never repeat it word for word, "
    "and never contradict it. Only comment on what has actually happened: if the moment is a heads-up "
    "about something ahead, give a brief specific heads-up and never praise or criticise it before it "
    "happens. Praise real improvement, give one concrete tip otherwise. Never use a name for the "
    "driver or yourself. No emojis, "
    "no lists, no numbers with decimals. Never claim anyone is impaired; never give emergency "
    "instructions (the app handles safety)."
)
NEARBY_M = 300


class CoachRequest(BaseModel):
    driverId: str = Field(min_length=1, max_length=100)
    trigger: str = Field(min_length=1, max_length=300)  # human-readable line built by the app
    spokenAlert: Optional[str] = Field(default=None, max_length=300)
    lat: Optional[float] = None
    lon: Optional[float] = None
    speedKmh: Optional[float] = None
    limitKmh: Optional[float] = None
    road: Optional[str] = Field(default=None, max_length=120)
    recentEvents: list[str] = []
    elapsedMin: Optional[float] = None
    smoothness: Optional[float] = None


class CoachResponse(BaseModel):
    text: Optional[str]  # None: nothing to say (Gemini unavailable); the phone stays quiet


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    k = math.pi / 180
    x = (lon2 - lon1) * k * math.cos((lat1 + lat2) / 2 * k)
    return math.hypot(x, (lat2 - lat1) * k) * 6_371_000


def _history_line(stats: Optional[dict]) -> str:
    if not stats or not stats.get("trips"):
        return "Driver history: this is one of their first recorded drives."
    parts = [f"{stats['trips']} past trips"]
    if stats.get("avgSmoothness") is not None:
        parts.append(f"average smoothness {round(stats['avgSmoothness'])}/100")
    if stats.get("firstSmoothness") is not None and stats.get("recentSmoothness") is not None:
        parts.append(f"first trips {round(stats['firstSmoothness'])}, latest trips {round(stats['recentSmoothness'])}")
    first, recent = stats.get("perTripFirst") or {}, stats.get("perTripRecent") or {}
    for kind in sorted(set(first) | set(recent)):
        if kind == "stop_ok":
            continue
        parts.append(f"{kind.replace('_', ' ')} per trip: {first.get(kind, 0)} early vs {recent.get(kind, 0)} lately")
    if stats.get("topIssue"):
        parts.append(f"main habit to work on: {stats['topIssue'].replace('_', ' ')}")
    return "Driver history (Databricks): " + "; ".join(parts) + "."


def _place_lines(req: CoachRequest, hotspots: list[dict], risky: list[dict]) -> list[str]:
    if req.lat is None or req.lon is None:
        return []
    lines = []
    for h in hotspots:
        d = _distance_m(req.lat, req.lon, h["lat"], h["lon"])
        if d <= NEARBY_M:
            lines.append(f"Crowd hotspot {round(d)} m away: {h['drivers']} drivers had {h['bad']} problems there, "
                         f"mostly {h['topKind'].replace('_', ' ')}.")
    for r in risky:
        d = _distance_m(req.lat, req.lon, r["lat"], r["lon"])
        if d <= NEARBY_M and r.get("badEvents"):
            lines.append(f"Risky spot {round(d)} m away: {r['badEvents']} problem events "
                         f"({r.get('rollingStops', 0)} rolling stops, {r.get('ranStops', 0)} ran stops).")
    return lines[:3]


def build_prompt(req: CoachRequest, stats: Optional[dict], hotspots: list[dict], risky: list[dict]) -> str:
    lines = [f"What just happened: {req.trigger}"]
    if req.spokenAlert:
        lines.append(f'The app already said: "{req.spokenAlert}"')
    where = []
    if req.road:
        where.append(f"on {req.road}")
    if req.lat is not None and req.lon is not None:
        where.append(f"at {req.lat:.5f},{req.lon:.5f}")
    if req.speedKmh is not None:
        where.append(f"speed {round(req.speedKmh * 0.621)} mph")
    if req.limitKmh is not None:
        where.append(f"limit {round(req.limitKmh * 0.621)} mph")
    if where:
        lines.append("Now: " + ", ".join(where) + ".")
    if req.elapsedMin is not None:
        lines.append(f"Trip time: {round(req.elapsedMin)} min.")
    if req.smoothness is not None:
        lines.append(f"This trip's smoothness so far: {round(req.smoothness)}/100.")
    if req.recentEvents:
        lines.append("Earlier this trip:\n" + "\n".join(f"- {e}" for e in req.recentEvents[-6:]))
    lines.append(_history_line(stats))
    lines.extend(_place_lines(req, hotspots, risky))
    return "\n".join(lines)


def coach_line(req: CoachRequest, chat: Optional[ChatFn], stats: Optional[dict],
               hotspots: list[dict], risky: list[dict]) -> Optional[str]:
    if chat is None:
        return None
    try:
        reply = chat(RULES, build_prompt(req, stats, hotspots, risky))
    except Exception:
        return None
    reply = (reply or "").strip().strip('"')
    return reply or None
