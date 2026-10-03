# STEVAL-MKBOXPRO Bluetooth diagnostics

The first mobile milestone discovers the GATT contract exposed by the STEVAL-MKBOXPRO factory firmware v3.4.0. The board advertises as `HSD2v34`, ST's DATALOG2 (High Speed Datalog 2) firmware v3.4. Generic monitoring does not hardcode UUIDs; the **Start IMU stream** button uses the DATALOG2 PnPL and raw-stream characteristics documented in [steval-mkboxpro-results.md](steval-mkboxpro-results.md).

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

## Capture the GATT layout

1. Open the diagnostic app.
2. Tap **Start scan**.
3. Select the STEVAL-MKBOXPRO using the advertised name observed in ST BLE Sensor. Hold the board next to the phone and use the **Range** filter to hide distant devices: **Very close** (RSSI ≥ −55 dBm), **Nearby** (≥ −70 dBm, the default) or **All**. The list is sorted strongest signal first. Signal strength is recorded when a device is first seen, so if the board was far away during the scan, move it closer and tap **Start scan** again. Devices whose manufacturer data starts with STMicroelectronics' Bluetooth company ID (`0x0030`, bytes `30 00`) get an **ST** badge, and **STMicroelectronics devices only** hides everything else. If the board advertises without manufacturer data it will not be tagged, so turn the toggle off if nothing appears.
4. Wait for service discovery.
5. Copy the `[BLE GATT snapshot]` entry from the Metro or Xcode console.
6. Tap **Monitor notifiable characteristics**.
7. Tap **Start IMU stream**. It sends the DATALOG2 PnPL commands that enable the accelerometer and gyroscope at 120 Hz and start a log. Each command and the board's reply appear on screen and in Metro as `[BLE PnPL command]` / `[BLE PnPL response]`.
8. Move the board and look for increasing **Stream packets by sensor ID**, `[BLE packet]` entries and stream metrics.
9. Tap **Stop IMU stream** when done. This also stops the SD-card log.

Only the first 20 packet payloads are retained and logged. Stream counters update once per second so sensor notifications do not cause a React render for every packet.

Monitoring every notifiable characteristic is a discovery tool, not the final data path. Factory firmware may require a write command to enable its motion stream. Once the v3.4.0 services and commands are confirmed, replace broad monitoring with a versioned STEVAL-MKBOXPRO profile.

## Data to return to the team

Results so far are recorded in [steval-mkboxpro-results.md](steval-mkboxpro-results.md).

- Advertised device name
- GATT snapshot JSON
- UUIDs whose counters change while the board moves
- First captured packets for each active characteristic
- Notifications and packets per second
- Any connection or permission error

Do not include a personal location trace or credentials in diagnostic output.

## Local verification

These checks do not require the board:

```bash
npm test
npm run typecheck
npx expo install --check
```
