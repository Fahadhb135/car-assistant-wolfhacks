# STEVAL-MKBOXPRO diagnostic results

Results from the BLE diagnostic in [bluetooth.md](bluetooth.md), captured on 2026-10-03 with an iPhone 16 Pro Max (iOS 26.6.1) running the Expo dev build.

> Status: GATT layout captured. The board runs ST's **DATALOG2 (High Speed Datalog 2) v3.4** firmware. Subscribing alone produces no packets: DATALOG2 only streams once the sensors are enabled for BLE and a log is started with PnPL commands. The diagnostic's **Start IMU stream** button sends that sequence; its first run is pending.

## Firmware

| Item | Value |
|---|---|
| Board model | STEVAL-MKBOXPRO |
| Factory firmware version | v3.4.0 |
| Advertised device name | `HSD2v34` (suggests High Speed Datalog 2 firmware, v3.4) |
| RSSI at capture | −57 dBm |
| Manufacturer data | `30 00 02 13 0d 00 00 00 d0 19 a6 e6 91 b9`: company ID `0x0030` (STMicroelectronics), BlueST protocol `0x02`, platform `0x13`, firmware ID `0x0d`. The last six bytes look like the board's address. |
| Board revision | **Rev C**: platform `0x13` is `BLE_MANAGER_SENSOR_TILE_BOX_PRO_C_PLATFORM` in ST's `BLE_Manager.h` |
| SD card | Inserted (required, see below) |

## GATT layout

Two services, seven characteristics. Every characteristic supports notifications. All UUIDs use the STMicroelectronics BlueST base (`…-11e1-…-0002a5d5c51b`).

| Service | Purpose (per BlueST conventions, unconfirmed on this board) |
|---|---|
| `00000000-000e-11e1-9ab4-0002a5d5c51b` | Debug console (`00000001-000e…` terminal, `00000002-000e…` stderr) |
| `00000000-0001-11e1-9ab4-0002a5d5c51b` | Sensor feature data |

