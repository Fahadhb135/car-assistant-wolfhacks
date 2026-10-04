import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImuSample } from '../sensors/types';
import { CrashCandidateDetector } from './CrashCandidateDetector';
import { DEFAULT_IMU_PIPELINE_CONFIG } from './config';
import { extractWindowFeatures } from './features';
import { ImuPipeline } from './ImuPipeline';
import { SlidingWindowBuilder } from './SlidingWindowBuilder';
import { TimeRingBuffer } from './TimeRingBuffer';
import type { VehicleFrameCalibration } from './VehicleFrame';

const identityCalibration: VehicleFrameCalibration = {
  version: 1,
  forward: { x: 1, y: 0, z: 0 },
  lateral: { x: 0, y: 1, z: 0 },
  vertical: { x: 0, y: 0, z: 1 },
  createdAtEpochMs: 1,
};

function sample(
  receivedMonotonicMs: number,
  sequence = receivedMonotonicMs,
  accelerationG = { x: 0, y: 0, z: 1 },
  angularVelocityDps = { x: 0, y: 0, z: 0 },
): ImuSample {
  return { sequence, receivedMonotonicMs, accelerationG, angularVelocityDps, frame: 'sensor' };
}

test('validates samples and reports accurate stream health', () => {
  const pipeline = new ImuPipeline();
  assert.equal(pipeline.process(sample(0, 0)).accepted, true);
  const duplicate = pipeline.process(sample(20, 0));
  assert.equal(duplicate.accepted, false);
  if (!duplicate.accepted) assert.equal(duplicate.reason, 'duplicate_sequence');
  assert.equal(pipeline.process(sample(40, 3)).accepted, true);
  const invalid = pipeline.process(sample(Number.NaN, 4));
  assert.equal(invalid.accepted, false);
  if (!invalid.accepted) assert.equal(invalid.reason, 'non_finite_value');

  assert.deepEqual(pipeline.getHealth(), {
    receivedCount: 4,
    acceptedCount: 2,
    rejectedCount: 2,
    rejectionCounts: { duplicate_sequence: 1, non_finite_value: 1 },
    estimatedSampleRateHz: 25,
    missingSequenceCount: 2,
    largestInterSampleGapMs: 40,
  });
});

test('rejects implausible ranges and timestamp regressions', () => {
  const pipeline = new ImuPipeline({
    validation: { maximumAbsoluteAccelerationG: 8, maximumAbsoluteAngularVelocityDps: 500 },
  });
  assert.equal(pipeline.process(sample(100, 1)).accepted, true);
  const timestamp = pipeline.process(sample(90, 2));
  const acceleration = pipeline.process(sample(110, 2, { x: 9, y: 0, z: 0 }));
  const angular = pipeline.process(sample(110, 2, undefined, { x: 501, y: 0, z: 0 }));
  const unsafeTimestamp = pipeline.process(sample(Number.MAX_SAFE_INTEGER * 2, 2));
  assert.equal(timestamp.accepted ? undefined : timestamp.reason, 'timestamp_regression');
  assert.equal(acceleration.accepted ? undefined : acceleration.reason, 'acceleration_out_of_range');
  assert.equal(angular.accepted ? undefined : angular.reason, 'angular_velocity_out_of_range');
  assert.equal(unsafeTimestamp.accepted ? undefined : unsafeTimestamp.reason, 'timestamp_out_of_range');
});

test('ring buffer is bounded by both time and sample count', () => {
  const buffer = new TimeRingBuffer(100, 3);
  for (let index = 0; index < 10; index += 1) buffer.push(sample(0, index));
  assert.deepEqual(buffer.values().map((value) => value.sequence), [7, 8, 9]);
  buffer.push(sample(200, 10));
  assert.deepEqual(buffer.values().map((value) => value.sequence), [10]);
});

test('builds overlapping timestamp windows and bounds catch-up work', () => {
  const builder = new SlidingWindowBuilder({
    durationMs: 100,
    stepMs: 50,
    maximumCatchUpWindows: 2,
    maximumBufferedSamples: 10,
  });
  builder.push(sample(0, 0));
  builder.push(sample(40, 1));
  const first = builder.push(sample(100, 2));
  assert.deepEqual(first.windows.map(({ startedAtMs, endedAtMs }) => [startedAtMs, endedAtMs]), [[0, 100]]);
  assert.deepEqual(first.windows[0]!.samples.map((value) => value.receivedMonotonicMs), [0, 40]);
  const jump = builder.push(sample(1_000, 3));
  assert.equal(jump.windows.length, 2);
  assert.equal(jump.skippedWindowCount, 16);

  const extremeBuilder = new SlidingWindowBuilder({
    durationMs: 100,
    stepMs: 50,
    maximumCatchUpWindows: 2,
    maximumBufferedSamples: 10,
  });
  extremeBuilder.push(sample(0, 0));
  const extremeJump = extremeBuilder.push(sample(1e300, 1));
  assert.equal(extremeJump.windows.length, 2);
  assert.equal(extremeJump.skippedWindowCount, Number.MAX_SAFE_INTEGER);
});

test('extracts finite, hand-checkable features from irregular samples', () => {
  const features = extractWindowFeatures({
    startedAtMs: 0,
    endedAtMs: 2_000,
    samples: [
      sample(0, 0, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -10 }),
      sample(1_000, 2, { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 10 }),
    ],
  }, 'z', 1);
  assert.equal(features.accelerationMagnitudeMeanG, 1.5);
  assert.equal(features.accelerationMagnitudeStandardDeviationG, 0.5);
  assert.equal(features.accelerationMagnitudeMaximumG, 2);
  assert.equal(features.jerkMeanGps, 1);
  assert.equal(features.missingSampleRatio, 0.5);
  assert.equal(features.rotationAxisDirectionChanges, 1);
  assert.equal(features.rotationAxisStandardDeviationDps, 10);
});

