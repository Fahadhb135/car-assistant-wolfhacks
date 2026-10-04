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

  const corner = run({ x: 0, y: 0.7, z: 1 }, { x: 0, y: 0, z: 90 });
  assert.deepEqual(corner.map((event) => event.kind), ['harsh_corner_candidate']);
  assert.ok(corner[0]!.evidence.peakRotationDps >= 60); // smoothed toward the 90°/s input
  assert.ok(corner[0]!.evidence.headingChangeDeg! >= 45);
});

test('rejects ordinary stops, starts, and gentle turns', () => {
  assert.deepEqual(run({ x: -0.25, y: 0, z: 1 }), []);
  assert.deepEqual(run({ x: 0.3, y: 0, z: 1 }), []);
  assert.deepEqual(run({ x: 0, y: 0.2, z: 1 }, { x: 0, y: 0, z: 12 }), []);
});

type Motion = { x: number; y: number; yaw: number; z?: number; pitch?: number };

/** Feeds a 120 Hz stream whose forward/lateral/yaw values come from `at(ms)`. */
function stream(durationMs: number, at: (ms: number, index: number) => Motion, detector = new DrivingBehaviorDetector(DEFAULT_IMU_PIPELINE_CONFIG.behaviors), startMs = 0) {
  const events = [];
  for (let index = 0, time = 0; time <= durationMs; index++, time = (index * 1_000) / 120) {
    const { x, y, yaw, z = 1, pitch = 0 } = at(time, index);
    events.push(...detector.process(toVehicleFrame(sample(startMs + time, { x, y, z }, { x: 0, y: pitch, z: yaw }), identity)));
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
  const { events } = stream(2_000, (ms, index) => ({
    x: 0,
    y: ms < 100 ? 0 : 0.4 + (index % 2 ? 0.28 : -0.28),
    yaw: ms < 100 ? 0 : 40,
  }));
  assert.deepEqual(events.map((event) => event.kind), ['harsh_corner_candidate']);
});

test('a sharp turn is a big arc; a swerve of small alternating arcs is not a turn', () => {
  // A 90° intersection turn: 0.4 g at 45°/s for two seconds.
  const turn = stream(2_500, (ms) => ({ x: 0, y: ms < 2_000 ? 0.4 : 0, yaw: ms < 2_000 ? 45 : 0 }));
  assert.deepEqual(turn.events.map((event) => event.kind), ['harsh_corner_candidate']);
  // Weaving: 0.5 g and 80°/s, reversing every 400 ms (about 30° each way).
  const weave = stream(3_000, (ms) => {
    const side = Math.floor(ms / 400) % 2 ? -1 : 1;
    return { x: 0, y: 0.5 * side, yaw: 80 * side };
  });
  assert.deepEqual(weave.events, []);
});

test('tilting the board is not braking, but a 2 g stop is a crash even while tilting', () => {
  // Pitching the board 30° in half a second moves half a g of gravity onto the forward axis.
  const tilt = stream(1_500, (ms) => {
    const angle = (Math.min(ms, 500) / 500) * (Math.PI / 6);
    return { x: -Math.sin(angle), y: 0, z: Math.cos(angle), yaw: 0, pitch: ms < 500 ? 60 : 0 };
  });
  assert.deepEqual(tilt.events, []);
  const slam = stream(600, (ms) => ({ x: ms < 100 ? 0 : -2.6, y: 0, yaw: 0, pitch: ms < 100 ? 0 : 120 }));
  assert.deepEqual(slam.events.map((event) => event.kind), ['crash_candidate']);
});

test('learns a shifted mount at rest, so the tilt is not braking but a real stop still is', () => {
  // The board sits 27° nose-down since calibration: 0.45 g of gravity on the forward axis.
  const restingTilt = { x: -0.45, y: 0, z: Math.sqrt(1 - 0.45 ** 2), yaw: 0 };
  const settled = stream(10_000, () => restingTilt);
  assert.deepEqual(settled.events, []);
  const peaks = settled.detector.takeMotionPeaks()!;
  assert.ok(Math.abs(peaks.restingForwardG + 0.45) < 0.02, 'the resting level tracks the tilt');
  // A real stop from there: another 0.5 g within 200 ms.
  const stop = stream(1_500, (ms) => ({ ...restingTilt, x: -0.45 - Math.min(0.5, ms / 400) }), settled.detector, 10_100);
  assert.deepEqual(stop.events.map((event) => event.kind), ['hard_braking_candidate']);
  assert.ok(Math.abs(stop.events[0]!.evidence.peakAccelerationG - 0.5) < 0.05);
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
