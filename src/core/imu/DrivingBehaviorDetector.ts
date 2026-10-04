import type { ImuEvent } from '../events/types';
import type { DrivingBehaviorConfig } from './types';
import type { VehicleFrameSample } from './VehicleFrame';

type BehaviorKind = 'hard_braking_candidate' | 'rapid_acceleration_candidate' | 'harsh_corner_candidate';

type Episode = {
  startedAtMs?: number;
  lastAtMs?: number;
  peakPrimary: number;
  peakJerkGps: number;
  peakRotationDps: number;
  emitted: boolean;
  cooldownUntilMs: number;
};

const emptyEpisode = (): Episode => ({ peakPrimary: 0, peakJerkGps: 0, peakRotationDps: 0, emitted: false, cooldownUntilMs: -Infinity });

function confidence(value: number, threshold: number, duration: number, minimumDuration: number): number {
  const strength = Math.min(1, Math.max(0, value / threshold - 1) / 1.5);
  const persistence = Math.min(1, Math.max(0, duration / minimumDuration - 1) / 2);
  return Math.min(0.99, 0.55 + strength * 0.3 + persistence * 0.14);
}

/** Stateful, constant-memory detector operating on calibrated vehicle-frame samples. */
export class DrivingBehaviorDetector {
  private brake = emptyEpisode();
  private acceleration = emptyEpisode();
  private corner = emptyEpisode();
  private previous?: VehicleFrameSample;

  constructor(private readonly config: DrivingBehaviorConfig) {}

  process(sample: VehicleFrameSample): readonly ImuEvent[] {
    const events: ImuEvent[] = [];
    const elapsedMs = this.previous ? sample.receivedMonotonicMs - this.previous.receivedMonotonicMs : 0;
    if (this.previous && (elapsedMs <= 0 || elapsedMs > this.config.maximumContinuityGapMs)) {
      this.clearActiveEpisodes();
      this.previous = sample;
      return events;
    }

    const elapsedSeconds = elapsedMs / 1_000;
    const longitudinal = sample.accelerationG.forward;
    const lateral = Math.abs(sample.accelerationG.lateral);
    const yaw = Math.abs(sample.angularVelocityDps.vertical);
    const jerk = this.previous && elapsedSeconds > 0
      ? Math.abs(longitudinal - this.previous.accelerationG.forward) / elapsedSeconds
      : 0;

    const brake = this.updateEpisode({
      episode: this.brake,
      kind: 'hard_braking_candidate',
      active: longitudinal <= -this.config.hardBraking.triggerLongitudinalG,
      released: longitudinal > -this.config.hardBraking.releaseLongitudinalG,
      primary: Math.abs(longitudinal),
      jerk,
      rotation: yaw,
      now: sample.receivedMonotonicMs,
      minimumDurationMs: this.config.hardBraking.minimumDurationMs,
      minimumJerkGps: this.config.hardBraking.minimumJerkGps,
      threshold: this.config.hardBraking.triggerLongitudinalG,
      cooldownMs: this.config.hardBraking.cooldownMs,
    });
    if (brake) events.push(brake);

    const acceleration = this.updateEpisode({
      episode: this.acceleration,
      kind: 'rapid_acceleration_candidate',
      active: longitudinal >= this.config.rapidAcceleration.triggerLongitudinalG,
      released: longitudinal < this.config.rapidAcceleration.releaseLongitudinalG,
      primary: longitudinal,
      jerk,
      rotation: yaw,
      now: sample.receivedMonotonicMs,
      minimumDurationMs: this.config.rapidAcceleration.minimumDurationMs,
      minimumJerkGps: this.config.rapidAcceleration.minimumJerkGps,
      threshold: this.config.rapidAcceleration.triggerLongitudinalG,
      cooldownMs: this.config.rapidAcceleration.cooldownMs,
    });
    if (acceleration) events.push(acceleration);

    const corner = this.updateEpisode({
      episode: this.corner,
      kind: 'harsh_corner_candidate',
      active: lateral >= this.config.harshCornering.triggerLateralG
        && yaw >= this.config.harshCornering.minimumYawRateDps,
      released: lateral < this.config.harshCornering.releaseLateralG
        || yaw < this.config.harshCornering.releaseYawRateDps,
      primary: lateral,
      jerk: 0,
      rotation: yaw,
      now: sample.receivedMonotonicMs,
      minimumDurationMs: this.config.harshCornering.minimumDurationMs,
      minimumJerkGps: 0,
      threshold: this.config.harshCornering.triggerLateralG,
      cooldownMs: this.config.harshCornering.cooldownMs,
    });
    if (corner) events.push(corner);

    this.previous = sample;
    return Object.freeze(events);
  }

  reset(): void {
    this.brake = emptyEpisode();
    this.acceleration = emptyEpisode();
    this.corner = emptyEpisode();
    this.previous = undefined;
  }

  private clearActiveEpisodes(): void {
    for (const episode of [this.brake, this.acceleration, this.corner]) {
      episode.startedAtMs = undefined;
      episode.lastAtMs = undefined;
      episode.peakPrimary = 0;
      episode.peakJerkGps = 0;
      episode.peakRotationDps = 0;
      episode.emitted = false;
    }
  }

  private updateEpisode(options: Readonly<{
    episode: Episode;
    kind: BehaviorKind;
    active: boolean;
    released: boolean;
    primary: number;
    jerk: number;
    rotation: number;
    now: number;
    minimumDurationMs: number;
    minimumJerkGps: number;
    threshold: number;
    cooldownMs: number;
  }>): ImuEvent | undefined {
    const episode = options.episode;
    if (options.released) {
      episode.startedAtMs = undefined;
      episode.lastAtMs = undefined;
      episode.peakPrimary = 0;
      episode.peakJerkGps = 0;
      episode.peakRotationDps = 0;
      episode.emitted = false;
      return undefined;
    }
    if (!options.active) return undefined;
    episode.startedAtMs ??= options.now;
    episode.lastAtMs = options.now;
    episode.peakPrimary = Math.max(episode.peakPrimary, options.primary);
    episode.peakJerkGps = Math.max(episode.peakJerkGps, options.jerk);
    episode.peakRotationDps = Math.max(episode.peakRotationDps, options.rotation);
    const durationMs = options.now - episode.startedAtMs;
    if (episode.emitted || options.now < episode.cooldownUntilMs
      || durationMs < options.minimumDurationMs || episode.peakJerkGps < options.minimumJerkGps) return undefined;

    episode.emitted = true;
    episode.cooldownUntilMs = options.now + options.cooldownMs;
    return Object.freeze({
      kind: options.kind,
      occurredAtMs: options.now,
      severity: 'warning',
      confidence: confidence(episode.peakPrimary, options.threshold, durationMs, options.minimumDurationMs),
      evidence: Object.freeze({
        durationMs,
        peakAccelerationG: episode.peakPrimary,
        peakJerkGps: episode.peakJerkGps,
        peakRotationDps: episode.peakRotationDps,
      }),
    });
  }
}
