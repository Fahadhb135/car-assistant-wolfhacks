import type { ImuEvent } from '../events/types';
import type { ImuSample } from '../sensors/types';
import type { CrashDetectorConfig } from './types';

function accelerationMagnitude(sample: ImuSample): number {
  return Math.hypot(sample.accelerationG.x, sample.accelerationG.y, sample.accelerationG.z);
}

function angularMagnitude(sample: ImuSample): number {
  return Math.hypot(sample.angularVelocityDps.x, sample.angularVelocityDps.y, sample.angularVelocityDps.z);
}

type ImpactEpisode = {
  startedAtMs: number;
  lastAtMs: number;
  lastExcessG: number;
  peakAccelerationG: number;
  peakAngularVelocityDps: number;
  impulseGSeconds: number;
};

export class CrashCandidateDetector {
  private episode: ImpactEpisode | undefined;
  private armed = true;
  private lastEventAtMs = Number.NEGATIVE_INFINITY;

  constructor(private config: CrashDetectorConfig) {}

  /** Swaps thresholds live, keeping in-flight state (episodes, cooldowns, learned resting level). */
  setConfig(config: CrashDetectorConfig): void {
    this.config = config;
  }

  process(sample: ImuSample): ImuEvent | undefined {
    const accelerationG = accelerationMagnitude(sample);
    const angularVelocityDps = angularMagnitude(sample);

    if (this.episode && sample.receivedMonotonicMs - this.episode.lastAtMs > this.config.maximumContinuityGapMs) {
      this.episode = undefined;
    }

    if (!this.armed) {
      if (
        accelerationG <= this.config.releaseAccelerationG &&
        sample.receivedMonotonicMs - this.lastEventAtMs >= this.config.cooldownMs
      ) this.armed = true;
      return undefined;
    }

    if (!this.episode) {
      if (accelerationG < this.config.triggerAccelerationG) return undefined;
      this.episode = {
        startedAtMs: sample.receivedMonotonicMs,
        lastAtMs: sample.receivedMonotonicMs,
        lastExcessG: accelerationG - this.config.triggerAccelerationG,
        peakAccelerationG: accelerationG,
        peakAngularVelocityDps: angularVelocityDps,
        impulseGSeconds: 0,
      };
    } else if (accelerationG <= this.config.releaseAccelerationG) {
      this.episode = undefined;
      return undefined;
    } else {
      const elapsedSeconds = (sample.receivedMonotonicMs - this.episode.lastAtMs) / 1_000;
      const excessG = Math.max(0, accelerationG - this.config.triggerAccelerationG);
      this.episode.impulseGSeconds += ((this.episode.lastExcessG + excessG) / 2) * elapsedSeconds;
      this.episode.lastExcessG = excessG;
      this.episode.lastAtMs = sample.receivedMonotonicMs;
      this.episode.peakAccelerationG = Math.max(this.episode.peakAccelerationG, accelerationG);
      this.episode.peakAngularVelocityDps = Math.max(this.episode.peakAngularVelocityDps, angularVelocityDps);
    }

    const durationMs = sample.receivedMonotonicMs - this.episode.startedAtMs;
    const qualifies =
      this.episode.peakAngularVelocityDps >= this.config.minimumAngularVelocityDps &&
      (durationMs >= this.config.minimumDurationMs ||
        this.episode.impulseGSeconds >= this.config.minimumImpulseGSeconds);
    if (!qualifies) return undefined;

    const confidence = Math.min(1, 0.5 +
      0.25 * (this.episode.peakAccelerationG / this.config.triggerAccelerationG - 1) +
      0.25 * (this.episode.peakAngularVelocityDps / Math.max(1, this.config.minimumAngularVelocityDps) - 1));
    const event: ImuEvent = Object.freeze({
      kind: 'crash_candidate',
      occurredAtMs: sample.receivedMonotonicMs,
      severity: 'critical',
      confidence: Math.max(0, confidence),
      evidence: Object.freeze({
        peakAccelerationG: this.episode.peakAccelerationG,
        peakAngularVelocityDps: this.episode.peakAngularVelocityDps,
        durationMs,
        impulseGSeconds: this.episode.impulseGSeconds,
        triggerAccelerationG: this.config.triggerAccelerationG,
      }),
    });
    this.lastEventAtMs = sample.receivedMonotonicMs;
    this.armed = false;
    this.episode = undefined;
    return event;
  }

  reset(): void {
    this.episode = undefined;
    this.armed = true;
    this.lastEventAtMs = Number.NEGATIVE_INFINITY;
  }
}
