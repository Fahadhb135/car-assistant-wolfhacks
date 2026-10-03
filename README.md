# Car Assistant (WolfHacks)

An AI driving coach built on the **STMicroelectronics SensorTile.box**. A dash-mounted sensor streams motion data over Bluetooth to a phone. The phone app runs the ML on-device, detects crashes and erratic driving, tracks the car against live map data, and a voice coach speaks up when you need it ("Stop sign ahead, start slowing down").

Track: **Applied AI Hardware+**. Collect, analyze and act on real sensor data; detect patterns/anomalies; deploy ML to edge/IoT devices.

> Status: design document only. No implementation yet.

---

## 1. Goals

1. Detect **crashes** and **erratic / impaired driving** (swerving, weaving, harsh braking) from IMU data.
2. Act as a **live coach** for new and younger drivers: stop signs, speed, smoothness.
3. Speak alerts aloud (ElevenLabs) and let the driver talk back hands-free (Gemini Live).
4. Run **all detection on the edge (the phone)** so alerts have no network hop and work offline.

### Non-goals
- We do **not** claim to detect intoxication. See [Section 6](#6-ml-design).
- Not a replacement for emergency services or a certified safety device.
- No app-store release, accounts, cloud backend or billing.

---

## 2. Architecture

The app is **fully React Native**. There is no application server. Python is used **offline** to train the model; the trained model ships inside the app.

```
 SensorTile.box                       Phone (React Native app)
┌──────────────┐  BLE   ┌───────────────────────────────────────────────────────┐
│ accel / gyro │───────▶│ BLE client (ble-plx)                                  │
│ (stock ST    │        │   │                                                   │
│  firmware)   │        │   ▼                                                   │
└──────────────┘        │ Signal pipeline: calibrate → window → features        │
                        │   ├─▶ Crash detector (thresholds)                     │
                        │   └─▶ Erratic-driving model (ONNX / TS, trained in    │
                        │        Python offline)                                │
                        │ GPS (background location) ─▶ Tile cache ─▶ Stop-sign  │
                        │                              (Overpass)    coach      │
                        │ Event bus ─▶ Alert queue ─▶ ElevenLabs TTS / push     │
                        │ Gemini Live (voice chat + transcript)                 │
                        │ Local trip store (SQLite)                             │
                        └───────────────────────────────────────────────────────┘
                                  │ HTTPS only for: Overpass, ElevenLabs, Gemini

 Offline (laptop):  ml/  Python notebooks ─▶ train on recorded drives ─▶ export model ─▶ bundled in app
```

### Components

| Component | Tech | Responsibility |
|---|---|---|
| Sensor | SensorTile.box, **stock ST firmware** | Stream accelerometer + gyroscope over BLE |
| Mobile app | React Native (Expo dev build), `react-native-ble-plx`, `expo-location`, `expo-av`, `expo-sqlite` | Everything at runtime: BLE, signal processing, inference, coaching, UI, audio, storage |
| On-device ML | ONNX via `onnxruntime-react-native`, or plain TypeScript for a small model | Erratic-driving inference |
| Training (offline) | Python, NumPy, scikit-learn, Jupyter | Feature design, training, evaluation, model export |
| Map data | OpenStreetMap Overpass API (called from the phone) | Stop signs and road info in 1-mile tiles |
| Voice out | ElevenLabs TTS | Spoken alerts and coaching |
| Voice in / chat | Gemini Live API | Hands-free conversation, transcripts, post-drive summary |

Notes:
- Expo Go cannot do BLE. The app needs a **dev build** (`expo run:ios` / `run:android` or EAS).
- API keys for ElevenLabs and Gemini live in the app config for the hackathon. For anything beyond a demo, put a tiny key-holding proxy in front of them.

---

## 3. Data flow

1. **Sensor to phone.** The SensorTile.box streams IMU packets over BLE. The app parses ST's characteristic format into `{t, ax, ay, az, gx, gy, gz}`.
2. **Calibrate.** At the start of a trip, estimate the gravity vector and rotate samples into vehicle axes (forward / lateral / vertical).
3. **Crash check.** Every sample goes through the threshold crash detector (see 6.1). A hit fires an immediate local alert.
4. **Window and infer.** Samples are windowed (about 2 s, 50% overlap), turned into features, and scored by the on-device erratic-driving model. High scores emit `erratic_driving` events.
5. **Location coach.** GPS plus heading are matched against cached stop-sign data (see Section 7). Emits `stop_sign_ahead` and `stop_sign_violation` events.
6. **Speak.** Events go to a priority queue, then ElevenLabs (cached audio for fixed phrases), plus a local notification and on-screen banner.
7. **Talk back.** The driver can speak to the assistant through Gemini Live ("how was that turn?"). Trip context is passed in so answers are specific. Transcripts are stored with the trip.
8. **Store.** Events, scores and transcripts are saved to the local trip store.

Only three things leave the phone: Overpass tile queries, ElevenLabs TTS requests and Gemini Live audio/text. Detection itself needs no network.

---

## 4. Feature list

### Core (must ship)
- BLE connect/reconnect to the SensorTile.box with live signal and battery indicator
- **Crash detection** (on-device thresholds)
- **Swerve / erratic driving detection** with anomaly score and live "smoothness" gauge
- **Stop-sign coaching**: warn on approach, flag rolling or missed stops
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
- Parent view: weekly score and trends, no raw location sharing by default (needs a cloud sink, post-hackathon)
- Gamified streaks and badges for clean stops and smooth drives
- Teen curfew / geofence alerts

### Extra ideas
- School zone, railroad crossing and traffic signal warnings from OSM tags
- Risky-area learning: heat map of where the driver brakes hard
- Insurance-style score export
- Raspberry Pi gateway variant: Pi receives BLE and runs the model (hits the "Raspberry Pi" tech requirement)
- IoT cloud sink (MQTT or similar) for fleet-style trip logging and a parent/judge dashboard
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
We have no labeled "drunk" data and cannot ethically collect it. So we **do not claim intoxication detection**. We detect **impaired / erratic driving patterns**.

- **Features per window:** lateral accel stats, yaw-rate variance, zero-crossing rate of yaw (weaving frequency), jerk, longitudinal accel spikes, dominant frequency of lateral motion.
- **Model:** unsupervised anomaly detection (Isolation Forest baseline; optional small autoencoder). Trained **offline in Python** on normal driving we record ourselves.
- **Deployment:** export to ONNX and run with `onnxruntime-react-native`. Fallback: re-implement feature extraction and a small model (trees or logistic regression) directly in TypeScript. Feature code is written once per language and checked against the Python version with shared test vectors, so the two cannot drift.
- **Validation:** staged, deliberate weaving laps in a safe empty lot as the positive class. Report precision/recall on that, and say plainly what it measures.
- **Output:** a continuous erratic-driving score plus a thresholded event with hysteresis (avoid flapping).

### 6.3 Edge deployment story
Both detectors run on the phone, with no server in the loop. The model is trained in Python and shipped inside the app. Stretch: a Raspberry Pi gateway running the same model.

### 6.4 Evaluation
- Record 5+ normal drives and several staged weave sessions.
- Hold out whole drives (not random windows) for testing.
- Track false alarms per hour of normal driving, the number that matters to users.
- Measure on-device inference time per window and report it.

---

## 7. Location & stop-sign coaching

**Tiling.** Instead of querying per GPS fix, the app fetches map data in **~1-mile tiles** for good latency and fewer API calls.

1. On the first fix, compute the tile around the car and query Overpass for `highway=stop` nodes (and later `maxspeed`, crossings, etc.).
2. **Cache** per tile (by quantized lat/lon key) in memory and in local storage.
3. When the car nears the tile edge (about 25% remaining along its heading), **prefetch** the next tile.
4. Only consider signs **ahead of the car**: filter by bearing within about ±35° of heading and by distance.

**Coach logic (state machine per sign):**
- `approaching` at about 150 m: "Stop sign ahead, start slowing down."
- `braking check` at about 60 m: is speed trending down fast enough?
- `at sign` within about 10 m: did speed reach below about 2 mph (stopped) or just slow?
- Emit `stop_ok`, `rolling_stop` or `ran_stop` and say so.

**Caveats we design for:** GPS jitter (smooth with a short filter), OSM stop signs on intersecting roads that don't apply to our direction (use the `direction` tag and bearing), Overpass rate limits and downtime (cache, and fall back to the bundled demo-route data). Pre-fetch the demo route's tiles before the demo.

---

## 8. Voice layer

- **ElevenLabs** speaks every alert. Pre-generate and bundle audio for fixed phrases ("Stop sign ahead") so common alerts play instantly with no network. Use streaming TTS only for dynamic text.
- **Priority queue:** crash > stop-sign > swerve > coaching tips. Higher priority interrupts lower. Rate-limit repeats.
- **Gemini Live** provides the voice conversation and transcript. We give it trip context (recent events, score) as system context so answers are specific.
- Never let the LLM make safety decisions. Detection is deterministic code and ML. The LLM explains and chats.
- If the network is down, alerts fall back to bundled phrases and the device's built-in text-to-speech.

---

## 9. Internal interfaces

No network API. Modules talk over an in-app event bus.

```ts
type Sample = { t: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number };
type GpsFix = { t: number; lat: number; lon: number; speed: number; heading: number };

type DriveEvent =
  | { kind: 'crash'; severity: 'critical'; confirmed: boolean }
  | { kind: 'erratic_driving'; severity: 'warn'; score: number }
  | { kind: 'stop_sign_ahead'; severity: 'info'; distanceM: number }
  | { kind: 'stop_ok' | 'rolling_stop' | 'ran_stop'; severity: 'info' | 'warn' };
```

Module boundaries: `ble/` → `pipeline/` (calibrate, window, features) → `detectors/` (crash, erratic) and `location/` (tiles, coach) → `events/` bus → `voice/` and `ui/`. Replay mode swaps `ble/` and GPS for a recorded-file source, so everything downstream is identical in live and replay.

---

## 10. Repo layout (planned)

```
car-assistant-wolfhacks/
├── app/               # React Native (Expo dev build) app
│   └── src/
│       ├── ble/  pipeline/  detectors/  location/  voice/  events/  storage/  ui/
├── ml/                # Python (offline only): features, training notebooks, export, eval
├── data/              # recorded drives (sensor + GPS) for training and replay
├── assets/audio/      # pre-generated alert phrases
└── docs/
```

---

## 11. Demo plan

We can't drive drunk or crash a car on stage, so the demo is built to be safe and reliable.

1. **Live:** hold the SensorTile.box, shake/weave it to trigger swerve and crash alerts in real time, with voice and notifications. Works even in airplane mode, since detection is on-device.
2. **Replay:** a pre-recorded drive (sensor + GPS) plays through the real pipeline for stop-sign coaching and a trip report.
3. **Fallbacks:** replay mode if BLE fails, bundled audio if ElevenLabs is slow or offline, pre-fetched tiles if Overpass is down.

**Definition of done for the demo:** BLE stream visible live, one real-time swerve alert, one crash alert, one spoken stop-sign warning from replay, one trip summary from Gemini.

---

## 12. Risks & open questions

| Risk | Mitigation |
|---|---|
| BLE sample rate / packet format with stock firmware | Verify with STBLE Sensor app first; design for low rate |
| Expo dev-build and signing time | Set up on day one before any features |
| ONNX runtime in React Native is fiddly | Keep the TypeScript fallback model; shared test vectors between Python and TS |
| JS thread jitter under load | Keep per-window work small; batch BLE reads; measure inference time |
| Drunk-detection credibility | Frame as erratic-driving detection; be explicit about validation |
| API keys inside the app | Acceptable for a demo; use a proxy before any real release |
| Background BLE/GPS limits on iOS/Android | Demo with the app foregrounded; test background behavior early |
| Safety/legal | Passenger operates the app; the app is a coach, not a certified device; no distraction-inducing UI while moving |
| Privacy | Location, audio and trips stay on the phone; sharing is opt-in and post-hackathon |

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
5. Overpass tiling + stop-sign state machine
6. ElevenLabs alerts + notifications
7. Gemini Live conversation + trip report
8. Polish, demo script, fallbacks

---

## 14. Tech summary

React Native (Expo dev build) · TypeScript · `react-native-ble-plx` · `onnxruntime-react-native` · SQLite · Python (offline training: NumPy, scikit-learn) · OpenStreetMap Overpass · ElevenLabs · Gemini Live API · STMicroelectronics SensorTile.box
