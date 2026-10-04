# STEVAL-MKBOXPRO Bluetooth diagnostics

The mobile app supports the GATT contract exposed by the STEVAL-MKBOXPRO factory firmware v3.4.0. The board advertises as `HSD2v34`, ST's DATALOG2 (High Speed Datalog 2) firmware v3.4. The diagnostic screen retains broad GATT monitoring for protocol investigation and adds a production-shaped **Start live IMU pipeline** path that uses only the PnPL and raw-stream characteristics documented in [steval-mkboxpro-results.md](steval-mkboxpro-results.md).

## Prerequisites

- Physical STEVAL-MKBOXPRO updated to factory firmware v3.4.0 (DATALOG2), with an SD card inserted
- Physical iPhone
- Mac with Xcode and signing configured
- Node.js version supported by the installed Expo SDK

Expo Go cannot load `react-native-ble-plx`; use a development build.

## Create the iOS development build

On the Mac:

1. Clone the repository and run `npm ci`.
2. Copy `.env.example` to `.env` and set `IOS_BUNDLE_IDENTIFIER` to a unique iOS bundle identifier (for example `com.yourname.carassistant`). `app.config.ts` reads it into `ios.bundleIdentifier`.
3. Connect the iPhone and run `npx expo run:ios --device`.
4. Select the development team/signing identity in Xcode if prompted.
5. Allow the Bluetooth permission on first launch.

After the development build is installed, ordinary TypeScript changes can be loaded from Metro without rebuilding the native app. Changes to native dependencies, config plugins, or Bluetooth permissions require a new native build.

Start Metro with:

```bash
npm run start:dev-client
```

The computer running Metro and the iPhone should be on the same network. Do not leave the STEVAL-MKBOXPRO connected to ST BLE Sensor while testing this app.

## Run the end-to-end live drive

1. From the home screen, tap **Start drive**.
2. Secure the board flat with its X arrow facing the front of the vehicle, then select the nearby `HSD2v34` SensorTile. The picker stops scanning before handing its device ID to the drive screen.
3. The drive screen reconnects, discovers GATT, starts the acknowledged DATALOG2 command sequence, and owns the BLE connection until the drive ends.
4. For a new or explicitly recalibrated sensor, remain safely parked and still during the short calibration. The app saves the vehicle-frame calibration per device; use **Recalibrate** after changing the mount.
5. Candidate IMU events are converted to app-wide `DriveEvent`s, shown on the coach card, passed to the voice priority queue, and retained in the trip.
6. Tap **End drive** to send `stop_log`, disconnect, save the trip in the current app session, and attempt `POST /trips`. Failed uploads can be retried from the summary screen.

Set `EXPO_PUBLIC_API_URL` to the FastAPI service URL to enable trip upload and streamed coach chat. Live candidate events and voice alerts remain on-device when the cloud is unavailable.

## Capture the GATT layout

1. Open the diagnostic app.
2. Tap **Start scan**.
3. Select the STEVAL-MKBOXPRO using the advertised name observed in ST BLE Sensor. Hold the board next to the phone and use the **Range** filter to hide distant devices: **Very close** (RSSI ≥ −55 dBm), **Nearby** (≥ −70 dBm, the default) or **All**. The list is sorted strongest signal first. Signal strength is recorded when a device is first seen, so if the board was far away during the scan, move it closer and tap **Start scan** again. Devices whose manufacturer data starts with STMicroelectronics' Bluetooth company ID (`0x0030`, bytes `30 00`) get an **ST** badge, and **STMicroelectronics devices only** hides everything else. If the board advertises without manufacturer data it will not be tagged, so turn the toggle off if nothing appears.
4. Wait for service discovery.
5. Copy the `[BLE GATT snapshot]` entry from the Metro or Xcode console.
6. Optionally tap **Monitor all characteristics (raw diagnostic)** to inspect unknown characteristics. Only the first 20 payloads are retained; counters update once per second.
7. Tap **Start live IMU pipeline**. This replaces broad monitoring with targeted PnPL/raw subscriptions, sends each DATALOG2 command only after the prior command is acknowledged, and starts the required SD-card log.
8. Move the board and watch the throttled source diagnostics, normalized values, pipeline health, and candidate-event log. The live source decodes and pairs the separate 40-sample accelerometer and gyroscope batches at 120 Hz without placing every sample in React state.
9. Tap **Stop live IMU pipeline** when done. The source sends `stop_log`, removes subscriptions, and clears its synchronization queues.

Candidate events are experimental diagnostics. They are not confirmed crashes or swerves and do not trigger alerts or emergency behavior.

Monitoring every notifiable characteristic remains a discovery tool. The normalized path is implemented by the versioned profile, decoder, synchronizer, and source under `src/integrations/bluetooth/`.

## Data to return to the team

Results so far are recorded in [steval-mkboxpro-results.md](steval-mkboxpro-results.md). For each physical validation run, record:

- Normalized samples per second and decoded batch counts
- Rejected packet, unknown sensor ID, queue resynchronization, and dropped-batch counts
- Pipeline sample rate and largest sample gap
- Stationary acceleration magnitude and gyroscope magnitude
- Whether two consecutive start/stop cycles succeed
- Any connection, command, subscription, or decoding error

Do not include a personal location trace or credentials in diagnostic output.

## Local verification

These checks do not require the board:

```bash
npm test
npm run typecheck
npx expo install --check
```