test('crash detector rejects a spike and never integrates across a stream gap', () => {
  const detector = new CrashCandidateDetector({
    ...DEFAULT_IMU_PIPELINE_CONFIG.crash,
    triggerAccelerationG: 3,
    releaseAccelerationG: 1.5,
    minimumDurationMs: 60,
    minimumImpulseGSeconds: 10,
    minimumAngularVelocityDps: 20,
    maximumContinuityGapMs: 50,
  });
  const impact = { x: 4, y: 0, z: 0 };
  const rotation = { x: 0, y: 0, z: 50 };
  assert.equal(detector.process(sample(0, 0, impact, rotation)), undefined);
  assert.equal(detector.process(sample(200, 1, impact, rotation)), undefined);
  assert.equal(detector.process(sample(240, 2, impact, rotation)), undefined);
  detector.reset();
  assert.equal(detector.process(sample(0, 0, impact, rotation)), undefined);
  assert.equal(detector.process(sample(40, 1, impact, rotation)), undefined);
  assert.equal(detector.process(sample(80, 2, impact, rotation))?.kind, 'crash_candidate');
});

test('reset clears validator, health, buffers, windows, and detectors', () => {
  const pipeline = new ImuPipeline({ maximumBufferedSamples: 5 });
  pipeline.process(sample(100, 10));
  pipeline.reset();
  assert.deepEqual(pipeline.getHealth(), {
    receivedCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    rejectionCounts: {},
    estimatedSampleRateHz: 0,
    missingSequenceCount: 0,
    largestInterSampleGapMs: 0,
  });
  assert.equal(pipeline.getBufferedSamples().length, 0);
  assert.equal(pipeline.process(sample(0, 0)).accepted, true);
});

test('crash has same-sample precedence over a calibrated maneuver candidate', () => {
  const pipeline = new ImuPipeline({
    nonCrashMotionCooldownMs: 60_000,
    crash: {
      triggerAccelerationG: 3,
      minimumDurationMs: 20,
      minimumImpulseGSeconds: 10,
      minimumAngularVelocityDps: 20,
    },
    behaviors: {
      hardBraking: { triggerLongitudinalG: 0.4, minimumDurationMs: 20, minimumJerkGps: 0 },
    },
  });
  pipeline.setVehicleCalibration(identityCalibration);
  pipeline.process(sample(0, 0));
  pipeline.process(sample(20, 1, { x: -5, y: 0, z: 1 }, { x: 0, y: 0, z: 50 }));
  const collision = pipeline.process(sample(40, 2, { x: -5, y: 0, z: 1 }, { x: 0, y: 0, z: 50 }));
  assert.deepEqual(collision.events.map((event) => event.kind), ['crash_candidate']);
  assert.equal(collision.arbitration.suppressedByKind.hard_braking_candidate, 1);
});

test('global non-crash arbitration has deterministic priority and admits at the exact 60s boundary', () => {
  const pipeline = new ImuPipeline({
    nonCrashMotionCooldownMs: 60_000,
    behaviors: {
      maximumContinuityGapMs: 100,
      hardBraking: { triggerLongitudinalG: 0.4, minimumDurationMs: 20, minimumJerkGps: 0, cooldownMs: 0 },
      rapidAcceleration: { triggerLongitudinalG: 0.4, minimumDurationMs: 20, minimumJerkGps: 0, cooldownMs: 0 },
      harshCornering: {
        triggerLateralG: 0.4,
        minimumYawRateDps: 20,
        minimumDurationMs: 20,
        cooldownMs: 0,
      },
    },
  });
  pipeline.setVehicleCalibration(identityCalibration);
  pipeline.process(sample(0, 0));
  pipeline.process(sample(20, 1, { x: -0.8, y: 0.8, z: 1 }, { x: 0, y: 0, z: 50 }));
  const overlap = pipeline.process(sample(40, 2, { x: -0.8, y: 0.8, z: 1 }, { x: 0, y: 0, z: 50 }));
  assert.deepEqual(overlap.events.map((event) => event.kind), ['hard_braking_candidate']);
  assert.equal(overlap.arbitration.suppressedByKind.harsh_corner_candidate, 1);

  pipeline.process(sample(60, 3));
  pipeline.process(sample(80, 4, { x: 0.8, y: 0, z: 1 }));
  const cooled = pipeline.process(sample(100, 5, { x: 0.8, y: 0, z: 1 }));
  assert.deepEqual(cooled.events, []);
  assert.equal(cooled.arbitration.suppressedByKind.rapid_acceleration_candidate, 1);

  // A stream gap clears detector episodes but never bypasses the global monotonic cooldown.
  pipeline.process(sample(60_000, 6));
  pipeline.process(sample(60_020, 7, { x: -0.8, y: 0, z: 1 }));
  const boundary = pipeline.process(sample(60_040, 8, { x: -0.8, y: 0, z: 1 }));
  assert.deepEqual(boundary.events.map((event) => event.kind), ['hard_braking_candidate']);

  pipeline.reset();
  assert.deepEqual(pipeline.getArbitrationState(), {
    nonCrashCooldownUntilMs: null,
    nonCrashCooldownRemainingMs: 0,
    suppressedCount: 0,
    suppressedByKind: {},
  });
});

test('pipeline remains bounded during an extended equal-timestamp stream', () => {
  const pipeline = new ImuPipeline({ maximumBufferedSamples: 25, windows: { maximumBufferedSamples: 30 } });
  for (let index = 0; index < 10_000; index += 1) pipeline.process(sample(0, index));
  assert.equal(pipeline.getBufferedSamples().length, 25);
});
