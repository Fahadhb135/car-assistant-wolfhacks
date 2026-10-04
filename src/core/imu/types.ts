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

export type LongitudinalBehaviorConfig = Readonly<{
  triggerLongitudinalG: number;
  releaseLongitudinalG: number;
  minimumDurationMs: number;
  minimumJerkGps: number;
  cooldownMs: number;
}>;

export type HarshCorneringConfig = Readonly<{
  triggerLateralG: number;
  releaseLateralG: number;
  minimumYawRateDps: number;
  releaseYawRateDps: number;
  minimumDurationMs: number;
  /** Heading swept in one direction: a turn is a big arc, a swerve is small alternating arcs. */
  minimumHeadingChangeDeg: number;
  cooldownMs: number;
}>;

/** Sustained deceleration beyond what tyres can deliver: the car hit something. */
export type SevereDecelerationConfig = Readonly<{
  triggerLongitudinalG: number;
  releaseLongitudinalG: number;
  minimumDurationMs: number;
  cooldownMs: number;
  /** At or above this deceleration, tilting cannot explain the reading, so the tilt guard is skipped. */
  tiltExemptG: number;
}>;

/** Learns the board's resting forward/lateral reading while it is still, so mount drift is not motion. */
export type RestingLevelConfig = Readonly<{
  timeConstantMs: number;
  /** Still means the total acceleration is within this of 1 g (no horizontal acceleration)... */
  stillAccelerationToleranceG: number;
  /** ...and the board is rotating slower than this. */
  stillRotationDps: number;
}>;

export type DrivingBehaviorConfig = Readonly<{
  maximumContinuityGapMs: number;
  /** Time constant of the low-pass filter applied before every behavior threshold and jerk. */
  smoothingTimeConstantMs: number;
  /**
   * Pitch/roll rate above which braking, acceleration, cornering, and drastic slowing are ignored:
   * tilting moves gravity onto the forward/lateral axes. A car pitches and rolls only a few °/s.
   */
  maximumTiltRateDps: number;
  restingLevel: RestingLevelConfig;
  severeDeceleration: SevereDecelerationConfig;
  hardBraking: LongitudinalBehaviorConfig;
  rapidAcceleration: LongitudinalBehaviorConfig;
  harshCornering: HarshCorneringConfig;
}>;

export type ImuPipelineConfig = Readonly<{
  validation: SampleValidationConfig;
  /** Global cooldown shared by every non-crash motion candidate. */
  nonCrashMotionCooldownMs: number;
  bufferRetentionMs: number;
  maximumBufferedSamples: number;
  windows: SlidingWindowConfig;
  crash: CrashDetectorConfig;
  swerve: SwerveDetectorConfig;
  behaviors: DrivingBehaviorConfig;
}>;

export type PartialImuPipelineConfig = Readonly<{
  validation?: Partial<SampleValidationConfig>;
  nonCrashMotionCooldownMs?: number;
  bufferRetentionMs?: number;
  maximumBufferedSamples?: number;
  windows?: Partial<SlidingWindowConfig>;
  crash?: Partial<CrashDetectorConfig>;
  swerve?: Partial<SwerveDetectorConfig>;
  behaviors?: Readonly<{
    maximumContinuityGapMs?: number;
    smoothingTimeConstantMs?: number;
    maximumTiltRateDps?: number;
    restingLevel?: Partial<RestingLevelConfig>;
    severeDeceleration?: Partial<SevereDecelerationConfig>;
    hardBraking?: Partial<LongitudinalBehaviorConfig>;
    rapidAcceleration?: Partial<LongitudinalBehaviorConfig>;
    harshCornering?: Partial<HarshCorneringConfig>;
  }>;
}>;

export type ImuArbitrationSnapshot = Readonly<{
  nonCrashCooldownUntilMs: number | null;
  nonCrashCooldownRemainingMs: number;
  suppressedCount: number;
  suppressedByKind: Readonly<Partial<Record<ImuEvent['kind'], number>>>;
}>;

export type ImuPipelineResult =
  | Readonly<{
      accepted: false;
      reason: SampleRejectionReason;
      events: readonly ImuEvent[];
      completedWindows: readonly WindowFeatures[];
      skippedWindowCount: number;
      health: StreamHealthSnapshot;
      arbitration: ImuArbitrationSnapshot;
    }>
  | Readonly<{
      accepted: true;
      events: readonly ImuEvent[];
      completedWindows: readonly WindowFeatures[];
      skippedWindowCount: number;
      health: StreamHealthSnapshot;
      arbitration: ImuArbitrationSnapshot;
    }>;
