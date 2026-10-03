import type { ImuEvent } from '../events/types';
import type { ImuSample } from '../sensors/types';

export type SensorAxis = 'x' | 'y' | 'z';

export type SampleRejectionReason =
  | 'non_finite_value'
  | 'timestamp_out_of_range'
  | 'invalid_sequence'
  | 'acceleration_out_of_range'
  | 'angular_velocity_out_of_range'
  | 'timestamp_regression'
  | 'duplicate_sequence'
  | 'sequence_regression';

export type SampleValidationConfig = Readonly<{
  maximumAbsoluteAccelerationG: number;
  maximumAbsoluteAngularVelocityDps: number;
}>;

export type StreamHealthSnapshot = Readonly<{
  receivedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  rejectionCounts: Readonly<Partial<Record<SampleRejectionReason, number>>>;
  estimatedSampleRateHz: number;
  missingSequenceCount: number;
  largestInterSampleGapMs: number;
}>;

export type TimeWindow = Readonly<{
  startedAtMs: number;
  endedAtMs: number;
  samples: readonly ImuSample[];
}>;

export type WindowFeatures = Readonly<{
  startedAtMs: number;
  endedAtMs: number;
  sampleCount: number;
  observedDurationMs: number;
  missingSampleRatio: number;
  accelerationMagnitudeMeanG: number;
  accelerationMagnitudeStandardDeviationG: number;
  accelerationMagnitudeMaximumG: number;
  angularVelocityMagnitudeMeanDps: number;
  angularVelocityMagnitudeStandardDeviationDps: number;
  angularVelocityMagnitudeMaximumDps: number;
  jerkMeanGps: number;
  jerkMaximumGps: number;
  rotationAxisDirectionChanges: number;
  rotationAxisStandardDeviationDps: number;
}>;

export type SlidingWindowConfig = Readonly<{
  durationMs: number;
  stepMs: number;
  maximumCatchUpWindows: number;
  maximumBufferedSamples: number;
}>;

export type CrashDetectorConfig = Readonly<{
  triggerAccelerationG: number;
  releaseAccelerationG: number;
  minimumDurationMs: number;
  minimumImpulseGSeconds: number;
  minimumAngularVelocityDps: number;
  maximumContinuityGapMs: number;
  cooldownMs: number;
}>;

export type SwerveDetectorConfig = Readonly<{
  rotationAxis: SensorAxis;
  directionDeadbandDps: number;
  minimumDirectionChanges: number;
  minimumRotationStandardDeviationDps: number;
  minimumAccelerationStandardDeviationG: number;
  maximumMissingSampleRatio: number;
  minimumSamples: number;
  releaseDirectionChanges: number;
  cooldownMs: number;
}>;

export type ImuPipelineConfig = Readonly<{
  validation: SampleValidationConfig;
  bufferRetentionMs: number;
  maximumBufferedSamples: number;
  windows: SlidingWindowConfig;
  crash: CrashDetectorConfig;
  swerve: SwerveDetectorConfig;
}>;

export type PartialImuPipelineConfig = Readonly<{
  validation?: Partial<SampleValidationConfig>;
  bufferRetentionMs?: number;
  maximumBufferedSamples?: number;
  windows?: Partial<SlidingWindowConfig>;
  crash?: Partial<CrashDetectorConfig>;
  swerve?: Partial<SwerveDetectorConfig>;
}>;

export type ImuPipelineResult =
  | Readonly<{
      accepted: false;
      reason: SampleRejectionReason;
      events: readonly ImuEvent[];
      completedWindows: readonly WindowFeatures[];
      skippedWindowCount: number;
      health: StreamHealthSnapshot;
    }>
  | Readonly<{
      accepted: true;
      events: readonly ImuEvent[];
      completedWindows: readonly WindowFeatures[];
      skippedWindowCount: number;
      health: StreamHealthSnapshot;
    }>;
