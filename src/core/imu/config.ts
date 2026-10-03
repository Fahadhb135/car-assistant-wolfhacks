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
  return config;
}
