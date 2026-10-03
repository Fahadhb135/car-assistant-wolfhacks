"""Push-to-talk coach chat: one normal Gemini text call per question. The model only
explains; it never makes safety decisions (same rules as the Live prompt)."""
from typing import Callable, Optional

from pydantic import BaseModel, Field

ChatFn = Callable[[str, str], Optional[str]]  # (system_instruction, user_message) -> reply

RULES = (
    "You are a calm, friendly driving coach riding along with a new driver. Reply in one or two "
    "short sentences because the driver is on the road. You explain and chat; you never decide "
    "anything about safety, and you must not confirm, dismiss or contradict the app's own alerts. "
    "Never claim anyone is impaired. For emergencies, say to pull over safely and call emergency "
    "services. Only describe what the trip data shows; if you don't know, say so."
)
FALLBACK = "Sorry, I can't answer that right now."


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    recentEvents: list[str] = []  # human-readable lines built by the app
    smoothness: Optional[float] = None
    speedKmh: Optional[float] = None
    elapsedMin: Optional[float] = None


class ChatResponse(BaseModel):
    reply: str


def system_instruction(req: ChatRequest) -> str:
    lines = []
    if req.elapsedMin is not None:
        lines.append(f"Trip time: {round(req.elapsedMin)} min.")
    if req.smoothness is not None:
        lines.append(f"Smoothness score: {round(req.smoothness)}/100.")
    if req.speedKmh is not None:
        lines.append(f"Current speed: {round(req.speedKmh)} km/h.")
    events = req.recentEvents[-8:]
    lines.append("Recent events:\n" + "\n".join(f"- {e}" for e in events) if events else "No events so far this trip.")
    return RULES + "\n\nTrip data:\n" + "\n".join(lines)


def answer(req: ChatRequest, chat: Optional[ChatFn]) -> str:
    if chat is not None:
        try:
            reply = chat(system_instruction(req), req.message)
            if reply and reply.strip():
                return reply.strip()
        except Exception:
            pass
    return FALLBACK


def chat_from_env(api_key: str, model: str) -> ChatFn:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    def call(system: str, message: str) -> Optional[str]:
        resp = client.models.generate_content(
            model=model,
            contents=message,
            config=types.GenerateContentConfig(system_instruction=system, max_output_tokens=120),
        )
        return resp.text

    return call
