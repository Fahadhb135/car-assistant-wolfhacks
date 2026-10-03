# Car Assistant (WolfHacks)

An AI driving coach built on the **STMicroelectronics SensorTile.box**. A dash-mounted sensor streams motion data over Bluetooth to a phone. The phone app runs the ML on-device, detects crashes and erratic driving, tracks the car against live map data, and a voice coach speaks up when you need it ("Stop sign ahead, start slowing down"). After each trip, a small Python cloud service analyzes the drive with Gemini and feeds Databricks for long-term analysis and model retraining.

**Design rule:** anything that must react while you are driving runs on the phone. Anything that can wait until the trip ends runs in the Python cloud service.

Track: **Applied AI Hardware+**. Collect, analyze and act on real sensor data; detect patterns/anomalies; deploy ML to edge/IoT devices.

> Status: the Expo app can select a STEVAL-MKBOXPRO, decode its DATALOG2 v3.4 accelerometer/gyroscope stream, run the pure-TypeScript IMU pipeline, and route experimental crash/swerve candidates into the live drive event, voice, UI, and trip paths. Thresholds and provisional scale factors still require physical validation (see [the IMU pipeline guide](docs/imu-pipeline.md)). Ending a drive keeps a retryable in-app trip and posts it to the FastAPI service, which starts Gemini report generation and Databricks synchronization. The location modules, voice alert queue, bundled ElevenLabs audio, streamed push-to-talk Gemini chat, crowd hotspots, cloud service, and Databricks pipeline are implemented; replay mode runs the coaching and voice path offline on a bundled route.

---

## 1. Goals

1. Detect **crashes** and **erratic / impaired driving** (swerving, weaving, harsh braking) from IMU data.
2. Act as a **live coach** for new and younger drivers: stop signs, traffic lights, merging onto and exiting highways, speed, smoothness.
3. Speak alerts aloud (ElevenLabs) and let the driver talk back hands-free (Gemini Live).
4. Run **all real-time detection on the edge (the phone)** so alerts have no network hop and work offline.
5. Use the cloud for what it is good at: Gemini trip analysis, long-term trends in Databricks, and retraining the model on pooled drives, then shipping the new model back to the phone.

