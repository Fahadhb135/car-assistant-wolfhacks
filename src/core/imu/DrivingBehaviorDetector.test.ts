import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImuSample } from '../sensors/types';
import { DEFAULT_IMU_PIPELINE_CONFIG } from './config';
import { DrivingBehaviorDetector } from './DrivingBehaviorDetector';
import {
  MountCalibrationCollector,
  toVehicleFrame,
  type VehicleFrameCalibration,
} from './VehicleFrame';

const identity: VehicleFrameCalibration = {
  version: 1,
  forward: { x: 1, y: 0, z: 0 },
  lateral: { x: 0, y: 1, z: 0 },
  vertical: { x: 0, y: 0, z: 1 },
  createdAtEpochMs: 1,
};

function sample(
  receivedMonotonicMs: number,
  accelerationG = { x: 0, y: 0, z: 1 },
  angularVelocityDps = { x: 0, y: 0, z: 0 },
): ImuSample {
  return { sequence: receivedMonotonicMs / 10, receivedMonotonicMs, accelerationG, angularVelocityDps, frame: 'sensor' };
}

function run(
  accelerationG: { x: number; y: number; z: number },
  angularVelocityDps = { x: 0, y: 0, z: 0 },
) {
  const detector = new DrivingBehaviorDetector(DEFAULT_IMU_PIPELINE_CONFIG.behaviors);
  const events = [];
  detector.process(toVehicleFrame(sample(0), identity));
  for (let time = 20; time <= 800; time += 20) {
    events.push(...detector.process(toVehicleFrame(sample(time, accelerationG, angularVelocityDps), identity)));
  }
  return events;
}

test('calibrates a flat, stationary board and transforms alternate mounting orientation', () => {
  const collector = new MountCalibrationCollector({
    stationaryDurationMs: 100,
    minimumSamples: 3,
    maximumSamples: 20,
    maximumAccelerationStdDevG: 0.02,
    maximumMeanAngularVelocityDps: 1,
    forwardAxis: 'x',
  });
  collector.add(sample(0, { x: 0, y: 1, z: 0 }));
  collector.add(sample(50, { x: 0, y: 1, z: 0 }));
  const result = collector.add(sample(100, { x: 0, y: 1, z: 0 }), 123);
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  const transformed = toVehicleFrame(sample(120, { x: -0.4, y: 1, z: 0 }), result.calibration);
  assert.ok(Math.abs(transformed.accelerationG.forward + 0.4) < 1e-9);
  assert.ok(Math.abs(transformed.accelerationG.vertical - 1) < 1e-9);
});

test('rejects calibration while the sensor is moving', () => {
  const collector = new MountCalibrationCollector({
    stationaryDurationMs: 100,
    minimumSamples: 3,
    maximumSamples: 20,
    maximumAccelerationStdDevG: 0.01,
    maximumMeanAngularVelocityDps: 1,
    forwardAxis: 'x',
  });
  collector.add(sample(0));
  collector.add(sample(50, { x: 0, y: 0, z: 1.3 }, { x: 0, y: 0, z: 10 }));
  const result = collector.add(sample(100));
  assert.equal(result.status, 'rejected');
});

test('detects hard braking, rapid acceleration, and harsh cornering once per maneuver', () => {
  const braking = run({ x: -0.65, y: 0, z: 1 });
  assert.deepEqual(braking.map((event) => event.kind), ['hard_braking_candidate']);
  assert.ok(braking[0]!.evidence.peakJerkGps > 0);

  const acceleration = run({ x: 0.6, y: 0, z: 1 });
  assert.deepEqual(acceleration.map((event) => event.kind), ['rapid_acceleration_candidate']);

  const corner = run({ x: 0, y: 0.7, z: 1 }, { x: 0, y: 0, z: 45 });
  assert.deepEqual(corner.map((event) => event.kind), ['harsh_corner_candidate']);
  assert.ok(corner[0]!.evidence.peakRotationDps >= 30); // smoothed toward the 45°/s input
});

test('rejects ordinary stops, starts, and gentle turns', () => {
  assert.deepEqual(run({ x: -0.25, y: 0, z: 1 }), []);
  assert.deepEqual(run({ x: 0.3, y: 0, z: 1 }), []);
  assert.deepEqual(run({ x: 0, y: 0.2, z: 1 }, { x: 0, y: 0, z: 12 }), []);
});

