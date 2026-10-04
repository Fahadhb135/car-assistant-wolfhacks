import type { ImuSample, Vector3 } from '../sensors/types';

export type ForwardAxis = 'x' | '-x' | 'y' | '-y';

export type VehicleFrameCalibration = Readonly<{
  version: 1;
  forward: Vector3;
  lateral: Vector3;
  vertical: Vector3;
  createdAtEpochMs: number;
}>;

export type VehicleFrameSample = Readonly<{
  sequence?: number;
  receivedMonotonicMs: number;
  accelerationG: Readonly<{ forward: number; lateral: number; vertical: number }>;
  angularVelocityDps: Readonly<{ forward: number; lateral: number; vertical: number }>;
}>;

export type MountCalibrationConfig = Readonly<{
  stationaryDurationMs: number;
  minimumSamples: number;
  maximumSamples: number;
  maximumAccelerationStdDevG: number;
  maximumMeanAngularVelocityDps: number;
  forwardAxis: ForwardAxis;
}>;

export const DEFAULT_MOUNT_CALIBRATION_CONFIG: MountCalibrationConfig = Object.freeze({
  stationaryDurationMs: 1_500,
  minimumSamples: 60,
  maximumSamples: 600,
  maximumAccelerationStdDevG: 0.04,
  maximumMeanAngularVelocityDps: 3,
  forwardAxis: 'x',
});

export type CalibrationProgress =
  | Readonly<{ status: 'collecting'; progress: number }>
  | Readonly<{ status: 'rejected'; reason: string }>
  | Readonly<{ status: 'ready'; calibration: VehicleFrameCalibration }>;

const dot = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const magnitude = (v: Vector3): number => Math.hypot(v.x, v.y, v.z);
const scale = (v: Vector3, amount: number): Vector3 => ({ x: v.x * amount, y: v.y * amount, z: v.z * amount });
const subtract = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

function normalize(v: Vector3): Vector3 | undefined {
  const length = magnitude(v);
  if (!Number.isFinite(length) || length < 1e-6) return undefined;
  return Object.freeze(scale(v, 1 / length));
}

function axisVector(axis: ForwardAxis): Vector3 {
  switch (axis) {
    case 'x': return { x: 1, y: 0, z: 0 };
    case '-x': return { x: -1, y: 0, z: 0 };
    case 'y': return { x: 0, y: 1, z: 0 };
    case '-y': return { x: 0, y: -1, z: 0 };
  }
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

/** Collects a short stationary sample and derives an orthonormal vehicle frame. */
export class MountCalibrationCollector {
  private samples: ImuSample[] = [];

  constructor(private readonly config: MountCalibrationConfig = DEFAULT_MOUNT_CALIBRATION_CONFIG) {}

  add(sample: ImuSample, createdAtEpochMs = Date.now()): CalibrationProgress {
    const values = [
      sample.receivedMonotonicMs,
      ...Object.values(sample.accelerationG),
      ...Object.values(sample.angularVelocityDps),
    ];
    if (values.some((value) => !Number.isFinite(value))) {
      return { status: 'rejected', reason: 'Calibration received an invalid sensor sample.' };
    }
    this.samples.push(sample);
    if (this.samples.length > this.config.maximumSamples) this.samples.shift();
    const elapsed = sample.receivedMonotonicMs - this.samples[0]!.receivedMonotonicMs;
    if (elapsed < this.config.stationaryDurationMs || this.samples.length < this.config.minimumSamples) {
      return { status: 'collecting', progress: Math.min(0.99, elapsed / this.config.stationaryDurationMs) };
    }

    const accelerationMagnitudes = this.samples.map((value) => magnitude(value.accelerationG));
    const meanAngularVelocity = this.samples.reduce(
      (sum, value) => sum + magnitude(value.angularVelocityDps), 0,
    ) / this.samples.length;
    if (standardDeviation(accelerationMagnitudes) > this.config.maximumAccelerationStdDevG
      || meanAngularVelocity > this.config.maximumMeanAngularVelocityDps) {
      this.reset();
      return { status: 'rejected', reason: 'The sensor moved during calibration. Keep the parked vehicle and sensor still.' };
    }

    const gravity = this.samples.reduce<Vector3>(
      (sum, value) => ({
        x: sum.x + value.accelerationG.x,
        y: sum.y + value.accelerationG.y,
        z: sum.z + value.accelerationG.z,
      }),
      { x: 0, y: 0, z: 0 },
    );
    const vertical = normalize(gravity);
    if (!vertical) {
      this.reset();
      return { status: 'rejected', reason: 'Calibration could not determine the vertical direction.' };
    }

    const hint = axisVector(this.config.forwardAxis);
    const forward = normalize(subtract(hint, scale(vertical, dot(hint, vertical))));
    if (!forward) {
      this.reset();
      return { status: 'rejected', reason: 'The forward arrow is too close to vertical. Mount the board flat with its X arrow facing forward.' };
    }
    const lateral = normalize(cross(vertical, forward));
    if (!lateral) {
      this.reset();
      return { status: 'rejected', reason: 'Calibration could not determine the lateral direction.' };
    }

    const calibration: VehicleFrameCalibration = Object.freeze({
      version: 1,
      forward,
      lateral,
      vertical,
      createdAtEpochMs,
    });
    this.reset();
    return { status: 'ready', calibration };
  }

  reset(): void {
    this.samples = [];
  }
}

export function isVehicleFrameCalibration(value: unknown): value is VehicleFrameCalibration {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VehicleFrameCalibration>;
  if (candidate.version !== 1 || !Number.isFinite(candidate.createdAtEpochMs)) return false;
  const vectors = [candidate.forward, candidate.lateral, candidate.vertical];
  if (vectors.some((vector) => !vector
    || !Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)
    || Math.abs(magnitude(vector) - 1) > 0.02)) return false;
  return Math.abs(dot(candidate.forward!, candidate.lateral!)) < 0.02
    && Math.abs(dot(candidate.forward!, candidate.vertical!)) < 0.02
    && Math.abs(dot(candidate.lateral!, candidate.vertical!)) < 0.02;
}

export function toVehicleFrame(sample: ImuSample, calibration: VehicleFrameCalibration): VehicleFrameSample {
  const transform = (vector: Vector3) => Object.freeze({
    forward: dot(vector, calibration.forward),
    lateral: dot(vector, calibration.lateral),
    vertical: dot(vector, calibration.vertical),
  });
  return Object.freeze({
    sequence: sample.sequence,
    receivedMonotonicMs: sample.receivedMonotonicMs,
    accelerationG: transform(sample.accelerationG),
    angularVelocityDps: transform(sample.angularVelocityDps),
  });
}
