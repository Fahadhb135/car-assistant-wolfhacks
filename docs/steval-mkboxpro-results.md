# STEVAL-MKBOXPRO diagnostic results

Results from the BLE diagnostic in [bluetooth.md](bluetooth.md), captured on 2026-10-03 with an iPhone 16 Pro Max (iOS 26.6.1) running the Expo dev build.

> Status: GATT layout captured. Subscribing to all 7 notifiable characteristics produced **no packets**: the board, advertising as `HSD2v34`, appears to be running ST's High Speed Datalog 2 firmware, which likely waits for a start command. Packet and stream-metric results are still pending.

## Firmware

| Item | Value |
|---|---|
| Board model | STEVAL-MKBOXPRO |
| Factory firmware version | v3.4.0 |
| Advertised device name | `HSD2v34` (suggests High Speed Datalog 2 firmware, v3.4) |
| RSSI at capture | −57 dBm |
| Manufacturer data | `30 00 02 13 0d 00 00 00 d0 19 a6 e6 91 b9` (company ID `0x0030` = STMicroelectronics; the last six bytes look like the board's address) |

## GATT layout

Two services, seven characteristics. Every characteristic supports notifications. All UUIDs use the STMicroelectronics BlueST base (`…-11e1-…-0002a5d5c51b`).

| Service | Purpose (per BlueST conventions, unconfirmed on this board) |
|---|---|
| `00000000-000e-11e1-9ab4-0002a5d5c51b` | Debug console (`00000001-000e…` terminal, `00000002-000e…` stderr) |
| `00000000-0001-11e1-9ab4-0002a5d5c51b` | Sensor feature data |

The feature characteristics use the `…-0002-11e1-ac36-…` family, where the first four bytes are a feature ID (`0x0f`, `0x11`, `0x14`, `0x1b`, `0x23`). Which feature each ID carries (accelerometer, gyroscope, etc.) is not confirmed yet; the packet results below will tell us.

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

First run (2026-10-03): the app subscribed to all 7 notifiable characteristics and received **0 packets** while the board was still and while it was moved.

- Characteristics monitored: 7
- UUIDs producing packets: none
- UUIDs that change when the board moves: none

The diagnostic hid subscription errors at the time, so a failed subscription could not be ruled out; it now reports them as `[BLE monitor error]`. The other likely cause is the firmware: with `HSD2v34`, streaming probably has to be started by a command written to one of the writable feature characteristics (`0x11`, `0x14` or `0x1b`) rather than by subscribing alone.

## First packets

None received yet.

## Stream metrics

| Metric | Value |
|---|---|
| Packets | 0 |
| Bytes | 0 |
| Packets per second | 0.0 |
| Largest packet gap | 0.0 ms |

## Errors

None shown during scanning, connection, service discovery or monitoring. Monitoring errors were not surfaced on the first run (see above).