The feature characteristics use the `…-0002-11e1-ac36-…` (BlueST extended feature) family. The DATALOG2 SensorTile.boxPro app registers PnPL, Machine Learning Core, High Speed Data Log and Raw PnPL Controlled features (`BLE_Implementation.c` in [fp-sns-datalog2](https://github.com/STMicroelectronics/fp-sns-datalog2)). Two IDs are confirmed in source:

- `0x1b`, **PnPL**: JSON commands in, JSON responses out (notifications).
- `0x23`, **Raw PnPL Controlled**: the sensor data stream.

`0x0f`, `0x11` and `0x14` are not mapped yet. They are presumably the Machine Learning Core and High Speed Data Log features.

| Characteristic | Service | Read | Write | Notify | Packets? | Changes with motion? |
|---|---|---|---|---|---|---|
| `00000001-000e-11e1-ac36-0002a5d5c51b` | `00000000-000e-11e1…` | yes | with response + without response | yes | none (first run) | no |
| `00000002-000e-11e1-ac36-0002a5d5c51b` | `00000000-000e-11e1…` | yes | no | yes | none (first run) | no |
| `00000014-0002-11e1-ac36-0002a5d5c51b` | `00000000-0001-11e1…` | no | without response | yes | none (first run) | no |
| `0000001b-0002-11e1-ac36-0002a5d5c51b` | `00000000-0001-11e1…` | no | without response | yes | none (first run) | no |
| `0000000f-0002-11e1-ac36-0002a5d5c51b` | `00000000-0001-11e1…` | yes | no | yes | none (first run) | no |
| `00000011-0002-11e1-ac36-0002a5d5c51b` | `00000000-0001-11e1…` | no | without response | yes | none (first run) | no |
| `00000023-0002-11e1-ac36-0002a5d5c51b` | `00000000-0001-11e1…` | no | no | yes | none (first run) | no |

### Raw snapshot

The `[BLE GATT snapshot]` entry from Metro:

```json
[
  {
    "uuid": "00000000-000e-11e1-9ab4-0002a5d5c51b",
    "characteristics": [
      {
        "uuid": "00000001-000e-11e1-ac36-0002a5d5c51b",
        "serviceUuid": "00000000-000e-11e1-9ab4-0002a5d5c51b",
        "isReadable": true,
        "isWritableWithResponse": true,
        "isWritableWithoutResponse": true,
        "isNotifiable": true,
        "isIndicatable": false
      },
      {
        "uuid": "00000002-000e-11e1-ac36-0002a5d5c51b",
        "serviceUuid": "00000000-000e-11e1-9ab4-0002a5d5c51b",
        "isReadable": true,
        "isWritableWithResponse": false,
        "isWritableWithoutResponse": false,
        "isNotifiable": true,
        "isIndicatable": false
      }
    ]
  },
  {
    "uuid": "00000000-0001-11e1-9ab4-0002a5d5c51b",
    "characteristics": [
      {
        "uuid": "00000014-0002-11e1-ac36-0002a5d5c51b",
        "serviceUuid": "00000000-0001-11e1-9ab4-0002a5d5c51b",
        "isReadable": false,
        "isWritableWithResponse": false,
        "isWritableWithoutResponse": true,
        "isNotifiable": true,
        "isIndicatable": false
      },
      {
        "uuid": "0000001b-0002-11e1-ac36-0002a5d5c51b",
        "serviceUuid": "00000000-0001-11e1-9ab4-0002a5d5c51b",
        "isReadable": false,
        "isWritableWithResponse": false,
        "isWritableWithoutResponse": true,
        "isNotifiable": true,
        "isIndicatable": false
      },
      {
        "uuid": "0000000f-0002-11e1-ac36-0002a5d5c51b",
        "serviceUuid": "00000000-0001-11e1-9ab4-0002a5d5c51b",
        "isReadable": true,
        "isWritableWithResponse": false,
        "isWritableWithoutResponse": false,
        "isNotifiable": true,
        "isIndicatable": false
      },
      {
        "uuid": "00000011-0002-11e1-ac36-0002a5d5c51b",
        "serviceUuid": "00000000-0001-11e1-9ab4-0002a5d5c51b",
        "isReadable": false,
        "isWritableWithResponse": false,
        "isWritableWithoutResponse": true,
        "isNotifiable": true,
        "isIndicatable": false
      },
      {
        "uuid": "00000023-0002-11e1-ac36-0002a5d5c51b",
        "serviceUuid": "00000000-0001-11e1-9ab4-0002a5d5c51b",
        "isReadable": false,
        "isWritableWithResponse": false,
        "isWritableWithoutResponse": false,
        "isNotifiable": true,
        "isIndicatable": false
      }
    ]
  }
]
```

## Notification results

**Run 1 (2026-10-03):** subscribed to all 7 notifiable characteristics with no errors and received **0 packets**, both still and moving. This is expected with DATALOG2, see *Streaming with DATALOG2* below.

**Run 2 (Start IMU stream):** _pending_.

## Streaming with DATALOG2

Verified against the `fp-sns-datalog2` source (`BLE_Implementation.c`, `DatalogAppTask.c`, `STM32_BLE_Manager`). Data is sent on `0x23` only when all of these hold:

1. **The app is subscribed to `0x23`.** The firmware buffers nothing otherwise.
2. **Each sensor's `st_ble_stream` is enabled** via PnPL.
3. **A log is running.** `log_controller*start_log` with `interface: 0` (SD) also starts the BLE stream, and there is no separate BLE-only start, so **an SD card is required**.

Commands sent by **Start IMU stream**, in order, written to `0x1b`:

```json
{"lsm6dsv16x_acc":{"enable":true}}
{"lsm6dsv16x_acc":{"odr":4}}
{"lsm6dsv16x_acc":{"fs":3}}
{"lsm6dsv16x_acc":{"st_ble_stream":{"acc":{"enable":true}}}}
{"lsm6dsv16x_gyro":{"enable":true}}
{"lsm6dsv16x_gyro":{"odr":4}}
{"lsm6dsv16x_gyro":{"fs":3}}
{"lsm6dsv16x_gyro":{"st_ble_stream":{"gyro":{"enable":true}}}}
{"log_controller*start_log":{"interface":0}}
```

`odr` and `fs` are enum indices. `odr` 4 is 120 Hz. Accelerometer `fs` 3 is ±16 g; gyroscope `fs` 3 is ±1000 dps. **Stop IMU stream** sends `{"log_controller*stop_log":{"interface":0}}`.

**Write framing (phone → board).** Each packet starts with a header byte:

- `0x20`: single packet, followed by a 2-byte big-endian length and the payload.
- `0x00`: first packet, followed by the length and the first chunk.
- `0x40`: middle chunk.
- `0x80`: last chunk.

**Response framing (board → phone).** Responses use the same header bytes but **no length field**.

**Stream packets.** Each notification is 1 byte of sensor ID followed by whole samples, with no timestamp; derive time from the ODR. The firmware caps BLE bandwidth at 4000 B/s (`MAX_BLE_BANDWIDTH`) and downsamples above it. Accelerometer plus gyroscope at 120 Hz is about 1.4 kB/s.

**Still open.** Sample scaling: read `st_ble_stream.*.multiply_factor` from the sensor status. Sensor ID values. Whether v3.4 on the board matches the current repo source.

## First packets

None from the stream yet (run 2 pending).

## Stream metrics

| Metric | Value |
|---|---|
| Packets | 0 |
| Bytes | 0 |
| Packets per second | 0.0 |
| Largest packet gap | 0.0 ms |

## Errors

None shown during scanning, connection, service discovery or monitoring. Monitoring errors were not surfaced on the first run (see above).