/** Feeds a 120 Hz stream whose forward/lateral/yaw values come from `at(ms)`. */
function stream(durationMs: number, at: (ms: number, index: number) => { x: number; y: number; yaw: number }) {
  const detector = new DrivingBehaviorDetector(DEFAULT_IMU_PIPELINE_CONFIG.behaviors);
  const events = [];
  for (let index = 0, time = 0; time <= durationMs; index++, time = (index * 1_000) / 120) {
    const { x, y, yaw } = at(time, index);
    events.push(...detector.process(toVehicleFrame(sample(time, { x, y, z: 1 }, { x: 0, y: 0, z: yaw }), identity)));
  }
  return { events, detector };
}

test('calls drastic slowing a possible crash rather than firm braking', () => {
  const { events } = stream(600, (ms) => ({ x: ms < 100 ? 0 : -1.8, y: 0, yaw: 0 }));
  const crash = events.find((event) => event.kind === 'crash_candidate');
  assert.ok(crash, 'a sustained 1.8 g deceleration is beyond any brakes');
  assert.equal(crash.severity, 'critical');
  assert.ok(crash.evidence.peakAccelerationG >= 1.2);
});

test('firm braking needs a jerky onset, not just a high deceleration', () => {
  // Easing into 0.5 g over two seconds (0.25 g/s) is smooth driving.
  const gradual = stream(3_000, (ms) => ({ x: -Math.min(0.5, ms / 4_000), y: 0, yaw: 0 }));
  assert.deepEqual(gradual.events, []);
  // Stamping on the brakes: 0.5 g within 200 ms (2.5 g/s).
  const stamp = stream(1_500, (ms) => ({ x: -Math.min(0.5, ms / 400), y: 0, yaw: 0 }));
  assert.deepEqual(stamp.events.map((event) => event.kind), ['hard_braking_candidate']);
  assert.ok(stamp.events[0]!.evidence.peakJerkGps >= 1);
});

test('vibration around a normal slowdown is neither jerk nor braking', () => {
  const { events } = stream(2_000, (_ms, index) => ({ x: -0.25 + (index % 2 ? 0.12 : -0.12), y: 0, yaw: 0 }));
  assert.deepEqual(events, []);
});

test('detects a sharp turn even when road vibration dips each sample below release', () => {
  const { events } = stream(1_500, (ms, index) => ({
    x: 0,
    y: ms < 100 ? 0 : 0.4 + (index % 2 ? 0.28 : -0.28),
    yaw: ms < 100 ? 0 : 30,
  }));
  assert.deepEqual(events.map((event) => event.kind), ['harsh_corner_candidate']);
});

test('reports smoothed motion peaks since the last read', () => {
  const { detector } = stream(1_000, (ms) => ({ x: ms < 500 ? 0 : -0.3, y: 0.1, yaw: 5 }));
  const peaks = detector.takeMotionPeaks();
  assert.ok(peaks);
  assert.ok(peaks.minimumForwardG < -0.25 && peaks.minimumForwardG >= -0.3);
  assert.ok(Math.abs(peaks.maximumLateralG - 0.1) < 1e-9);
  assert.equal(detector.takeMotionPeaks(), undefined);
});

test('does not call an isolated road bump a driving behavior', () => {
  const detector = new DrivingBehaviorDetector(DEFAULT_IMU_PIPELINE_CONFIG.behaviors);
  const events = [
    detector.process(toVehicleFrame(sample(0), identity)),
    detector.process(toVehicleFrame(sample(20, { x: 0, y: 0, z: 2.5 }), identity)),
    detector.process(toVehicleFrame(sample(40), identity)),
  ].flat();
  assert.deepEqual(events, []);
});

test('does not integrate a behavior across a stream gap', () => {
  const detector = new DrivingBehaviorDetector(DEFAULT_IMU_PIPELINE_CONFIG.behaviors);
  const hardBrake = { x: -0.65, y: 0, z: 1 };
  detector.process(toVehicleFrame(sample(0), identity));
  detector.process(toVehicleFrame(sample(80, hardBrake), identity));
  detector.process(toVehicleFrame(sample(160, hardBrake), identity));
  const afterGap = detector.process(toVehicleFrame(sample(500, hardBrake), identity));
  assert.deepEqual(afterGap, []);
});
