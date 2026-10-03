# Car Assistant (WolfHacks)

An AI driving coach built on the **STMicroelectronics SensorTile.box**. A wearable/dash-mounted sensor streams motion data over Bluetooth to a phone. The phone and a Python backend detect crashes and erratic driving, track the car against live map data, and a voice coach speaks up when you need it ("Stop sign ahead, start slowing down").

Track: **Applied AI Hardware+**. Collect, analyze and act on real sensor data; detect patterns/anomalies; deploy ML to edge/IoT devices.

> Status: design document only. No implementation yet.

---

## 1. Goals

1. Detect **crashes** and **erratic / impaired driving** (swerving, weaving, harsh braking) from IMU data.
2. Act as a **live coach** for new and younger drivers: stop signs, speed, smoothness.
3. Speak alerts aloud (ElevenLabs) and let the driver talk back hands-free (Gemini Live).
4. Run part of the ML **on the edge** (phone) so safety-critical alerts work offline.

### Non-goals
- We do **not** claim to detect intoxication. See [Section 6](#6-ml-design).
- Not a replacement for emergency services or a certified safety device.
- No app-store release, accounts or billing.

---

## 2. Architecture

```
 SensorTile.box                 Phone (React Native)                    Python backend (FastAPI)
┌──────────────┐  BLE   ┌──────────────────────────────┐  WebSocket  ┌──────────────────────────────┐
│ accel / gyro │───────▶│ BLE client (ble-plx)         │────────────▶│ /ws/sensor   window + ML      │
│ (stock ST    │        │ Edge crash detector (thresh) │             │ /ws/location tile + coach     │
│  firmware)   │        │ GPS (background location)    │◀────────────│ events: swerve, stop-sign,    │
└──────────────┘        │ Audio playback + mic         │   events    │         speed, crash          │
                        │ Push / local notifications   │             │ Overpass tile cache           │
                        └──────────────────────────────┘             └───────┬───────────┬──────────┘
                                   ▲  audio                                  │           │
                                   │                                  ElevenLabs     Gemini Live
                                   └──────────────── TTS stream ◀────────────┘      (voice + transcript)
```

### Components

| Component | Tech | Responsibility |
|---|---|---|
| Sensor | SensorTile.box, **stock ST firmware** | Stream accelerometer + gyroscope over BLE |
| Mobile app | React Native (Expo dev build), `react-native-ble-plx`, `expo-location` | BLE, GPS, UI, notifications, audio, edge crash detection |
| Backend | Python, FastAPI, WebSockets, NumPy/scikit-learn | Windowing, ML inference, location coaching, orchestration |
| Map data | OpenStreetMap Overpass API | Stop signs and road info in 1-mile tiles |
| Voice out | ElevenLabs TTS | Spoken alerts and coaching |
| Voice in / chat | Gemini Live API | Hands-free conversation, transcripts, post-drive summary |
| Dashboard (optional) | Small web page | Judge-facing live view of the same event stream |

Note: Expo Go cannot do BLE. The app needs a **dev build** (`expo run:ios` / `run:android` or EAS).

---

## 3. Data flow

1. **Sensor to phone.** The SensorTile.box streams IMU packets over BLE. The app parses ST's characteristic format into `{t, ax, ay, az, gx, gy, gz}`.
2. **Edge check (phone).** Every sample runs through a threshold crash detector (see 6.1). A hit fires a local alert immediately, with no network needed.
3. **Phone to backend.** Samples are batched (about 100 ms per message) and sent over WebSocket along with GPS fixes.
4. **Backend ML.** Samples are windowed (about 2 s, 50% overlap). Features go to the anomaly model. High scores emit `swerve` / `erratic` events.
5. **Location coach.** GPS plus heading are matched against cached stop-sign data (see Section 7). The backend emits `stop_sign_ahead` and `stop_sign_violation` events.
6. **Speak.** Events go through a message template, then ElevenLabs, then audio streamed to the phone. Critical events also trigger a push/local notification and on-screen banner.
7. **Talk back.** The driver can speak to the assistant through Gemini Live ("how was that turn?", "call my emergency contact"). Transcripts are stored with the trip.

---

## 4. Feature list

### Core (must ship)
- BLE connect/reconnect to the SensorTile.box with live signal and battery indicator
- Live IMU stream to the backend
- **Crash detection**: threshold on the phone, confirmed by the backend
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
- Parent dashboard: weekly score and trends, no raw location sharing by default
- Gamified streaks and badges for clean stops and smooth drives
- Teen curfew / geofence alerts

### Extra ideas
- School zone, railroad crossing and traffic signal warnings from OSM tags
- Risky-area learning: heat map of where the driver brakes hard
- Insurance-style score export
- Raspberry Pi gateway variant: Pi receives BLE and runs the model at the edge (hits the "Raspberry Pi" tech requirement)
- On-device model export (TFLite/ONNX) so inference runs on the phone
- IoT cloud sink (MQTT or similar) for fleet-style trip logging
- Multi-language coaching via ElevenLabs multilingual voices
- SensorTile.box microphone: detect horns, sirens or tire screech as extra context
- Pothole detection from vertical accel spikes, tagged to GPS

---

## 5. Hardware & firmware

- **SensorTile.box**, stock ST BLE sensor-streaming firmware. No flashing needed.
- First task: verify the stream with ST's **STBLE Sensor** app, then reproduce it in our parser.
- Mount: fixed to the car (dash/cupholder), aligned to the vehicle axes. Gravity vector is used to auto-calibrate orientation at the start of a trip.
- Open question: achievable stable sample rate over BLE with stock firmware. Plan for about 25 to 100 Hz and design features around the lower bound.

---

## 6. ML design

### 6.1 Crash detection (edge, phone)
- Rule-based: acceleration magnitude above about 4 g for a few samples, optionally followed by near-zero motion.
- Runs in the app so it works with no connectivity.
- The backend re-checks the window to cut false positives (potholes, dropped sensor) before escalating.

### 6.2 Swerve / erratic driving (backend)
We have no labeled "drunk" data and cannot ethically collect it. So we **do not claim intoxication detection**. We detect **impaired / erratic driving patterns**.

- **Features per window:** lateral accel stats, yaw-rate variance, zero-crossing rate of yaw (weaving frequency), jerk, longitudinal accel spikes, dominant frequency of lateral motion.
- **Model:** unsupervised anomaly detection (Isolation Forest baseline; optional 1D-CNN autoencoder). Trained on normal driving we record ourselves.
- **Validation:** staged, deliberate weaving laps in a safe empty lot as the positive class. Report precision/recall on that, and say plainly what it measures.
- **Output:** a continuous erratic-driving score plus a thresholded event with hysteresis (avoid flapping).

### 6.3 Edge deployment story
- Crash detector runs on-device today.
- Stretch: export the anomaly model to ONNX/TFLite and run on the phone or a Raspberry Pi.

### 6.4 Evaluation
- Record 5+ normal drives and several staged weave sessions.
- Hold out whole drives (not random windows) for testing.
- Track false alarms per hour of normal driving, the number that matters to users.

---

## 7. Location & stop-sign coaching

**Tiling.** Instead of querying per GPS fix, we fetch map data in **~1-mile tiles** for good latency and fewer API calls.

1. On the first fix, compute the tile around the car and query Overpass for `highway=stop` nodes (and later `maxspeed`, crossings, etc.).
2. **Cache** per tile (by quantized lat/lon key) in memory and on disk.
3. When the car nears the tile edge (about 25% remaining along its heading), **prefetch** the next tile.
4. Only consider signs **ahead of the car**: filter by bearing within about ±35° of heading and by distance.

**Coach logic (state machine per sign):**
- `approaching` at about 150 m: "Stop sign ahead, start slowing down."
- `braking check` at about 60 m: is speed trending down fast enough?
- `at sign` within about 10 m: did speed reach below about 2 mph (stopped) or just slow?
- Emit `stop_ok`, `rolling_stop` or `ran_stop` and say so.

**Caveats we design for:** GPS jitter (smooth with a short filter), OSM stop signs on intersecting roads that don't apply to our direction (use the `direction` tag and bearing), Overpass rate limits and downtime (cache and fall back to the hardcoded demo route).

---

## 8. Voice layer

- **ElevenLabs** speaks every alert. Pre-generate and cache audio for fixed phrases ("Stop sign ahead") so common alerts have near-zero latency. Use streaming TTS only for dynamic text.
- **Priority queue:** crash > stop-sign > swerve > coaching tips. Higher priority interrupts lower. Rate-limit repeats.
- **Gemini Live** provides the voice conversation and transcript. We give it trip context (recent events, score) as system context so answers are specific.
- Never let the LLM make safety decisions. Detection is deterministic code and ML. The LLM explains and chats.

---

## 9. Interfaces

### WebSocket messages (draft)

Phone to backend:
```json
{"type":"imu","t":1730000000.123,"samples":[[ax,ay,az,gx,gy,gz], ...]}
{"type":"gps","t":1730000000.5,"lat":43.47,"lon":-80.54,"speed":13.2,"heading":87.0}
```

Backend to phone:
```json
{"type":"event","kind":"stop_sign_ahead","severity":"info","distance_m":140,"say":"Stop sign ahead, start slowing down."}
{"type":"event","kind":"erratic_driving","severity":"warn","score":0.91}
{"type":"event","kind":"crash","severity":"critical","confirmed":true}
{"type":"score","smoothness":82}
```

### REST (draft)
- `GET /trips`, `GET /trips/{id}`: history, events, transcript, score
- `POST /trips/{id}/replay`: start replay mode
- `GET /health`

---

## 10. Repo layout (planned)

```
car-assistant-wolfhacks/
├── mobile/            # React Native (Expo dev build) app
├── backend/           # FastAPI app, WebSockets, coach logic, Overpass client
├── ml/                # feature extraction, training notebooks, model export
├── data/              # recorded drives (sensor + GPS) for training and replay
├── dashboard/         # optional web view
└── docs/
```

---

## 11. Demo plan

We can't drive drunk or crash a car on stage, so the demo is built to be safe and reliable.

1. **Live:** hold the SensorTile.box, shake/weave it to trigger swerve and crash alerts in real time, with voice and notifications.
2. **Replay:** a pre-recorded drive (sensor + GPS) plays through the real pipeline for stop-sign coaching and a trip report.
3. **Fallbacks:** replay mode if BLE or wifi fails, cached audio if ElevenLabs is slow, hardcoded route if Overpass is down.

**Definition of done for the demo:** BLE stream visible live, one real-time swerve alert, one crash alert, one spoken stop-sign warning from replay, one trip summary from Gemini.

---

## 12. Risks & open questions

| Risk | Mitigation |
|---|---|
| BLE sample rate / packet format with stock firmware | Verify with STBLE Sensor app first; design for low rate |
| Expo dev-build and signing time | Set up on day one before any features |
| Drunk-detection credibility | Frame as erratic-driving detection; be explicit about validation |
| Latency end to end (BLE, network, ML, TTS) | Edge crash check, cached TTS phrases, tile prefetch |
| Venue wifi unreliable | Backend on laptop on the local network or hotspot; replay mode |
| API keys (ElevenLabs, Gemini) | `.env` only, never committed |
| Safety/legal | Passenger operates the app; the app is a coach, not a certified device; no distraction-inducing UI while moving |
| Privacy | Location and audio stay local to the trip; opt-in sharing only |

**Open questions**
- Exact BLE characteristic layout and max stable rate on the stock firmware?
- iOS, Android or both for the demo device?
- Do we want the Raspberry Pi gateway for the hardware-track checkbox?

---

## 13. Build order

1. Dev build + BLE connection + raw IMU on screen
2. Record data; write the replay harness
3. Backend WebSocket + windowing + edge crash detector
4. Anomaly model trained on our own drives
5. Overpass tiling + stop-sign state machine
6. ElevenLabs alerts + notifications
7. Gemini Live conversation + trip report
8. Polish, demo script, fallbacks

---

## 14. Tech summary

React Native (Expo dev build) · `react-native-ble-plx` · Python · FastAPI · scikit-learn · OpenStreetMap Overpass · ElevenLabs · Gemini Live API · STMicroelectronics SensorTile.box
