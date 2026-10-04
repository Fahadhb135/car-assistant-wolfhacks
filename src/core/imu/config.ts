import type { ImuPipelineConfig, PartialImuPipelineConfig } from './types';

export const DEFAULT_IMU_PIPELINE_CONFIG: ImuPipelineConfig = Object.freeze({
  validation: Object.freeze({
    maximumAbsoluteAccelerationG: 32,
    maximumAbsoluteAngularVelocityDps: 4_000,
  }),
  bufferRetentionMs: 10_000,
  maximumBufferedSamples: 2_000,
  windows: Object.freeze({
    durationMs: 2_000,
    stepMs: 1_000,
    maximumCatchUpWindows: 4,
    maximumBufferedSamples: 2_000,
  }),
  crash: Object.freeze({
    triggerAccelerationG: 3.5,
    releaseAccelerationG: 1.5,
    minimumDurationMs: 60,
    minimumImpulseGSeconds: 0.12,
    minimumAngularVelocityDps: 20,
    maximumContinuityGapMs: 100,
    cooldownMs: 3_000,
  }),
  swerve: Object.freeze({
    rotationAxis: 'z',
    directionDeadbandDps: 10,
    minimumDirectionChanges: 3,
    minimumRotationStandardDeviationDps: 20,
    minimumAccelerationStandardDeviationG: 0.08,
    maximumMissingSampleRatio: 0.2,
    minimumSamples: 20,
    releaseDirectionChanges: 1,
    cooldownMs: 3_000,
  }),
  behaviors: Object.freeze({
    maximumContinuityGapMs: 100,
    hardBraking: Object.freeze({
      triggerLongitudinalG: 0.3,
      releaseLongitudinalG: 0.15,
      minimumDurationMs: 250,
      minimumJerkGps: 0.5,
      cooldownMs: 5_000,
    }),
    rapidAcceleration: Object.freeze({
      triggerLongitudinalG: 0.25,
      releaseLongitudinalG: 0.12,
      minimumDurationMs: 350,
      minimumJerkGps: 0.4,
      cooldownMs: 5_000,
    }),
    harshCornering: Object.freeze({
      triggerLateralG: 0.35,
      releaseLateralG: 0.18,
      minimumYawRateDps: 18,
      releaseYawRateDps: 8,
      minimumDurationMs: 300,
      cooldownMs: 5_000,
    }),
  }),
});

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and positive`);
}

export function resolvePipelineConfig(partial: PartialImuPipelineConfig = {}): ImuPipelineConfig {
  const config: ImuPipelineConfig = {
    validation: { ...DEFAULT_IMU_PIPELINE_CONFIG.validation, ...partial.validation },
    bufferRetentionMs: partial.bufferRetentionMs ?? DEFAULT_IMU_PIPELINE_CONFIG.bufferRetentionMs,
    maximumBufferedSamples: partial.maximumBufferedSamples ?? DEFAULT_IMU_PIPELINE_CONFIG.maximumBufferedSamples,
    windows: { ...DEFAULT_IMU_PIPELINE_CONFIG.windows, ...partial.windows },
    crash: { ...DEFAULT_IMU_PIPELINE_CONFIG.crash, ...partial.crash },
    swerve: { ...DEFAULT_IMU_PIPELINE_CONFIG.swerve, ...partial.swerve },
    behaviors: {
      maximumContinuityGapMs: partial.behaviors?.maximumContinuityGapMs
        ?? DEFAULT_IMU_PIPELINE_CONFIG.behaviors.maximumContinuityGapMs,
      hardBraking: { ...DEFAULT_IMU_PIPELINE_CONFIG.behaviors.hardBraking, ...partial.behaviors?.hardBraking },
      rapidAcceleration: { ...DEFAULT_IMU_PIPELINE_CONFIG.behaviors.rapidAcceleration, ...partial.behaviors?.rapidAcceleration },
      harshCornering: { ...DEFAULT_IMU_PIPELINE_CONFIG.behaviors.harshCornering, ...partial.behaviors?.harshCornering },
    },
  };

  positive(config.validation.maximumAbsoluteAccelerationG, 'maximumAbsoluteAccelerationG');
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
  if (config.behaviors.harshCornering.cooldownMs < 0) throw new Error('harshCornering cooldownMs must be non-negative');
  return config;
}
