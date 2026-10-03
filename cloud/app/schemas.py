from typing import Literal, Optional

from pydantic import BaseModel, Field

EventKind = Literal[
    "crash", "erratic_driving", "stop_sign_ahead", "stop_ok", "rolling_stop", "ran_stop"
]


class TripEvent(BaseModel):
    eventId: str
    t: int  # epoch ms, same as the app's DriveEvent
    kind: EventKind
    lat: Optional[float] = None
    lon: Optional[float] = None
    score: Optional[float] = None


class TranscriptTurn(BaseModel):
    t: int
    role: Literal["driver", "assistant"]
    text: str


class Trip(BaseModel):
    tripId: str = Field(min_length=1)
    driverId: str  # anonymous uuid
    start: int
    end: int
    scores: dict[str, float] = {}
    events: list[TripEvent] = []
    features: list[list[float]] = []
    rawWindows: Optional[list[list[float]]] = None  # separate opt-in
    transcript: list[TranscriptTurn] = []


class Issue(BaseModel):
    eventRef: str
    advice: str


class Report(BaseModel):
    headline: str
    scoreExplanation: str
    topIssues: list[Issue]
    praise: str
    nextGoal: str


class ModelInfo(BaseModel):
    version: int
    sha256: str
    url: str
    featureSchemaVersion: int
