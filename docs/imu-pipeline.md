# Heuristic IMU processing pipeline

The first on-device processing slice turns normalized `ImuSample` measurements into deterministic **candidate** events. It is pure TypeScript and can consume synthetic/replayed samples now and BLE-decoded samples later.

```text
SensorSource -> ImuSample -> validation and health
                         |-> per-sample crash heuristic -> crash_candidate
                         `-> timestamp windows -> features -> swerve heuristic -> swerve_candidate
```

Candidate events do not confirm a crash, impairment, intoxication, or unsafe driving. The defaults are synthetic/demo starting values, not validated safety thresholds or safety certification.

## Input contract

`ImuSample` uses acceleration in g, angular velocity in degrees per second, and a monotonic receive timestamp in milliseconds. Optional sequence values must be non-negative, increasing safe integers within a trip. An adapter for a wrapping hardware counter must unwrap it before normalization.

The validator rejects non-finite or numerically unsafe timestamps, configured sensor-range violations, timestamp regressions, duplicate sequences, and sequence regressions. Stream health reports accepted/rejected totals, rejection reasons, estimated rate, sequence gaps, and the largest receive-time gap. Missing-sample ratios are zero when samples do not provide enough sequence metadata; the pipeline does not invent a nominal BLE rate.

## Processing behavior

`ImuPipeline.process(sample)` is synchronous and deterministic. Accepted samples enter:

- A time-retained ring buffer with a hard sample-count cap.
- A crash detector evaluated for every sample.
- Timestamp-based overlapping windows for feature and swerve evaluation.

Window creation has a maximum catch-up count per input. After an extreme timestamp jump, stale windows beyond that bound are counted as skipped and the scheduler fast-forwards. This prevents malformed timestamps from causing unbounded work. Window storage also has a hard sample-count cap.

The crash detector tracks acceleration magnitude, time above the trigger, excess-acceleration impulse, and peak angular velocity. Hysteresis and cooldown suppress duplicate events. A configurable continuity limit resets an impact episode across a data gap, so duration and impulse never integrate across unobserved time.

Window features currently include acceleration and angular-velocity magnitude statistics, jerk, sample count, observed duration, sequence-based missing ratio, and direction changes/variation on a configured raw sensor rotation axis. The swerve heuristic uses those features with hysteresis and cooldown.

## Mounting and axes

Inputs remain in the raw `sensor` frame. The configured swerve rotation axis is named `x`, `y`, or `z`; the pipeline does not call it forward, lateral, vertical, or yaw. Those vehicle-relative names require a separate mounting calibration and sensor-to-vehicle transform. Until that exists, mount the SensorTile consistently and treat swerve output as experimental.

## Usage

```ts
import { ImuPipeline } from '@/core/imu';

const pipeline = new ImuPipeline();
const result = pipeline.process(sample);

if (result.accepted) {
  for (const event of result.events) {
    // Route candidate events to later alert, aggregation, and storage modules.
  }
}
```

Thresholds and resource limits are constructor-configurable through `PartialImuPipelineConfig`. Call `reset()` between trips to clear validation history, buffers, window scheduling, detector latches, cooldowns, and health metrics.

`ReplaySensorSource` implements the same `SensorSource` boundary as live input. Deterministic stationary, normal-motion, pothole-like, impact, and repeated-rotation fixtures support development without Bluetooth.

## Connecting BLE later

The board-specific adapter will perform only this conversion:

```text
STEVAL-MKBOXPRO notification bytes -> versioned decoder -> ImuSample -> ImuPipeline
```

It must confirm packet layout, units, axes, counter behavior, and sample rate from the v3.4.0 GATT stream. The core pipeline should not import `react-native-ble-plx` or change when the decoder is added.

Before enabling real driver alerts, collect physical SensorTile recordings to measure mounting behavior, normal vibration, packet gaps, false positives per hour, and threshold sensitivity. Log candidate events during that tuning phase rather than presenting them as confirmed safety events.

## Verification

```bash
npm test
npm run typecheck
```

The test suite covers invalid input, health math, bounded buffers and catch-up, gap-safe impact integration, overlapping windows, replay fixtures, reset behavior, and candidate-event suppression.
