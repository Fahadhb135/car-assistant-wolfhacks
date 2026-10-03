# STEVAL-MKBOXPRO diagnostic results

Results from the BLE diagnostic in [bluetooth.md](bluetooth.md), captured on 2026-10-03 with an iPhone 16 Pro Max (iOS 26.6.1) running the Expo dev build.

> Status: GATT layout captured. Notification, packet and stream-metric results are **pending**; sections marked _pending_ are filled in after the monitoring step.

## Firmware

| Item | Value |
|---|---|
| Board model | STEVAL-MKBOXPRO |
| Factory firmware version | v3.4.0 |
| Advertised device name | _pending: copy from the scan list_ |

## GATT layout

Two services, seven characteristics. Every characteristic supports notifications. All UUIDs use the STMicroelectronics BlueST base (`…-11e1-…-0002a5d5c51b`).

| Service | Purpose (per BlueST conventions, unconfirmed on this board) |
|---|---|
| `00000000-000e-11e1-9ab4-0002a5d5c51b` | Debug console (`00000001-000e…` terminal, `00000002-000e…` stderr) |
| `00000000-0001-11e1-9ab4-0002a5d5c51b` | Sensor feature data |

The feature characteristics use the `…-0002-11e1-ac36-…` family, where the first four bytes are a feature ID (`0x0f`, `0x11`, `0x14`, `0x1b`, `0x23`). Which feature each ID carries (accelerometer, gyroscope, etc.) is not confirmed yet; the packet results below will tell us.

| Characteristic | Service | Read | Write | Notify | Packets? | Changes with motion? |
|---|---|---|---|---|---|---|
| `00000001-000e-11e1-ac36-0002a5d5c51b` | `00000000-000e-11e1…` | yes | with response + without response | yes | _pending_ | _pending_ |
| `00000002-000e-11e1-ac36-0002a5d5c51b` | `00000000-000e-11e1…` | yes | no | yes | _pending_ | _pending_ |
| `00000014-0002-11e1-ac36-0002a5d5c51b` | `00000000-0001-11e1…` | no | without response | yes | _pending_ | _pending_ |
| `0000001b-0002-11e1-ac36-0002a5d5c51b` | `00000000-0001-11e1…` | no | without response | yes | _pending_ | _pending_ |
| `0000000f-0002-11e1-ac36-0002a5d5c51b` | `00000000-0001-11e1…` | yes | no | yes | _pending_ | _pending_ |
| `00000011-0002-11e1-ac36-0002a5d5c51b` | `00000000-0001-11e1…` | no | without response | yes | _pending_ | _pending_ |
| `00000023-0002-11e1-ac36-0002a5d5c51b` | `00000000-0001-11e1…` | no | no | yes | _pending_ | _pending_ |

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

_Pending._ Tap **Monitor notifiable characteristics**, keep the board still for a few seconds, then move and rotate it.

- Characteristics monitored: _pending_
- UUIDs producing packets: _pending_
- UUIDs that change when the board moves: _pending_

## First packets

_Pending:_ the `[BLE packet]` entries (up to 20) from Metro.

## Stream metrics

| Metric | Value |
|---|---|
| Packets | _pending_ |
| Bytes | _pending_ |
| Packets per second | _pending_ |
| Largest packet gap | _pending_ |

## Errors

None during scanning, connection or service discovery.
