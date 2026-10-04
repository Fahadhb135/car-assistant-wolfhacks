from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field

# Any well-formed kind is accepted (the app adds kinds over time: traffic_light_ahead, highway_*,
# hotspot_ahead, ...). Rejecting an unknown kind would lose the whole trip; consumers (reports,
# hotspots, Databricks) only act on the kinds they know.
EventKind = Annotated[str, Field(pattern=r"^[a-z][a-z_]{0,39}$")]


class TripEvent(BaseModel):
    eventId: str
    t: int  # epoch ms, same as the app's DriveEvent
    kind: EventKind
    lat: Optional[float] = None
    lon: Optional[float] = None
    score: Optional[float] = None
    evidence: Optional[dict[str, float]] = None
    # Heuristic crash candidates remain explicitly unconfirmed through storage and reporting.
    confirmed: Optional[bool] = None


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
