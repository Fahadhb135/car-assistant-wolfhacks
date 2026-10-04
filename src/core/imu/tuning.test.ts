import assert from 'node:assert/strict';
import test from 'node:test';

import type { ImuSample } from '../sensors/types';
import { DEFAULT_IMU_PIPELINE_CONFIG, resolvePipelineConfig } from './config';
import { ImuPipeline } from './ImuPipeline';
import { DEFAULT_IMU_TUNING, DETECTOR_KEYS, normalizeTuning, SENSITIVITY, tuningToConfig, type ImuTuning } from './tuning';

const withDetector = (key: (typeof DETECTOR_KEYS)[number], patch: object): ImuTuning => ({
  ...DEFAULT_IMU_TUNING,
  detectors: { ...DEFAULT_IMU_TUNING.detectors, [key]: { ...DEFAULT_IMU_TUNING.detectors[key], ...patch } },
});

test('default tuning reproduces the default thresholds', () => {
  assert.deepEqual(tuningToConfig(DEFAULT_IMU_TUNING), resolvePipelineConfig());
});

test('sensitivity 2 halves a detector threshold; every extreme combination stays valid', () => {
  const braking = tuningToConfig(withDetector('hardBraking', { sensitivity: 2 })).behaviors.hardBraking;
  assert.equal(braking.triggerLongitudinalG, DEFAULT_IMU_PIPELINE_CONFIG.behaviors.hardBraking.triggerLongitudinalG / 2);
  for (const sensitivity of [SENSITIVITY.min, SENSITIVITY.max]) {
    for (const tiltGuard of [true, false]) {
      const detectors = Object.fromEntries(DETECTOR_KEYS.map((key) => [key, { enabled: true, sensitivity }]));
      assert.doesNotThrow(() => resolvePipelineConfig(tuningToConfig(normalizeTuning({ detectors, tiltGuard }))));
    }
  }
});

test('normalizes a missing or corrupt saved file to in-range values', () => {
  assert.deepEqual(normalizeTuning(null), DEFAULT_IMU_TUNING);
  const tuning = normalizeTuning({ detectors: { swerve: { enabled: false, sensitivity: 9 } }, turnHeadingDeg: 1 });
  assert.equal(tuning.detectors.swerve.enabled, false);
  assert.equal(tuning.detectors.swerve.sensitivity, SENSITIVITY.max);
  assert.equal(tuning.turnHeadingDeg, 15);
});

test('a switched-off detector never emits, live', () => {
  const sample = (t: number, x: number): ImuSample => ({
    sequence: t,
    receivedMonotonicMs: t * 10,
    accelerationG: { x, y: 0, z: 1 },
    angularVelocityDps: { x: 0, y: 0, z: 0 },
    frame: 'sensor',
  });
  const run = (tuning: ImuTuning) => {
    const pipeline = new ImuPipeline();
    pipeline.setVehicleCalibration({
      version: 1,
      forward: { x: 1, y: 0, z: 0 },
      lateral: { x: 0, y: 1, z: 0 },
      vertical: { x: 0, y: 0, z: 1 },
      createdAtEpochMs: 1,
    });
    pipeline.setTuning(tuning);
    const kinds = [];
    for (let t = 0; t < 150; t++) {
      // Calm, then 0.6 g of braking reached within 200 ms.
      const x = t < 10 ? 0 : -Math.min(0.6, (t - 10) / 20);
      kinds.push(...pipeline.process(sample(t, x)).events.map((event) => event.kind));
    }
    return kinds;
  };
  assert.deepEqual(run(DEFAULT_IMU_TUNING), ['hard_braking_candidate']);
  assert.deepEqual(run(withDetector('hardBraking', { enabled: false })), []);
});
