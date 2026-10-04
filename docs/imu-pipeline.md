# Heuristic IMU processing pipeline

The on-device processing pipeline turns normalized `ImuSample` measurements into deterministic **candidate** events. It is pure TypeScript and consumes both synthetic/replayed samples and the live BLE-decoded STEVAL-MKBOXPRO stream.

```text
SensorSource -> ImuSample -> validation and health
                         |-> per-sample crash heuristic -> crash_candidate
                         |-> timestamp windows -> features -> swerve_candidate
                         `-> calibrated vehicle frame
                               |-> hard_braking_candidate
                               |-> rapid_acceleration_candidate
                               `-> harsh_corner_candidate
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
- When a valid mount calibration is available, a sensor-to-vehicle transform and constant-memory braking, acceleration, and cornering detectors.

Window creation has a maximum catch-up count per input. After an extreme timestamp jump, stale windows beyond that bound are counted as skipped and the scheduler fast-forwards. This prevents malformed timestamps from causing unbounded work. Window storage also has a hard sample-count cap.

The crash detector tracks acceleration magnitude, time above the trigger, excess-acceleration impulse, and peak angular velocity. Hysteresis and cooldown suppress duplicate events. A configurable continuity limit resets an impact episode across a data gap, so duration and impulse never integrate across unobserved time.

Window features currently include acceleration and angular-velocity magnitude statistics, jerk, sample count, observed duration, sequence-based missing ratio, and direction changes/variation on a configured raw sensor rotation axis. The swerve heuristic uses those features with hysteresis and cooldown.

## Mount calibration and vehicle axes

Hardware decoding still produces raw `sensor`-frame values. For a new SensorTile, the live drive collects a short stationary sample, estimates the gravity/vertical direction, and projects the board's X-axis onto the horizontal plane as vehicle-forward. The board must be mounted flat and secure with its X arrow facing the front of the vehicle. The resulting orthonormal forward/lateral/vertical transform is persisted per BLE device ID and can be replaced with **Recalibrate** on the drive screen.

Calibration is rejected when the sample contains excessive acceleration variation, rotation, too few samples, or a degenerate orientation. Crash and raw-axis swerve processing continue, but hard-braking, rapid-acceleration, and harsh-corner candidates remain disabled until calibration succeeds.

The behavior detectors use configurable trigger/release hysteresis, minimum duration, continuity gaps, and cooldowns. Longitudinal candidates also require a jerk transition. Cornering requires both lateral acceleration and yaw-rate evidence, which prevents an isolated vertical road bump from being called a corner. Evidence includes duration, peak acceleration, jerk, and rotation for tuning. Defaults are provisional and must be validated with controlled recordings.

## Usage

```ts
import { ImuPipeline } from '@/core/imu';

const pipeline = new ImuPipeline();
pipeline.setVehicleCalibration(savedCalibration); // enables vehicle-relative behaviors
const result = pipeline.process(sample);

if (result.accepted) {
  for (const event of result.events) {
    // Route candidate events to later alert, aggregation, and storage modules.
  }
}
```

Thresholds and resource limits are constructor-configurable through `PartialImuPipelineConfig`. `setVehicleCalibration(undefined)` disables vehicle-relative behaviors without disabling crash/swerve processing. Call `reset()` between trips to clear validation history, buffers, window scheduling, detector latches, cooldowns, and health metrics.

`ReplaySensorSource` and `StevalMkboxProSensorSource` implement the same `SensorSource` boundary. Deterministic stationary, normal-motion, pothole-like, impact, and repeated-rotation fixtures support development without Bluetooth.

## Live Bluetooth boundary

The hardware integration performs this conversion:

```text
STEVAL-MKBOXPRO notification bytes
  -> DATALOG2 v3.4 profile and strict batch decoder
  -> bounded accelerometer/gyroscope FIFO synchronization
  -> synthetic 120 Hz timestamps and local sequence
  -> ImuSample
  -> ImuPipeline
```

DATALOG2 sends accelerometer and gyroscope data in separate 40-sample packets without timestamps or packet sequence numbers. `StevalImuSynchronizer` pairs batches by arrival ordinal, anchors the first completed pair to BLE receive time, and advances a synthetic clock by `1000 / 120` ms per sample. Queue bounds prevent unbounded growth; a sustained sensor imbalance drops queued batches and reports a resynchronization error.

This alignment is best effort: the payload cannot prove perfect cross-sensor alignment or detect every lost BLE packet. Scale factors are explicit in the v3.4 profile and remain provisional until verified from the firmware's `st_ble_stream.*.multiply_factor` response. The output remains in the raw sensor frame.

The hardware-specific code stays under `src/integrations/bluetooth`; `src/core/imu` does not import Bluetooth or React Native.

Before enabling real driver alerts, collect physical SensorTile recordings to measure mounting behavior, normal vibration, packet gaps, false positives per hour, and threshold sensitivity. Log candidate events during that tuning phase rather than presenting them as confirmed safety events.

## Verification

```bash
npm test
npm run typecheck
```

The test suite covers invalid input, health math, bounded buffers and catch-up, gap-safe impact integration, calibration success/rejection and alternate orientations, braking/acceleration/corner detection, road-bump rejection, overlapping windows, replay fixtures, reset behavior, and candidate-event suppression.
