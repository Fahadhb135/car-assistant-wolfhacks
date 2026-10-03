import type { ImuSample, Vector3 } from '../sensors/types';
import type { SampleRejectionReason, SampleValidationConfig } from './types';

function vectorValues(vector: Vector3): number[] {
  return [vector.x, vector.y, vector.z];
}

export class SampleValidator {
  private lastTimestampMs: number | undefined;
  private lastSequence: number | undefined;

  constructor(private readonly config: SampleValidationConfig) {}

  validate(sample: ImuSample): SampleRejectionReason | undefined {
    const values = [
      sample.receivedMonotonicMs,
      ...(sample.deviceTimeMs === undefined ? [] : [sample.deviceTimeMs]),
      ...vectorValues(sample.accelerationG),
      ...vectorValues(sample.angularVelocityDps),
    ];
    if (values.some((value) => !Number.isFinite(value))) return 'non_finite_value';
    if (
      Math.abs(sample.receivedMonotonicMs) > Number.MAX_SAFE_INTEGER ||
      (sample.deviceTimeMs !== undefined && Math.abs(sample.deviceTimeMs) > Number.MAX_SAFE_INTEGER)
    ) return 'timestamp_out_of_range';
    if (sample.sequence !== undefined && (!Number.isSafeInteger(sample.sequence) || sample.sequence < 0)) return 'invalid_sequence';
    if (vectorValues(sample.accelerationG).some((value) => Math.abs(value) > this.config.maximumAbsoluteAccelerationG)) return 'acceleration_out_of_range';
    if (vectorValues(sample.angularVelocityDps).some((value) => Math.abs(value) > this.config.maximumAbsoluteAngularVelocityDps)) return 'angular_velocity_out_of_range';
    if (this.lastTimestampMs !== undefined && sample.receivedMonotonicMs < this.lastTimestampMs) return 'timestamp_regression';
    if (sample.sequence !== undefined && this.lastSequence !== undefined) {
      if (sample.sequence === this.lastSequence) return 'duplicate_sequence';
      if (sample.sequence < this.lastSequence) return 'sequence_regression';
    }
    return undefined;
  }

  accept(sample: ImuSample): void {
    this.lastTimestampMs = sample.receivedMonotonicMs;
    if (sample.sequence !== undefined) this.lastSequence = sample.sequence;
  }

  reset(): void {
    this.lastTimestampMs = undefined;
    this.lastSequence = undefined;
  }
}
