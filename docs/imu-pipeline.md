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

Candidate events do not confirm a crash, impairment, intoxication, or unsafe driving. A mapped crash remains `confirmed: false`; it only asks the driver whether they are okay. The defaults are conservative synthetic/replay starting values, not physically validated safety thresholds or safety certification.

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

Crash has absolute same-sample precedence. When multiple non-crash detectors emit together, the pipeline keeps exactly one in this deterministic order: hard braking, harsh cornering, rapid acceleration, then swerve. A global monotonic 15-second cooldown then permits at most one non-crash IMU candidate per 15 seconds (the exact boundary is admitted). A stream gap does not bypass that cooldown. `result.arbitration` and `getArbitrationState()` expose cooldown time plus total/per-kind suppression counts; `reset()` clears them.

Window features currently include acceleration and angular-velocity magnitude statistics, jerk, sample count, observed duration, sequence-based missing ratio, and direction changes/variation on a configured raw sensor rotation axis. The swerve heuristic uses those features with hysteresis and cooldown.

## Mount calibration and vehicle axes

Hardware decoding still produces raw `sensor`-frame values. For a new SensorTile, the live drive collects a short stationary sample, estimates the gravity/vertical direction, and projects the board's X-axis onto the horizontal plane as vehicle-forward. The board must be mounted flat and secure with its X arrow facing the front of the vehicle. The resulting orthonormal forward/lateral/vertical transform is persisted per BLE device ID and can be replaced with **Recalibrate** on the drive screen.

Calibration is rejected when the sample contains excessive acceleration variation, rotation, too few samples, or a degenerate orientation. Crash and raw-axis swerve processing continue, but hard-braking, rapid-acceleration, and harsh-corner candidates remain disabled until calibration succeeds.

The behavior detectors first low-pass filter the vehicle-frame forward, lateral, and yaw signals (100 ms time constant). At 120 Hz the raw sample-to-sample difference is mostly sensor noise and engine vibration: unfiltered, noise alone exceeded the jerk gate and vibration kept breaking corner episodes apart. They then use configurable trigger/release hysteresis, minimum duration, continuity gaps, and cooldowns. Longitudinal candidates also require a jerk transition, counted from the release level so the onset of the maneuver is included.

Three guards separate driving from board handling (all measured on hand tests, where tilting and twisting produced false braking and turns):

- **Resting level.** While the board is still (total acceleration within 0.02 g of 1 g, rotation under 3°/s) the forward/lateral reading can only be gravity from a mount that shifted since calibration. It is tracked with a 3 s time constant and subtracted, so a board that sags 27° does not read as permanent 0.45 g braking.
- **Tilt guard.** Braking, acceleration, cornering, and drastic slowing are ignored while the board pitches or rolls faster than 45°/s, because tilting moves gravity onto those axes; a car pitches and rolls only a few °/s. Drastic slowing of 2 g or more is still a possible crash, since tilt adds at most 1 g.
- **Heading.** A sharp turn must sweep at least 45° in one direction. Swerves and lane changes reverse after small arcs, which passes the yaw rate through zero and restarts the count. Cornering requires both lateral acceleration and yaw-rate evidence, which prevents an isolated vertical road bump from being called a corner. Evidence includes duration, peak acceleration, jerk, and rotation for tuning.

### Defaults

| Detector | Trigger evidence | Sustained duration / quality |
|---|---|---|
| Possible crash (impact) | acceleration magnitude ≥ 4.5 g and peak rotation ≥ 35°/s | ≥ 80 ms or ≥ 0.16 g·s excess impulse; 100 ms maximum continuity gap |
| Possible crash (drastic slowing, calibrated) | smoothed forward acceleration ≤ -1.2 g, beyond what tyres can brake; release at -0.6 g | ≥ 120 ms; no fast tilt unless ≥ 2 g |
| Swerve | ≥ 4 direction changes, rotation-axis SD ≥ 35°/s, acceleration-magnitude SD ≥ 0.18 g | ≥ 40 samples, ≤ 15% missing samples |
| Firm braking | smoothed forward acceleration ≤ -0.35 g; release at -0.15 g | ≥ 250 ms, jerk ≥ 1 g/s (about 10 m/s³), no fast tilt |
| Rapid acceleration | forward acceleration ≥ 0.40 g; release at 0.18 g | ≥ 500 ms and jerk ≥ 0.60 g/s |
| Sharp turn | smoothed lateral acceleration ≥ 0.30 g and yaw ≥ 15°/s | ≥ 300 ms and ≥ 45° of heading in one direction, no fast tilt; release below 0.15 g or 6°/s |

For scale: a brisk 90° turn at 15 mph pulls about 0.4 g at 35°/s, and a gentle one stays under 0.25 g.

Detector-local crash, swerve, and maneuver cooldowns default to 10 seconds. The global non-crash cooldown is 15 seconds (it was 60, which hid a turn whenever braking into it had just fired).

In a development build, a live drive logs the smoothed extremes to Metro every 2 seconds, plus every candidate's evidence, for tuning against real drives:

```
[imu] fwd -0.42..0.08 g, lat 0.31 g, yaw 27°/s, tilt 4°/s, jerk 1.40 g/s (rest fwd -0.03, lat 0.01)
[imu] harsh_corner_candidate {"durationMs":900,"peakAccelerationG":0.33,...,"headingChangeDeg":52}
``` Every value remains constructor-configurable and provisional pending physical validation.

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

Thresholds and resource limits are constructor-configurable through `PartialImuPipelineConfig`, including `nonCrashMotionCooldownMs`. `setVehicleCalibration(undefined)` disables vehicle-relative behaviors without disabling crash/swerve processing. Call `reset()` between trips to clear validation history, buffers, window scheduling, detector latches, cooldowns, suppression diagnostics, and health metrics.

## Drive event gate and crash quiet mode

Live IMU and location events both enter the same per-drive `DriveEventGate` before trip retention, coach-card updates, or `VoiceCoordinator`. The first possible crash is retained and spoken once, with `confirmed: false`, and starts a 15-second quiet interval measured with an injected monotonic clock. During that interval all later automatic events—including secondary crash/maneuver candidates and location coaching—are rejected, so they cannot churn the warning card, enter the trip, or queue speech. GPS fixes, speed state, map/BLE work, elapsed timers, chat/user controls, and End drive continue normally.

`DriveEventGate.snapshot()` reports whether quiet mode is active, its monotonic deadline/remaining time, admitted and suppressed totals, and suppression counts by app-wide event kind. The live hook also exposes the latest snapshot as `suppression`. A new drive creates a new gate; disposal drops the old router. On crash, `VoiceCoordinator` releases queued lower-priority automatic/chat streams, preempts lower-priority speech, and deduplicates the possible-crash check.

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

Physical iPhone/SensorTile retesting is still required to measure mounting behavior, normal vibration, packet gaps, false positives per hour, threshold sensitivity, and quiet-mode UX. This repository change is verified with deterministic replay and mocked events only. Do not validate with a real crash or dangerous road maneuvers; use stationary captures, normal driving by a passenger-operated setup, and synthetic/replay positives. Candidate events must never be presented as confirmed safety events.

## Verification

```bash
npm test
npm run typecheck
```

The test suite covers invalid input, health math, bounded buffers and catch-up, gap-safe impact integration, calibration success/rejection and alternate orientations, braking/acceleration/corner detection, road-bump rejection, overlapping windows, replay fixtures, reset behavior, and candidate-event suppression.
