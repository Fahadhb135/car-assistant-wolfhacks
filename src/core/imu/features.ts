import type { ImuSample, Vector3 } from '../sensors/types';
import type { SensorAxis, TimeWindow, WindowFeatures } from './types';

function magnitude(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[], average = mean(values)): number {
  if (values.length === 0) return 0;
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function missingSampleRatio(samples: readonly ImuSample[]): number {
  let observedTransitions = 0;
  let missing = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!.sequence;
    const current = samples[index]!.sequence;
    if (previous === undefined || current === undefined || current <= previous) continue;
    observedTransitions += 1;
    missing += Math.max(0, current - previous - 1);
  }
  const expectedTransitions = observedTransitions + missing;
  return expectedTransitions === 0 ? 0 : missing / expectedTransitions;
}

function directionChanges(values: readonly number[], deadband: number): number {
  let previousSign = 0;
  let changes = 0;
  for (const value of values) {
    if (Math.abs(value) < deadband) continue;
    const sign = Math.sign(value);
    if (previousSign !== 0 && sign !== previousSign) changes += 1;
    previousSign = sign;
  }
  return changes;
}

export function extractWindowFeatures(
  window: TimeWindow,
  rotationAxis: SensorAxis,
  directionDeadbandDps: number,
): WindowFeatures {
  const accelerationMagnitudes = window.samples.map((sample) => magnitude(sample.accelerationG));
  const angularMagnitudes = window.samples.map((sample) => magnitude(sample.angularVelocityDps));
  const axisValues = window.samples.map((sample) => sample.angularVelocityDps[rotationAxis]);
  const jerks: number[] = [];
  for (let index = 1; index < window.samples.length; index += 1) {
    const previous = window.samples[index - 1]!;
    const current = window.samples[index]!;
    const elapsedSeconds = (current.receivedMonotonicMs - previous.receivedMonotonicMs) / 1_000;
    if (elapsedSeconds <= 0) continue;
    jerks.push(Math.hypot(
      current.accelerationG.x - previous.accelerationG.x,
      current.accelerationG.y - previous.accelerationG.y,
      current.accelerationG.z - previous.accelerationG.z,
    ) / elapsedSeconds);
  }
  const accelerationMean = mean(accelerationMagnitudes);
  const angularMean = mean(angularMagnitudes);
  const first = window.samples[0];
  const last = window.samples.at(-1);
  return Object.freeze({
    startedAtMs: window.startedAtMs,
    endedAtMs: window.endedAtMs,
    sampleCount: window.samples.length,
    observedDurationMs: first && last ? last.receivedMonotonicMs - first.receivedMonotonicMs : 0,
    missingSampleRatio: missingSampleRatio(window.samples),
    accelerationMagnitudeMeanG: accelerationMean,
    accelerationMagnitudeStandardDeviationG: standardDeviation(accelerationMagnitudes, accelerationMean),
    accelerationMagnitudeMaximumG: maximum(accelerationMagnitudes),
    angularVelocityMagnitudeMeanDps: angularMean,
    angularVelocityMagnitudeStandardDeviationDps: standardDeviation(angularMagnitudes, angularMean),
    angularVelocityMagnitudeMaximumDps: maximum(angularMagnitudes),
    jerkMeanGps: mean(jerks),
    jerkMaximumGps: maximum(jerks),
    rotationAxisDirectionChanges: directionChanges(axisValues, directionDeadbandDps),
    rotationAxisStandardDeviationDps: standardDeviation(axisValues),
  });
}
