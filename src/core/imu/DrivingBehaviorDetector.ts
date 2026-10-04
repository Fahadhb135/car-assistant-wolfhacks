import type { ImuEvent } from '../events/types';
import type { DrivingBehaviorConfig } from './types';
import type { VehicleFrameSample } from './VehicleFrame';

type BehaviorKind =
  | 'crash_candidate'
  | 'hard_braking_candidate'
  | 'rapid_acceleration_candidate'
  | 'harsh_corner_candidate';

type Smoothed = { forward: number; lateral: number; yaw: number };

/** Extremes of the smoothed vehicle-frame signal since the last `takeMotionPeaks()`, for tuning. */
export type MotionPeaks = Readonly<{
  minimumForwardG: number;
  maximumForwardG: number;
  maximumLateralG: number;
  maximumYawDps: number;
  maximumJerkGps: number;
}>;

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
  private severe = emptyEpisode();
  private brake = emptyEpisode();
  private acceleration = emptyEpisode();
  private corner = emptyEpisode();
  private previous?: VehicleFrameSample;
  private smoothed?: Smoothed;
  private peaks?: { -readonly [K in keyof MotionPeaks]: number };

  constructor(private readonly config: DrivingBehaviorConfig) {}

  process(sample: VehicleFrameSample): readonly ImuEvent[] {
    const events: ImuEvent[] = [];
    const elapsedMs = this.previous ? sample.receivedMonotonicMs - this.previous.receivedMonotonicMs : 0;
    const raw = {
      forward: sample.accelerationG.forward,
      lateral: sample.accelerationG.lateral,
      yaw: sample.angularVelocityDps.vertical,
    };
    if (this.previous && (elapsedMs <= 0 || elapsedMs > this.config.maximumContinuityGapMs)) {
      this.clearActiveEpisodes();
      this.previous = sample;
      this.smoothed = raw;
      return events;
    }

    // Low-pass filter: at 120 Hz, raw sample-to-sample differences are mostly sensor noise and
    // engine vibration, which made every brake look "jerky" and broke corner episodes apart.
    const elapsedSeconds = elapsedMs / 1_000;
    const previousForward = this.smoothed?.forward ?? raw.forward;
    const tau = this.config.smoothingTimeConstantMs;
    const alpha = !this.smoothed || tau === 0 ? 1 : 1 - Math.exp(-elapsedMs / tau);
    const smoothed: Smoothed = this.smoothed
      ? {
          forward: this.smoothed.forward + alpha * (raw.forward - this.smoothed.forward),
          lateral: this.smoothed.lateral + alpha * (raw.lateral - this.smoothed.lateral),
          yaw: this.smoothed.yaw + alpha * (raw.yaw - this.smoothed.yaw),
        }
      : raw;
    this.smoothed = smoothed;

    const longitudinal = smoothed.forward;
    const lateral = Math.abs(smoothed.lateral);
    const yaw = Math.abs(smoothed.yaw);
    const jerk = elapsedSeconds > 0 ? Math.abs(longitudinal - previousForward) / elapsedSeconds : 0;
    this.recordPeaks(longitudinal, lateral, yaw, jerk);

    const severe = this.updateEpisode({
      episode: this.severe,
      kind: 'crash_candidate',
      severity: 'critical',
      active: longitudinal <= -this.config.severeDeceleration.triggerLongitudinalG,
      released: longitudinal > -this.config.severeDeceleration.releaseLongitudinalG,
      primary: Math.abs(longitudinal),
      jerk,
      rotation: yaw,
      now: sample.receivedMonotonicMs,
      minimumDurationMs: this.config.severeDeceleration.minimumDurationMs,
      minimumJerkGps: 0,
      threshold: this.config.severeDeceleration.triggerLongitudinalG,
      cooldownMs: this.config.severeDeceleration.cooldownMs,
    });
    if (severe) events.push(severe);

    const brake = this.updateEpisode({
      episode: this.brake,
      kind: 'hard_braking_candidate',
      severity: 'warning',
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
      severity: 'warning',
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
      severity: 'warning',
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

  /** Returns the signal extremes seen since the previous call (undefined before any sample). */
  takeMotionPeaks(): MotionPeaks | undefined {
    const peaks = this.peaks;
    this.peaks = undefined;
    return peaks ? Object.freeze({ ...peaks }) : undefined;
  }

  reset(): void {
    this.severe = emptyEpisode();
    this.smoothed = undefined;
    this.peaks = undefined;
    this.brake = emptyEpisode();
    this.acceleration = emptyEpisode();
    this.corner = emptyEpisode();
    this.previous = undefined;
  }

  private clearActiveEpisodes(): void {
    for (const episode of [this.severe, this.brake, this.acceleration, this.corner]) {
      episode.startedAtMs = undefined;
      episode.lastAtMs = undefined;
      episode.peakPrimary = 0;
      episode.peakJerkGps = 0;
      episode.peakRotationDps = 0;
      episode.emitted = false;
    }
  }

  private recordPeaks(forward: number, lateral: number, yaw: number, jerk: number): void {
    if (!this.peaks) {
      this.peaks = {
        minimumForwardG: forward,
        maximumForwardG: forward,
        maximumLateralG: lateral,
        maximumYawDps: yaw,
        maximumJerkGps: jerk,
      };
      return;
    }
    this.peaks.minimumForwardG = Math.min(this.peaks.minimumForwardG, forward);
    this.peaks.maximumForwardG = Math.max(this.peaks.maximumForwardG, forward);
    this.peaks.maximumLateralG = Math.max(this.peaks.maximumLateralG, lateral);
    this.peaks.maximumYawDps = Math.max(this.peaks.maximumYawDps, yaw);
    this.peaks.maximumJerkGps = Math.max(this.peaks.maximumJerkGps, jerk);
  }

  private updateEpisode(options: Readonly<{
    episode: Episode;
    kind: BehaviorKind;
    severity: ImuEvent['severity'];
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
    // The jerk of the onset happens on the way to the trigger, so count it from the release level.
    episode.peakJerkGps = Math.max(episode.peakJerkGps, options.jerk);
    if (!options.active) return undefined;
    episode.startedAtMs ??= options.now;
    episode.lastAtMs = options.now;
    episode.peakPrimary = Math.max(episode.peakPrimary, options.primary);
    episode.peakRotationDps = Math.max(episode.peakRotationDps, options.rotation);
    const durationMs = options.now - episode.startedAtMs;
    if (episode.emitted || options.now < episode.cooldownUntilMs
      || durationMs < options.minimumDurationMs || episode.peakJerkGps < options.minimumJerkGps) return undefined;

    episode.emitted = true;
    episode.cooldownUntilMs = options.now + options.cooldownMs;
    return Object.freeze({
      kind: options.kind,
      occurredAtMs: options.now,
      severity: options.severity,
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
