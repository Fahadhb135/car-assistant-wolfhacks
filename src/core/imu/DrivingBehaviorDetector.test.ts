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
  const braking = run({ x: -0.5, y: 0, z: 1 });
  assert.deepEqual(braking.map((event) => event.kind), ['hard_braking_candidate']);
  assert.ok(braking[0]!.evidence.peakJerkGps > 0);

  const acceleration = run({ x: 0.45, y: 0, z: 1 });
  assert.deepEqual(acceleration.map((event) => event.kind), ['rapid_acceleration_candidate']);

  const corner = run({ x: 0, y: 0.55, z: 1 }, { x: 0, y: 0, z: 35 });
  assert.deepEqual(corner.map((event) => event.kind), ['harsh_corner_candidate']);
  assert.ok(corner[0]!.evidence.peakRotationDps >= 35);
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
  const hardBrake = { x: -0.5, y: 0, z: 1 };
  detector.process(toVehicleFrame(sample(0), identity));
  detector.process(toVehicleFrame(sample(80, hardBrake), identity));
  detector.process(toVehicleFrame(sample(160, hardBrake), identity));
  const afterGap = detector.process(toVehicleFrame(sample(500, hardBrake), identity));
  assert.deepEqual(afterGap, []);
});
