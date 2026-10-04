import type { ImuPipelineConfig, PartialImuPipelineConfig } from './types';

export const DEFAULT_IMU_PIPELINE_CONFIG: ImuPipelineConfig = Object.freeze({
  validation: Object.freeze({
    maximumAbsoluteAccelerationG: 32,
    maximumAbsoluteAngularVelocityDps: 4_000,
  }),
  nonCrashMotionCooldownMs: 0, // only a crash quiets the drive (DriveEventGate, 15 s)
  bufferRetentionMs: 10_000,
  maximumBufferedSamples: 2_000,
  windows: Object.freeze({
    durationMs: 2_000,
    stepMs: 1_000,
    maximumCatchUpWindows: 4,
    maximumBufferedSamples: 2_000,
  }),
  crash: Object.freeze({
    triggerAccelerationG: 4.5,
    releaseAccelerationG: 1.5,
    minimumDurationMs: 80,
    minimumImpulseGSeconds: 0.16,
    minimumAngularVelocityDps: 35,
    maximumContinuityGapMs: 100,
    cooldownMs: 10_000,
  }),
  swerve: Object.freeze({
    rotationAxis: 'z',
    directionDeadbandDps: 15,
    minimumDirectionChanges: 4,
    minimumRotationStandardDeviationDps: 35,
    minimumAccelerationStandardDeviationG: 0.18,
    maximumMissingSampleRatio: 0.15,
    minimumSamples: 40,
    releaseDirectionChanges: 1,
    cooldownMs: 2_000,
  }),
  // Behavior thresholds apply to a low-pass-filtered vehicle-frame signal (see smoothing), so
  // sensor noise and road vibration no longer count as jerk or as a corner.
  behaviors: Object.freeze({
    maximumContinuityGapMs: 100,
    smoothingTimeConstantMs: 100,
    maximumTiltRateDps: 45,
    restingLevel: Object.freeze({
      timeConstantMs: 3_000,
      stillAccelerationToleranceG: 0.02,
      stillRotationDps: 3,
    }),
    // A car's tyres top out near 1 g of braking; anything beyond that, sustained, means a collision.
    severeDeceleration: Object.freeze({
      triggerLongitudinalG: 1.2,
      releaseLongitudinalG: 0.6,
      minimumDurationMs: 120,
      cooldownMs: 10_000,
      tiltExemptG: 2,
    }),
    // Firm braking: decelerating at ≥ 0.35 g, entered with a jerk of ≥ 1 g/s (about 10 m/s³).
    hardBraking: Object.freeze({
      triggerLongitudinalG: 0.35,
      releaseLongitudinalG: 0.15,
      minimumDurationMs: 250,
      minimumJerkGps: 1,
      cooldownMs: 2_000,
    }),
    rapidAcceleration: Object.freeze({
      triggerLongitudinalG: 0.4,
      releaseLongitudinalG: 0.18,
      minimumDurationMs: 500,
      minimumJerkGps: 0.6,
      cooldownMs: 2_000,
    }),
    // A brisk 90° turn at 15 mph pulls about 0.4 g at 35°/s; a gentle one stays under 0.25 g.
    // Swerves and lane changes sweep well under 45° each way before reversing.
    harshCornering: Object.freeze({
      triggerLateralG: 0.3,
      releaseLateralG: 0.15,
      minimumYawRateDps: 15,
      releaseYawRateDps: 6,
      minimumDurationMs: 300,
      minimumHeadingChangeDeg: 45,
      cooldownMs: 2_000,
    }),
  }),
});

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and positive`);
}

export function resolvePipelineConfig(partial: PartialImuPipelineConfig = {}): ImuPipelineConfig {
  const config: ImuPipelineConfig = {
    validation: { ...DEFAULT_IMU_PIPELINE_CONFIG.validation, ...partial.validation },
    nonCrashMotionCooldownMs: partial.nonCrashMotionCooldownMs ?? DEFAULT_IMU_PIPELINE_CONFIG.nonCrashMotionCooldownMs,
    bufferRetentionMs: partial.bufferRetentionMs ?? DEFAULT_IMU_PIPELINE_CONFIG.bufferRetentionMs,
    maximumBufferedSamples: partial.maximumBufferedSamples ?? DEFAULT_IMU_PIPELINE_CONFIG.maximumBufferedSamples,
    windows: { ...DEFAULT_IMU_PIPELINE_CONFIG.windows, ...partial.windows },
    crash: { ...DEFAULT_IMU_PIPELINE_CONFIG.crash, ...partial.crash },
    swerve: { ...DEFAULT_IMU_PIPELINE_CONFIG.swerve, ...partial.swerve },
    behaviors: {
      maximumContinuityGapMs: partial.behaviors?.maximumContinuityGapMs
        ?? DEFAULT_IMU_PIPELINE_CONFIG.behaviors.maximumContinuityGapMs,
      smoothingTimeConstantMs: partial.behaviors?.smoothingTimeConstantMs
        ?? DEFAULT_IMU_PIPELINE_CONFIG.behaviors.smoothingTimeConstantMs,
      maximumTiltRateDps: partial.behaviors?.maximumTiltRateDps
        ?? DEFAULT_IMU_PIPELINE_CONFIG.behaviors.maximumTiltRateDps,
      restingLevel: { ...DEFAULT_IMU_PIPELINE_CONFIG.behaviors.restingLevel, ...partial.behaviors?.restingLevel },
      severeDeceleration: { ...DEFAULT_IMU_PIPELINE_CONFIG.behaviors.severeDeceleration, ...partial.behaviors?.severeDeceleration },
      hardBraking: { ...DEFAULT_IMU_PIPELINE_CONFIG.behaviors.hardBraking, ...partial.behaviors?.hardBraking },
      rapidAcceleration: { ...DEFAULT_IMU_PIPELINE_CONFIG.behaviors.rapidAcceleration, ...partial.behaviors?.rapidAcceleration },
      harshCornering: { ...DEFAULT_IMU_PIPELINE_CONFIG.behaviors.harshCornering, ...partial.behaviors?.harshCornering },
    },
  };

  positive(config.validation.maximumAbsoluteAccelerationG, 'maximumAbsoluteAccelerationG');
  if (config.nonCrashMotionCooldownMs < 0 || !Number.isFinite(config.nonCrashMotionCooldownMs)) {
    throw new Error('nonCrashMotionCooldownMs must be finite and non-negative');
  }
  positive(config.validation.maximumAbsoluteAngularVelocityDps, 'maximumAbsoluteAngularVelocityDps');
  positive(config.bufferRetentionMs, 'bufferRetentionMs');
  positive(config.maximumBufferedSamples, 'maximumBufferedSamples');
  positive(config.windows.durationMs, 'window durationMs');
  positive(config.windows.stepMs, 'window stepMs');
  positive(config.windows.maximumCatchUpWindows, 'maximumCatchUpWindows');
  positive(config.windows.maximumBufferedSamples, 'window maximumBufferedSamples');
  if (!Number.isSafeInteger(config.maximumBufferedSamples)) throw new Error('maximumBufferedSamples must be a positive safe integer');
  if (!Number.isSafeInteger(config.windows.maximumCatchUpWindows)) throw new Error('maximumCatchUpWindows must be a positive safe integer');
  if (!Number.isSafeInteger(config.windows.maximumBufferedSamples)) throw new Error('window maximumBufferedSamples must be a positive safe integer');
  positive(config.crash.triggerAccelerationG, 'triggerAccelerationG');
  if (config.crash.releaseAccelerationG < 0 || config.crash.releaseAccelerationG >= config.crash.triggerAccelerationG) {
    throw new Error('releaseAccelerationG must be non-negative and below triggerAccelerationG');
  }
  positive(config.crash.minimumDurationMs, 'minimumDurationMs');
  positive(config.crash.minimumImpulseGSeconds, 'minimumImpulseGSeconds');
  if (config.crash.minimumAngularVelocityDps < 0) throw new Error('minimumAngularVelocityDps must be non-negative');
  positive(config.crash.maximumContinuityGapMs, 'maximumContinuityGapMs');
  if (config.crash.cooldownMs < 0) throw new Error('crash cooldownMs must be non-negative');
  if (!Number.isInteger(config.swerve.minimumDirectionChanges) || config.swerve.minimumDirectionChanges < 1) throw new Error('minimumDirectionChanges must be a positive integer');
  if (!Number.isInteger(config.swerve.minimumSamples) || config.swerve.minimumSamples < 2) throw new Error('minimumSamples must be an integer of at least 2');
  if (config.swerve.releaseDirectionChanges < 0 || config.swerve.releaseDirectionChanges >= config.swerve.minimumDirectionChanges) throw new Error('releaseDirectionChanges must be below minimumDirectionChanges');
  if (config.swerve.maximumMissingSampleRatio < 0 || config.swerve.maximumMissingSampleRatio > 1) throw new Error('maximumMissingSampleRatio must be between 0 and 1');
  if (config.swerve.cooldownMs < 0) throw new Error('swerve cooldownMs must be non-negative');
  positive(config.behaviors.maximumContinuityGapMs, 'behavior maximumContinuityGapMs');
  if (!Number.isFinite(config.behaviors.smoothingTimeConstantMs) || config.behaviors.smoothingTimeConstantMs < 0) {
    throw new Error('smoothingTimeConstantMs must be finite and non-negative');
  }
  positive(config.behaviors.maximumTiltRateDps, 'maximumTiltRateDps');
  positive(config.behaviors.restingLevel.timeConstantMs, 'restingLevel timeConstantMs');
  positive(config.behaviors.restingLevel.stillAccelerationToleranceG, 'restingLevel stillAccelerationToleranceG');
  positive(config.behaviors.restingLevel.stillRotationDps, 'restingLevel stillRotationDps');
  const severe = config.behaviors.severeDeceleration;
  positive(severe.triggerLongitudinalG, 'severeDeceleration triggerLongitudinalG');
  if (severe.releaseLongitudinalG < 0 || severe.releaseLongitudinalG >= severe.triggerLongitudinalG) {
    throw new Error('severeDeceleration releaseLongitudinalG must be non-negative and below its trigger');
  }
  if (severe.triggerLongitudinalG <= config.behaviors.hardBraking.triggerLongitudinalG) {
    throw new Error('severeDeceleration must trigger above hard braking');
  }
  positive(severe.minimumDurationMs, 'severeDeceleration minimumDurationMs');
  if (!(severe.tiltExemptG >= severe.triggerLongitudinalG)) {
    throw new Error('severeDeceleration tiltExemptG must be at or above its trigger');
  }
  if (severe.cooldownMs < 0) throw new Error('severeDeceleration cooldownMs must be non-negative');
  for (const [name, behavior] of [
    ['hardBraking', config.behaviors.hardBraking],
    ['rapidAcceleration', config.behaviors.rapidAcceleration],
  ] as const) {
    positive(behavior.triggerLongitudinalG, `${name} triggerLongitudinalG`);
    if (behavior.releaseLongitudinalG < 0 || behavior.releaseLongitudinalG >= behavior.triggerLongitudinalG) {
      throw new Error(`${name} releaseLongitudinalG must be non-negative and below its trigger`);
    }
    positive(behavior.minimumDurationMs, `${name} minimumDurationMs`);
    if (behavior.minimumJerkGps < 0) throw new Error(`${name} minimumJerkGps must be non-negative`);
    if (behavior.cooldownMs < 0) throw new Error(`${name} cooldownMs must be non-negative`);
  }
  positive(config.behaviors.harshCornering.triggerLateralG, 'harshCornering triggerLateralG');
  if (config.behaviors.harshCornering.releaseLateralG < 0
    || config.behaviors.harshCornering.releaseLateralG >= config.behaviors.harshCornering.triggerLateralG) {
    throw new Error('harshCornering releaseLateralG must be non-negative and below its trigger');
  }
  positive(config.behaviors.harshCornering.minimumYawRateDps, 'harshCornering minimumYawRateDps');
  if (config.behaviors.harshCornering.releaseYawRateDps < 0
    || config.behaviors.harshCornering.releaseYawRateDps >= config.behaviors.harshCornering.minimumYawRateDps) {
    throw new Error('harshCornering releaseYawRateDps must be non-negative and below its trigger');
  }
  positive(config.behaviors.harshCornering.minimumDurationMs, 'harshCornering minimumDurationMs');
  if (!(config.behaviors.harshCornering.minimumHeadingChangeDeg >= 0)) {
    throw new Error('harshCornering minimumHeadingChangeDeg must be non-negative');
  }
  if (config.behaviors.harshCornering.cooldownMs < 0) throw new Error('harshCornering cooldownMs must be non-negative');
  return config;
}
