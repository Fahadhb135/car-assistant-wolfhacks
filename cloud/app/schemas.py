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
    tripId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
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


class Hotspot(BaseModel):
    cell: str
    lat: float
    lon: float
    bad: int
    trips: int
    drivers: int
    byKind: dict[str, int]
    topKind: Literal["ran_stop", "rolling_stop", "erratic_driving"]
    demo: bool = False  # a seeded demo driver contributed to this place


class HotspotSnapshot(BaseModel):
    source: str  # "databricks" | "local"
    generatedAt: int
    demo: bool = False  # true when built only from seeded demo drivers
    hotspots: list[Hotspot]