### Non-goals
- We do **not** claim to detect intoxication. See [Section 6](#6-ml-design).
- Not a replacement for emergency services or a certified safety device.
- No app-store release, user accounts or billing.
- The cloud service is never in the live safety path. If it is down, driving alerts still work.

---

## 2. Architecture

The system has two halves.

- **Real-time half, fully React Native on the phone.** BLE, signal processing, crash and erratic-driving detection, the stop-sign coach, voice alerts and the live Gemini voice chat. No application server is involved.
- **Post-trip half, Python in the cloud.** A small FastAPI service receives finished trips, runs Gemini analysis, writes to Databricks, and publishes retrained models back to the app.

```
 SensorTile.box                       Phone (React Native app)
┌──────────────┐  BLE   ┌───────────────────────────────────────────────────────┐
│ accel / gyro │───────▶│ BLE client (ble-plx)                                  │
│ (stock ST    │        │   │                                                   │
│  firmware)   │        │   ▼                                                   │
└──────────────┘        │ Signal pipeline: calibrate → window → features        │
                        │   ├─▶ Crash detector (thresholds)                     │
                        │   └─▶ Erratic-driving model (ONNX / TS, downloaded    │
                        │        from cloud, bundled default)                   │
                        │ GPS (background location) ─▶ Tile cache ─▶ Stop-sign  │
                        │                              (Overpass)    coach      │
                        │ Event bus ─▶ Alert queue ─▶ ElevenLabs TTS / push     │
                        │ Gemini Live voice chat (direct, short-lived token)    │
                        │ Local trip store (SQLite) ─▶ upload queue             │
                        └───────────┬───────────────────────────▲───────────────┘
                                    │ trip upload (wifi/opt-in) │ new model, token,
                                    ▼                           │ trip reports
                        ┌───────────────────────────────────────┴───────────────┐
                        │ Python cloud service (FastAPI)                        │
                        │  • POST /trips            ingest + validate           │
                        │  • Gemini post-trip analysis / coaching summaries     │
                        │  • mint Gemini Live ephemeral token                   │
                        │  • serve latest model + version                       │
                        └───────────────┬───────────────────────────────────────┘
                                        ▼
                        ┌───────────────────────────────────────────────────────┐
                        │ Databricks: Delta tables ─▶ trends, risky locations,  │
                        │ dashboards ─▶ retrain anomaly model ─▶ export ONNX    │
                        └───────────────────────────────────────────────────────┘

 Offline (laptop):  ml/  Python notebooks ─▶ first model trained on our recorded drives ─▶ bundled in app
```

### Components

| Component | Tech | Responsibility |
|---|---|---|
| Sensor | SensorTile.box, **stock ST firmware** | Stream accelerometer + gyroscope over BLE |
| Mobile app | React Native (Expo dev build), `react-native-ble-plx`, `expo-location`, `expo-av`, `expo-sqlite` | Everything at runtime: BLE, signal processing, inference, coaching, UI, audio, storage |
| On-device ML | ONNX via `onnxruntime-react-native`, or plain TypeScript for a small model | Erratic-driving inference |
| Training (offline) | Python, NumPy, scikit-learn, Jupyter | Feature design, first model, evaluation, export |
| Cloud service | Python, FastAPI, hosted (free tier or laptop on hotspot for the demo) | Trip ingest, Gemini post-trip analysis, token minting, model distribution |
| Long-term analysis | Databricks (Delta tables, notebooks, dashboards) | Trends, risky-location analysis, pooled-drive retraining, model export |
| Map data | OpenStreetMap Overpass API (called from the phone) | Stop signs, traffic lights, and highway/ramp geometry with speed limits, in 1-mile tiles |
| Voice out | ElevenLabs TTS | Spoken alerts and coaching |
| Voice in / chat | Gemini Live API (phone connects directly) | Hands-free conversation and live transcript |
| Post-trip analysis | Gemini API (called from the cloud service) | Trip reports, coaching summaries, weekly trends in plain language |

Notes:
- Expo Go cannot do BLE. The app needs a **dev build** (`expo run:ios` / `run:android` or EAS).
- **Keys:** the Gemini API key lives only on the cloud service. The phone gets a short-lived Gemini Live token from it. ElevenLabs is called from the phone for latency, with its key in app config for the hackathon; route it through the service if time allows.
- Confirm that the Gemini Live SDK version supports ephemeral tokens before relying on this. If not, proxy the Live session through the cloud service instead.

---

## 3. Data flow

1. **Sensor to phone.** The SensorTile.box streams IMU packets over BLE. The app parses ST's characteristic format into `{t, ax, ay, az, gx, gy, gz}`.
2. **Calibrate.** At the start of a trip, estimate the gravity vector and rotate samples into vehicle axes (forward / lateral / vertical).
3. **Crash check.** Every sample goes through the threshold crash detector (see 6.1). The IMU pipeline (`src/core/imu/`) currently emits an experimental `crash_candidate`; `src/core/events/fromImu.ts` maps it to a `crash` event so the voice layer can alert. Real-data tuning is follow-up work.
4. **Window and infer.** The current implementation uses timestamp windows and a deterministic swerve heuristic to emit `swerve_candidate`, which the same adapter maps to `erratic_driving`. The planned on-device erratic-driving model can later consume the same features after real drives are collected and evaluated.
5. **Location coach.** GPS plus heading are matched against cached map data (see Section 7). Emits `stop_sign_ahead`, `traffic_light_ahead`, `highway_entering` and `highway_exiting` events (implemented), and stop-compliance events `stop_ok` / `rolling_stop` / `ran_stop` (planned).
6. **Speak.** Events go to a priority queue, then ElevenLabs (cached audio for fixed phrases), plus a local notification and on-screen banner.
7. **Talk back.** The driver can speak to the assistant through Gemini Live ("how was that turn?"). The phone fetches a short-lived token from the cloud service and connects directly. Trip context is passed in so answers are specific. Transcripts are stored with the trip.
8. **Store.** Live IMU events and a score are retained in the in-app trip store. Durable storage, location events, features and chat transcripts still need to be added to live-trip serialization.

**Post-trip (cloud):**

9. **Upload.** When the trip ends, the app posts its supported events and score to `POST /trips` when `EXPO_PUBLIC_API_URL` is configured. A failed upload remains retryable for the current app session.
10. **Analyze.** The cloud service sends the trip summary to Gemini, which returns a plain-language report and coaching tips. The report goes back to the phone and is shown and read aloud.
11. **Persist.** The service writes the trip to Databricks Delta tables.
12. **Learn.** Databricks jobs compute trends and risky locations, power dashboards, and periodically retrain the anomaly model on pooled drives. The exported ONNX model is versioned and served by the cloud service.
13. **Update.** On launch, the app checks the model version, downloads a newer model if available, validates it against bundled test vectors, and only then switches to it. The bundled model is always the fallback.

Live detection, alerts and the stop-sign coach need no network. The network is used for Overpass tiles, ElevenLabs, the Gemini Live session, and the post-trip upload and model update.

---

## 4. Feature list

### Core (must ship)
- BLE connect/reconnect to the SensorTile.box with live signal and battery indicator
- **Crash detection** (on-device thresholds)
- **Swerve / erratic driving detection** with anomaly score and live "smoothness" gauge
- **Stop-sign coaching**: warn on approach, flag rolling or missed stops
- **Traffic-light heads-up**: "Traffic light ahead" on approach (OSM `highway=traffic_signals`; we cannot see the light's color)
- **Highway merge and exit coaching**: on an on-ramp, "speed up to match traffic" toward the highway's limit; on an off-ramp, "slow down" toward the ramp's limit
- Spoken alerts via ElevenLabs
- In-app alert feed and notifications
- **Replay mode**: play back a recorded drive (sensor + GPS) in place of live input (our demo safety net)

### Strong stretch
- Gemini Live voice assistant with transcript
- Post-drive **trip report** and driver score (harsh brakes, swerves, stop compliance, smoothness), narrated by Gemini
- Crash flow: 10 s "Are you OK?" countdown by voice, then auto-text emergency contact with location
- Speed-limit awareness from OSM `maxspeed` tags, with gentle over-limit nudges
- Fatigue / drowsiness drift: slow lane-drift pattern plus trip duration, "take a break" prompt
- Distracted-driving hint: phone pickup detected by the phone's own IMU while moving

### Ideas for new/young drivers
- Coaching mode with calmer, more verbose voice and tips (following distance, smooth braking)
- Guided practice routes with per-turn feedback ("good brake, a bit sharp on that corner")
- Parent view: weekly score and trends from the Databricks dashboard, no raw location sharing by default, opt-in only
- Gamified streaks and badges for clean stops and smooth drives
- Teen curfew / geofence alerts

### Extra ideas
- School zone and railroad crossing warnings from OSM tags (traffic signals are now core, see above)
- Risky-area learning: heat map of where the driver brakes hard
- Insurance-style score export
- Raspberry Pi gateway variant: Pi receives BLE and runs the model (hits the "Raspberry Pi" tech requirement)
- MQTT or similar as an alternative IoT ingest path into the cloud service, for fleet-style trip logging
- Cross-driver insights in Databricks: where do new drivers most often roll stops, at what time of day, after how long behind the wheel
- Weekly Gemini "coach's letter" per driver built from Databricks trends
- Multi-language coaching via ElevenLabs multilingual voices
- SensorTile.box microphone: detect horns, sirens or tire screech as extra context
- Pothole detection from vertical accel spikes, tagged to GPS

---

## 5. Hardware & firmware

- **SensorTile.box**, stock ST BLE sensor-streaming firmware. No flashing needed.
- First task: verify the stream with ST's **STBLE Sensor** app, then reproduce it in our parser.
- Mount: fixed to the car (dash/cupholder), aligned roughly to the vehicle axes. Gravity vector auto-calibrates orientation at the start of a trip.
- Open question: achievable stable sample rate over BLE with stock firmware. Plan for about 25 to 100 Hz and design features around the lower bound.

---

## 6. ML design

### 6.1 Crash detection (edge)
- Rule-based: acceleration magnitude above about 4 g for a few samples, optionally followed by near-zero motion.
- Runs on every sample, with no model needed.
- A short confirmation window cuts false positives (potholes, dropped sensor) before escalating to the "Are you OK?" flow. The 4 g figure is an assumption to tune on real data.

### 6.2 Swerve / erratic driving (edge model)
We have no labeled "drunk" data and cannot ethically collect it. So we **do not claim intoxication detection**. The current code emits experimental `swerve_candidate` events from configurable heuristics; the model described below is a later phase after real-data collection and evaluation.

- **Features per window:** lateral accel stats, yaw-rate variance, zero-crossing rate of yaw (weaving frequency), jerk, longitudinal accel spikes, dominant frequency of lateral motion.
- **Model:** unsupervised anomaly detection (Isolation Forest baseline; optional small autoencoder). The first version is trained **offline in Python** on normal driving we record ourselves. Later versions are retrained in Databricks on pooled opted-in drives and delivered over the air.
- **Deployment:** export to ONNX and run with `onnxruntime-react-native`. Fallback: re-implement feature extraction and a small model (trees or logistic regression) directly in TypeScript. Feature code is written once per language and checked against the Python version with shared test vectors, so the two cannot drift.
- **Validation:** staged, deliberate weaving laps in a safe empty lot as the positive class. Report precision/recall on that, and say plainly what it measures.
- **Output:** a continuous erratic-driving score plus a thresholded event with hysteresis (avoid flapping).

### 6.3 Edge deployment story
Both detectors run on the phone, with no server in the loop. The model is trained in Python, shipped inside the app, and updated over the air from the cloud service after Databricks retraining. Every downloaded model is checked against bundled test vectors before it is activated. Stretch: a Raspberry Pi gateway running the same model.

### 6.4 Evaluation
- Record 5+ normal drives and several staged weave sessions.
- Hold out whole drives (not random windows) for testing.
- Track false alarms per hour of normal driving, the number that matters to users.
- Measure on-device inference time per window and report it.

---

## 7. Location coaching (stop signs, traffic lights, highways)

**Tiling.** Instead of querying per GPS fix, the app fetches map data in **~1-mile tiles** for good latency and fewer API calls (`src/core/location/tiles.ts`).

1. Tiles are fixed 1-mile bands of latitude; each band picks its own longitude step so tiles stay square. Keys look like `2472:-4408`.
2. One Overpass query per tile (`src/core/location/overpass.ts`) fetches everything the coach needs:
   - stop signs: nodes `highway=stop`
   - traffic lights: nodes `highway=traffic_signals`
   - highways and ramps: ways `highway=motorway` and `highway=motorway_link`, with geometry, `oneway`, `maxspeed`, `ref` and `name`
3. **Cache** (`src/integrations/location/tileCache.ts`), in order: memory, then persistent store, then Overpass, then a stale stored copy, then bundled demo-route tiles. Stored tiles carry a schema version so tiles from an older build are refetched rather than misread.
4. **Prefetch:** when the point 25% of a tile ahead along the heading falls in another tile, fetch that tile. The tiles under the look-ahead cone are loaded too, since a sign 150 m ahead can sit across a tile border.
5. **The live path never waits on the network:** call `cache.update(fix)` on every fix without awaiting it, then read `cache.featuresAhead(fix)` and `cache.roadsNear(fix)` synchronously and pass them to `LocationCoach.update(fix, ahead, roads)` (`src/core/location/coach.ts`).

**Stop signs and traffic lights ahead** (`featureFilter.ts`): keep features within 200 m and ±35° of the heading. When OSM gives an absolute `direction` (degrees or cardinal), drop features that face a cross street; we read it as the way the sign faces, so a north-facing sign applies to southbound cars. `forward`/`backward` and untagged features are kept, and most OSM stop signs are untagged.

**Announcements:** `stop_sign_ahead` or `traffic_light_ahead` fires once at about 150 m. Features of the same kind within 40 m of an announced one count as the same intersection and are not announced again, since an all-way stop is often mapped as one node per approach. A feature can be announced again after it has been out of view for 30 s.

**Highway entry and exit** (`roads.ts` + `coach.ts`):
- Map-match each fix to the nearest `motorway` / `motorway_link` segment within 25 m whose direction of travel is within 40° of the car's heading. The heading check separates a ramp from the opposite carriageway or a parallel road.
- Each fix is classed as `local`, `ramp` or `highway`. A change only counts after 3 consecutive fixes, so GPS jitter at a ramp's gore point doesn't flip-flop.
- `local → ramp` emits **`highway_entering`**. The target is the `maxspeed` of the nearest highway within 1 km, or 55 mph if untagged. Advice is `speed_up` (severity `warn`) if the car is more than 10 mph under the target.
- `highway → ramp` emits **`highway_exiting`**. The target is the ramp's `maxspeed`, or 35 mph if untagged. Advice is `slow_down` (severity `warn`) if the car is more than 10 mph over the target. Highway-to-highway interchange ramps also trigger this, which is reasonable because they are usually slower and curved.
- Only `motorway` counts as a highway. `trunk_link` is also used for ordinary turn lanes at signalized intersections and would cause false alerts. Expressways mapped as `trunk` are not covered yet.

**Stop compliance (planned, not built yet):** a state machine per sign:
- `approaching` at about 150 m: "Stop sign ahead, start slowing down." (this announcement is built)
- `braking check` at about 60 m: is speed trending down fast enough?
- `at sign` within about 10 m: did speed reach below about 2 mph (stopped) or just slow?
- Emit `stop_ok`, `rolling_stop` or `ran_stop` and say so.

**Caveats we design for:**
- **GPS jitter:** smooth with a short filter; highway class changes need 3 agreeing fixes.
- **Stop signs for cross streets:** OSM signs that apply to intersecting roads are filtered with the `direction` tag and bearing where it exists. Untagged ones remain a known limitation.
- **Overpass rate limits and downtime:** handled with the cache, a 30 s back-off per failed tile, three mirrors, and fallback to bundled demo-route data. In testing, all public mirrors sometimes timed out at once. Pre-fetch the demo route's tiles before the demo.
- **User-Agent:** `overpass-api.de` returns HTTP 406 to requests without a descriptive `User-Agent`, so the client always sends one.

**Dev tools** (run with `npx tsx`; tiles are cached in `.cache/tiles/`):
- `scripts/try-location.mts <lat> <lon> <heading> [driveMeters] [speedMph]`: shows a tile's contents and the features ahead, and simulates a straight drive through the real coach.
- `scripts/try-highway.mts <lat> <lon>`: finds real on-ramps and off-ramps in a tile and drives them through the coach. Example: `35.8028 -78.7255` (I-40 / Wade Ave, Raleigh).
- `scripts/verify-signs.mts <lat> <lon> <heading> [--all] [--lights]`: cross-checks OSM stop signs or traffic lights against Mapillary's computer-vision detections. Needs a free `MAPILLARY_TOKEN` in `.env`. Without one, it prints Street View links.

---

## 8. Voice layer

- **ElevenLabs** speaks every alert. Pre-generate and bundle audio for fixed phrases ("Stop sign ahead") so common alerts play instantly with no network. Use streaming TTS only for dynamic text.
- **Priority queue:** crash > stop-sign > highway merge/exit > traffic light > swerve > coaching tips. Higher priority interrupts lower. Rate-limit repeats.
- **Gemini Live** provides the live voice conversation and transcript. The phone connects directly using a short-lived token minted by the cloud service, so the key never ships in the app and there is no extra proxy hop. We give it trip context (recent events, score) as system context so answers are specific.
- **Gemini (post-trip)** runs in the cloud service. It turns a trip's events and scores into a readable report and coaching tips, and later into weekly trend summaries using Databricks aggregates.
- Never let the LLM make safety decisions. Detection is deterministic code and ML. The LLM explains and chats.
- If the network is down, alerts fall back to bundled phrases and the device's built-in text-to-speech.

---

## 9. Interfaces

### In-app (real-time path)

No network API. Modules talk over an in-app event bus.

```ts
type Sample = { t: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number };
// speed in m/s, heading in degrees from true north; -1 when unknown (expo-location)
type GpsFix = { t: number; lat: number; lon: number; speed: number; heading: number };

type DriveEvent =
  | { kind: 'crash'; severity: 'critical'; confirmed: boolean }
  | { kind: 'erratic_driving'; severity: 'warn'; score: number }
  | { kind: 'stop_sign_ahead' | 'traffic_light_ahead'; severity: 'info'; t: number; distanceM: number; featureId: number }
  | { kind: 'highway_entering' | 'highway_exiting'; severity: 'info' | 'warn'; t: number;
      speedMps: number; targetSpeedMps: number; targetIsDefault: boolean;
      advice: 'speed_up' | 'slow_down' | 'ok'; road?: string }
  | { kind: 'stop_ok' | 'rolling_stop' | 'ran_stop'; severity: 'info' | 'warn' };

// The IMU pipeline (src/core/imu) emits its own `ImuEvent` candidates (crash_candidate, swerve_candidate)
// with confidence and evidence; src/core/events/fromImu.ts maps them into this union.
```

`GpsFix` and the location events are implemented in `src/core/location/types.ts` and `src/core/location/events.ts` (`LocationEvent`). They move into `src/core/events/types.ts` when that shared module is created. `featureId` is the OSM node id. `road` is the highway's `ref` or `name` (e.g. "I 440"). Speeds are m/s, and the voice layer converts them for speech.

Module boundaries: `ble/` → `pipeline/` (calibrate, window, features) → `detectors/` (crash, erratic) and `location/` (tiles, coach) → `events/` bus → `voice/` and `ui/`. Replay mode swaps `ble/` and GPS for a recorded-file source, so everything downstream is identical in live and replay. A separate `sync/` module owns the upload queue and model updates, and never blocks the live path.

### Cloud service (post-trip path, draft)

| Endpoint | Purpose |
|---|---|
| `POST /trips` | Upload a finished trip (events, scores, GPS trace, summary features, optional raw IMU windows). Idempotent by trip id. |
| `GET /trips/{id}/report` | Gemini-generated report and coaching tips for a trip |
| `POST /live-token` | Mint a short-lived Gemini Live token for the phone |
| `GET /model/latest` | Current model version, checksum and download URL |
| `GET /health` | Liveness |

```json
// POST /trips
{"tripId":"uuid","driverId":"anon-uuid","start":1730000000,"end":1730001800,
 "scores":{"smoothness":82,"stopCompliance":0.75},
 "events":[{"t":1730000400,"kind":"rolling_stop","lat":43.47,"lon":-80.54}],
 "features":[...], "rawWindows":null}
```

Driver ids are anonymous. Upload is opt-in, wifi-only by default, and queued with retry when offline.

---

## 10. Mobile repository structure

This repository contains one Expo React Native mobile application, so the Expo project lives at the repository root rather than under `apps/mobile/`. Expo Router owns the root `app/` directory; route files stay thin and delegate implementation to `src/`.

```text
car-assistant-wolfhacks/
├── app/                         # Expo Router routes only
│   ├── _layout.tsx
│   ├── index.tsx                # Home, drive start and replay entry
│   ├── drive.tsx                # Active driving screen (currently mock data)
│   ├── diagnostics.tsx          # BLE/GATT developer diagnostics
│   ├── settings.tsx
│   └── trips/
│       └── [id].tsx             # Trip report
│
├── src/
│   ├── core/                    # Pure TypeScript; no React Native APIs
│   │   ├── sensors/
│   │   │   ├── types.ts
│   │   │   ├── SensorSource.ts
│   │   │   ├── calibration.ts
│   │   │   ├── windowing.ts
│   │   │   └── features.ts
│   │   ├── detection/
│   │   │   ├── crashDetector.ts
│   │   │   └── erraticDrivingDetector.ts
│   │   ├── events/
│   │   │   ├── types.ts
│   │   │   └── priority.ts
│   │   └── location/
│   │       ├── types.ts             # GpsFix, RoadFeature, RoadWay
│   │       ├── events.ts            # LocationEvent (part of DriveEvent)
│   │       ├── geo.ts               # Distance, bearing, destination
│   │       ├── tiles.ts             # 1-mile tiles, prefetch
│   │       ├── overpass.ts          # Tile query + response parsing
│   │       ├── featureFilter.ts     # Stop signs / lights ahead of the car
│   │       ├── roads.ts             # Map-matching to highway / ramp
│   │       └── coach.ts             # LocationCoach: announcements, merge/exit
│   │
│   ├── integrations/            # Native devices and external services
│   │   ├── bluetooth/
│   │   │   ├── BleSensorSource.ts
│   │   │   ├── packetDecoder.ts
│   │   │   ├── permissions.ts
│   │   │   └── uuids.ts
│   │   ├── location/
│   │   │   ├── overpassClient.ts    # Overpass mirrors, timeout, User-Agent
│   │   │   └── tileCache.ts         # Memory/store/network/bundled tile layers
│   │   ├── audio/
│   │   ├── storage/
│   │   └── backend/             # Client for a remote backend; not server code
│   │
│   ├── features/                # User-facing mobile features
│   │   ├── device-setup/
│   │   ├── driving-session/
│   │   ├── alert-feed/
│   │   └── trip-summary/
│   │
│   ├── replay/
│   │   ├── ReplaySensorSource.ts
│   │   └── replayController.ts
│   ├── components/              # Shared visual components
│   ├── hooks/                   # Shared React hooks
│   ├── state/                   # Global and driving-session state
│   └── config/                  # Public runtime configuration
│
├── assets/
│   ├── images/
│   ├── icons/
│   └── audio/                   # Bundled alert phrases
├── fixtures/
│   └── drives/                  # Small sanitized replay recordings
├── docs/
│   ├── bluetooth.md
│   ├── event-schema.md
│   └── demo.md
├── scripts/                     # Development and data-conversion utilities
│   ├── try-location.mts         # Location dev tools, see Section 7
│   ├── try-highway.mts
│   └── verify-signs.mts
├── app.config.ts
├── eas.json
├── expo-env.d.ts
├── package.json
├── tsconfig.json
├── eslint.config.js
├── .env.example
└── README.md
```

Boundary rules:

- `app/` and `src/` are both part of the mobile application; neither is a secure backend.
- `app/` contains navigation entry points only. Business logic belongs in `src/`.
- `src/core/` remains platform-independent so detection logic can be unit-tested and reused by live BLE and replay inputs.
- `src/integrations/` owns React Native, Expo, Bluetooth, storage, network and other platform APIs.
- Both `BleSensorSource` and `ReplaySensorSource` implement the same `SensorSource` contract so downstream processing is identical.
- Secrets such as Gemini, ElevenLabs and Databricks credentials must never be stored in `app/`, `src/` or `EXPO_PUBLIC_*` variables.
- Python cloud, ML-training and Databricks code will be added only when that work begins, either as explicit top-level services or in separate repositories.

---

## 11. Demo plan

We can't drive drunk or crash a car on stage, so the demo is built to be safe and reliable.

1. **Live:** hold the SensorTile.box, shake/weave it to trigger swerve and crash alerts in real time, with voice and notifications. Works even in airplane mode, since detection is on-device.
2. **Replay:** a pre-recorded drive (sensor + GPS) plays through the real pipeline for stop-sign coaching.
3. **Post-trip:** the replayed trip uploads to the cloud service, Gemini returns a report that the app reads aloud, and a Databricks dashboard shows trends across several pre-loaded trips.
4. **Fallbacks:** replay mode if BLE fails, bundled audio if ElevenLabs is slow or offline, pre-fetched tiles if Overpass is down, and a pre-generated report plus dashboard screenshots if the cloud or venue wifi is down. Live detection never depends on the cloud.

**Definition of done for the demo:** BLE stream visible live, one real-time swerve alert, one crash alert, one spoken stop-sign warning from replay, one Gemini trip report, one Databricks trend view.

---

## 12. Risks & open questions

| Risk | Mitigation |
|---|---|
| BLE sample rate / packet format with stock firmware | Verify with STBLE Sensor app first; design for low rate |
| Expo dev-build and signing time | Set up on day one before any features |
| ONNX runtime in React Native is fiddly | Keep the TypeScript fallback model; shared test vectors between Python and TS |
| JS thread jitter under load | Keep per-window work small; batch BLE reads; measure inference time |
| Drunk-detection credibility | Frame as erratic-driving detection; be explicit about validation |
| ElevenLabs key inside the app | Acceptable for a demo; route through the cloud service before any real release. Gemini keys stay server-side |
| Gemini Live ephemeral tokens may not be supported by our SDK version | Check early; fall back to proxying the Live session through the cloud service |
| Cloud hosting and Databricks setup time | Time-box it; build it after the real-time path works; pre-load demo trips |
| Venue wifi unreliable | Cloud is only post-trip; pre-generated report and dashboard screenshots as backup |
| Model update bugs (bad or mismatched model downloaded) | Version and checksum; validate with bundled test vectors before activating; keep the bundled model as fallback |
| Pooled data bias (few drivers, one car) | Say so in the demo; treat retraining as a pipeline demonstration, not a validated improvement |
| Background BLE/GPS limits on iOS/Android | Demo with the app foregrounded; test background behavior early |
| Safety/legal | Passenger operates the app; the app is a coach, not a certified device; no distraction-inducing UI while moving |
| Privacy | Detection data stays on the phone; trip upload is opt-in, wifi-only by default, with anonymous driver ids; raw IMU and GPS upload is a separate opt-in |

**Open questions**
- Exact BLE characteristic layout and max stable rate on the stock firmware?
- iOS, Android or both for the demo device?
- ONNX or pure TypeScript for the model, once we see inference time on a real phone?
- Do we want the Raspberry Pi gateway for the hardware-track checkbox?

---

## 13. Build order

1. Dev build + BLE connection + raw IMU on screen
2. Record data; write the replay source
3. Signal pipeline (calibration, windowing, features) + crash detector
4. Train the anomaly model in Python; export; run it on the phone
5. Overpass tiling, stop-sign / traffic-light announcements, highway merge/exit coaching (done), stop-sign compliance state machine
6. ElevenLabs alerts + notifications
7. Gemini Live conversation (direct token, or proxied if tokens are unsupported)
8. Cloud service: trip ingest, Gemini trip report, token minting
9. Databricks: Delta tables, trend dashboard, retraining job, ONNX export, model download in the app
10. Polish, demo script, fallbacks

Steps 1 to 6 are the product and must work with no cloud. Steps 7 to 9 add to it and can be cut from the bottom if time runs out.

---

## 14. Tech summary

React Native (Expo dev build) · React Native Paper · TypeScript · `react-native-ble-plx` · `onnxruntime-react-native` · SQLite · Python (FastAPI cloud service; NumPy and scikit-learn for training) · Databricks (Delta, notebooks, dashboards) · OpenStreetMap Overpass · ElevenLabs · Gemini Live API + Gemini API · STMicroelectronics SensorTile.box

---

## 15. Team split (3 people)

Split by area, not by layer, so each person owns a vertical slice with minimal blocking on the others. Names are placeholders; swap in the real ones.

| | **Person A: Hardware + App core** | **Person B: ML + Driving intelligence** | **Person C: Voice + Cloud + Data** |
|---|---|---|---|
| **Owns** | `app/` shell, `ble/`, `pipeline/`, crash detector, UI, replay source, `sync/` | `ml/`, `data/`, erratic-driving model, `detectors/erratic`, `location/` (Overpass tiles + stop-sign coach) | `voice/`, `cloud/`, `databricks/`, model distribution |
| **Skills needed** | React Native, BLE, TypeScript | Python ML, signal processing, TS port, geospatial basics | Python/FastAPI, APIs, audio, Databricks |

### Person A: Hardware + App core
1. **Hour 0–2:** Expo dev build running on a real phone (do this first, it's the biggest schedule risk). Verify the SensorTile.box stream in the STBLE Sensor app and document the characteristic layout.
2. BLE connect/reconnect and packet parser, producing `Sample` objects.
3. Gravity calibration and vehicle-axis rotation, windowing (shared with B's feature code).
4. Crash detector (thresholds) and the "Are you OK?" countdown flow.
5. **Recording tool:** save raw sensor + GPS to files. This unblocks B's training data, so it ships early.
6. Replay source that plays recorded drives through the same pipeline.
7. App UI: connection status, live smoothness gauge, alert feed, notifications.
8. `sync/`: local trip store, upload queue, model-update check and test-vector validation.

### Person B: ML + Driving intelligence
1. **Hour 0–2:** agree the `Sample`, `GpsFix` and `DriveEvent` types with A and C. Write the feature spec (window, features, units).
2. Record normal drives and staged weaving laps using A's recording tool. Until it exists, use phone IMU or synthetic data to start.
3. Feature extraction in Python, then the same in TypeScript, with **shared test vectors** so they match.
4. Train the Isolation Forest baseline, evaluate on held-out drives, export to ONNX; fall back to a small TypeScript model if ONNX is a pain on the phone. Measure on-device inference time.
5. Overpass client, 1-mile tile cache and prefetch, bearing/distance filtering. **Done.**
6. Location coach: stop-sign and traffic-light announcements, highway merge/exit speed coaching. **Done.** Still to do: the stop-sign compliance state machine (`approaching`, `ok`, `rolling`, `ran`) and bundled demo-route tiles.
7. Evaluation write-up: false alarms per hour, staged-weave precision/recall, what it does and does not claim.

### Person C: Voice + Cloud + Data
1. **Hour 0–2:** get ElevenLabs and Gemini keys working; generate and bundle the fixed alert phrases; stand up an empty FastAPI service with `/health` deployed somewhere reachable (laptop on hotspot is fine).
2. `voice/` module in the app: priority queue, rate limiting, ElevenLabs playback, device-TTS fallback.
3. Gemini Live in the app: connect, mic input, transcript, trip context. Decide direct token vs proxy after checking SDK support.
4. Cloud service: `POST /trips`, Gemini post-trip report, `POST /live-token`, `GET /model/latest`.
5. Databricks: Delta table schema, ingest from the service, trend and risky-location notebook, dashboard, retraining job that outputs a versioned ONNX model.
6. Pre-load several demo trips and a pre-generated report as the offline fallback.

### Shared and integration points

| When | What | Who |
|---|---|---|
| Hour 0–2 | Agree the TypeScript types, event names and cloud JSON schema in `docs/contracts.md` | All |
| After A's recorder ships | B starts real data collection | A → B |
| After B's `DriveEvent`s work | C wires events to voice (location events are ready: see Section 9) | B → C |
| After A's `sync/` exists | C's `/trips` and `/model/latest` get real clients | A ↔ C |
| Final stretch | Full-system integration, demo rehearsal, fallbacks | All |

### Timeline (adapt to the real hackathon length)

| Phase | A | B | C |
|---|---|---|---|
| **1. Foundations** | Dev build, BLE stream, recorder | Types, feature spec, synthetic data | Keys, bundled audio, empty cloud service |
| **2. Core loop** | Pipeline, crash detector, replay, UI | Features, first model, tile cache | Voice module, event-to-speech |
| **3. Intelligence** | Model loading on phone, `sync/` | Stop-sign coach, evaluation | Gemini Live, trip report endpoint |
| **4. Cloud + data** | Upload and OTA in the app | Retraining data prep | Databricks pipeline and dashboard |
| **5. Polish** | Demo UX, background behavior | Tune thresholds on real drives | Fallback assets, demo script |

### Working agreements
- Branch per person (`a/…`, `b/…`, `c/…`; Person B works on `person-b`), small PRs into `main`, no force-pushes.
- Mocks first: A provides a fake event source, C provides a mock cloud, so nobody waits for another person's work.
- One person (suggest A) owns the demo device and final build; freeze features at a set time before judging.
- Cut order if time runs short: Databricks retraining, then OTA model updates, then weekly summaries, then Gemini Live. The real-time path (A + B + the voice module) is never cut.
- Rotate help toward whoever is blocked; A's BLE work is the most likely bottleneck.

