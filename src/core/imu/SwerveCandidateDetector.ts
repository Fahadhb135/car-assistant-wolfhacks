import type { ImuEvent } from '../events/types';
import type { SwerveDetectorConfig, WindowFeatures } from './types';

export class SwerveCandidateDetector {
  private latched = false;
  private lastEventAtMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly config: SwerveDetectorConfig) {}

  process(features: WindowFeatures): ImuEvent | undefined {
    if (features.rotationAxisDirectionChanges <= this.config.releaseDirectionChanges) this.latched = false;
    const qualifies =
      features.sampleCount >= this.config.minimumSamples &&
      features.missingSampleRatio <= this.config.maximumMissingSampleRatio &&
      features.rotationAxisDirectionChanges >= this.config.minimumDirectionChanges &&
      features.rotationAxisStandardDeviationDps >= this.config.minimumRotationStandardDeviationDps &&
      features.accelerationMagnitudeStandardDeviationG >= this.config.minimumAccelerationStandardDeviationG;
    if (!qualifies || this.latched || features.endedAtMs - this.lastEventAtMs < this.config.cooldownMs) return undefined;

    this.latched = true;
    this.lastEventAtMs = features.endedAtMs;
    const confidence = Math.min(1, (
      features.rotationAxisDirectionChanges / this.config.minimumDirectionChanges +
      features.rotationAxisStandardDeviationDps / this.config.minimumRotationStandardDeviationDps +
      features.accelerationMagnitudeStandardDeviationG / this.config.minimumAccelerationStandardDeviationG
    ) / 6);
    return Object.freeze({
      kind: 'swerve_candidate',
      occurredAtMs: features.endedAtMs,
      severity: 'warning',
      confidence: Math.max(0, confidence),
      evidence: Object.freeze({
        rotationAxisDirectionChanges: features.rotationAxisDirectionChanges,
        rotationAxisStandardDeviationDps: features.rotationAxisStandardDeviationDps,
        accelerationMagnitudeStandardDeviationG: features.accelerationMagnitudeStandardDeviationG,
        missingSampleRatio: features.missingSampleRatio,
        sampleCount: features.sampleCount,
      }),
    });
  }

  reset(): void {
    this.latched = false;
    this.lastEventAtMs = Number.NEGATIVE_INFINITY;
  }
}
