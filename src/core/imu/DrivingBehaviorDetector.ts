import type { ImuEvent } from '../events/types';
import type { DrivingBehaviorConfig } from './types';
import type { VehicleFrameSample } from './VehicleFrame';

type BehaviorKind =
  | 'crash_candidate'
  | 'hard_braking_candidate'
  | 'rapid_acceleration_candidate'
  | 'harsh_corner_candidate';

/** Low-pass-filtered vehicle-frame signal. `pitch`/`roll` are the forward/lateral rotation rates. */
type Smoothed = { forward: number; lateral: number; yaw: number; pitch: number; roll: number };

/** Extremes of the smoothed vehicle-frame signal since the last `takeMotionPeaks()`, for tuning. */
export type MotionPeaks = Readonly<{
  minimumForwardG: number;
  maximumForwardG: number;
  maximumLateralG: number;
  maximumYawDps: number;
  maximumTiltRateDps: number;
  maximumJerkGps: number;
  /** The learned resting level being subtracted, at the time of the read. */
  restingForwardG: number;
  restingLateralG: number;
}>;

type Episode = {
  startedAtMs?: number;
  lastAtMs?: number;
  peakPrimary: number;
  peakJerkGps: number;
  peakRotationDps: number;
  /** Degrees swept in one direction while the episode is open (cornering only). */
  headingDeg: number;
  /** The board tilted fast during this episode, so gravity, not the car, may explain it. */
  tilted: boolean;
  /** Seen a calm (released) reading since the stream started, so it can't fire on a stale offset. */
  armed: boolean;
  emitted: boolean;
  cooldownUntilMs: number;
};

const emptyEpisode = (): Episode => ({
  peakPrimary: 0,
  peakJerkGps: 0,
  peakRotationDps: 0,
  headingDeg: 0,
  tilted: false,
  armed: false,
  emitted: false,
  cooldownUntilMs: -Infinity,
});

function clearEpisode(episode: Episode): void {
  episode.startedAtMs = undefined;
  episode.lastAtMs = undefined;
  episode.peakPrimary = 0;
  episode.peakJerkGps = 0;
  episode.peakRotationDps = 0;
  episode.headingDeg = 0;
  episode.tilted = false;
  episode.emitted = false;
}

const RESTING_SEED_MS = 500;

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
  private resting = { forward: 0, lateral: 0 };
  private restingSeeded = false;
  private stillSinceMs?: number;
  private peaks?: { -readonly [K in keyof MotionPeaks]: number };

  constructor(private readonly config: DrivingBehaviorConfig) {}

  process(sample: VehicleFrameSample): readonly ImuEvent[] {
    const events: ImuEvent[] = [];
    const elapsedMs = this.previous ? sample.receivedMonotonicMs - this.previous.receivedMonotonicMs : 0;
    const raw: Smoothed = {
      forward: sample.accelerationG.forward,
      lateral: sample.accelerationG.lateral,
      yaw: sample.angularVelocityDps.vertical,
      pitch: sample.angularVelocityDps.lateral,
      roll: sample.angularVelocityDps.forward,
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
    const tau = this.config.smoothingTimeConstantMs;
    const alpha = !this.smoothed || tau === 0 ? 1 : 1 - Math.exp(-elapsedMs / tau);
    const before = this.smoothed ?? raw;
    const smoothed: Smoothed = {
      forward: before.forward + alpha * (raw.forward - before.forward),
      lateral: before.lateral + alpha * (raw.lateral - before.lateral),
      yaw: before.yaw + alpha * (raw.yaw - before.yaw),
      pitch: before.pitch + alpha * (raw.pitch - before.pitch),
      roll: before.roll + alpha * (raw.roll - before.roll),
    };
    this.smoothed = smoothed;
    this.updateRestingLevel(sample, smoothed, elapsedMs);

    const longitudinal = smoothed.forward - this.resting.forward;
    const previousLongitudinal = before.forward - this.resting.forward;
    const lateral = Math.abs(smoothed.lateral - this.resting.lateral);
    const yaw = Math.abs(smoothed.yaw);
    const tiltRate = Math.hypot(smoothed.pitch, smoothed.roll);
    const tilting = tiltRate > this.config.maximumTiltRateDps;
    const jerk = elapsedSeconds > 0 ? Math.abs(longitudinal - previousLongitudinal) / elapsedSeconds : 0;
    this.recordPeaks(longitudinal, lateral, yaw, tiltRate, jerk);

    const severe = this.updateEpisode({
      episode: this.severe,
      kind: 'crash_candidate',
      severity: 'critical',
      active: longitudinal <= -this.config.severeDeceleration.triggerLongitudinalG,
      released: longitudinal > -this.config.severeDeceleration.releaseLongitudinalG,
      primary: Math.abs(longitudinal),
      jerk,
      rotation: yaw,
      tilting,
      tiltExemptAbove: this.config.severeDeceleration.tiltExemptG,
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
      tilting,
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
      tilting,
      now: sample.receivedMonotonicMs,
      minimumDurationMs: this.config.rapidAcceleration.minimumDurationMs,
      minimumJerkGps: this.config.rapidAcceleration.minimumJerkGps,
      threshold: this.config.rapidAcceleration.triggerLongitudinalG,
      cooldownMs: this.config.rapidAcceleration.cooldownMs,
    });
    if (acceleration) events.push(acceleration);

    // Turning back the other way passes the yaw rate through zero, which releases the episode and
    // restarts the heading: only a sustained arc in one direction can reach the heading minimum.
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
      tilting,
      headingStepDeg: yaw * elapsedSeconds,
      minimumHeadingChangeDeg: this.config.harshCornering.minimumHeadingChangeDeg,
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
    return peaks
      ? Object.freeze({ ...peaks, restingForwardG: this.resting.forward, restingLateralG: this.resting.lateral })
      : undefined;
  }

  reset(): void {
    this.severe = emptyEpisode();
    this.brake = emptyEpisode();
    this.acceleration = emptyEpisode();
    this.corner = emptyEpisode();
    this.previous = undefined;
    this.smoothed = undefined;
    this.resting = { forward: 0, lateral: 0 };
    this.restingSeeded = false;
    this.stillSinceMs = undefined;
    this.peaks = undefined;
  }

  /**
   * While the board is still (total acceleration ≈ 1 g and no rotation), any forward/lateral reading
   * is gravity from a tilted mount, not motion. Track it slowly so a board that shifted since its
   * calibration does not read as permanent braking or cornering.
   */
  private updateRestingLevel(sample: VehicleFrameSample, smoothed: Smoothed, elapsedMs: number): void {
    const { forward, lateral, vertical } = sample.accelerationG;
    const rotation = Math.hypot(smoothed.yaw, smoothed.pitch, smoothed.roll);
    const config = this.config.restingLevel;
    if (Math.abs(Math.hypot(forward, lateral, vertical) - 1) > config.stillAccelerationToleranceG
      || rotation > config.stillRotationDps) {
      this.stillSinceMs = undefined;
      return;
    }
    this.stillSinceMs ??= sample.receivedMonotonicMs;
    if (!this.restingSeeded) {
      // Take the first half second of stillness as the resting level outright.
      if (sample.receivedMonotonicMs - this.stillSinceMs < RESTING_SEED_MS) return;
      this.resting = { forward: smoothed.forward, lateral: smoothed.lateral };
      this.restingSeeded = true;
      return;
    }
    const alpha = 1 - Math.exp(-elapsedMs / config.timeConstantMs);
    this.resting.forward += alpha * (smoothed.forward - this.resting.forward);
    this.resting.lateral += alpha * (smoothed.lateral - this.resting.lateral);
  }

  private clearActiveEpisodes(): void {
    for (const episode of [this.severe, this.brake, this.acceleration, this.corner]) clearEpisode(episode);
  }

  private recordPeaks(forward: number, lateral: number, yaw: number, tiltRate: number, jerk: number): void {
    if (!this.peaks) {
      this.peaks = {
        minimumForwardG: forward,
        maximumForwardG: forward,
        maximumLateralG: lateral,
        maximumYawDps: yaw,
        maximumTiltRateDps: tiltRate,
        maximumJerkGps: jerk,
        restingForwardG: this.resting.forward,
        restingLateralG: this.resting.lateral,
      };
      return;
    }
    this.peaks.minimumForwardG = Math.min(this.peaks.minimumForwardG, forward);
    this.peaks.maximumForwardG = Math.max(this.peaks.maximumForwardG, forward);
    this.peaks.maximumLateralG = Math.max(this.peaks.maximumLateralG, lateral);
    this.peaks.maximumYawDps = Math.max(this.peaks.maximumYawDps, yaw);
    this.peaks.maximumTiltRateDps = Math.max(this.peaks.maximumTiltRateDps, tiltRate);
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
    tilting: boolean;
    /** A peak at or above this is accepted even if the board tilted (tilt adds at most 1 g). */
    tiltExemptAbove?: number;
    headingStepDeg?: number;
    minimumHeadingChangeDeg?: number;
    now: number;
    minimumDurationMs: number;
    minimumJerkGps: number;
    threshold: number;
    cooldownMs: number;
  }>): ImuEvent | undefined {
    const episode = options.episode;
    if (options.released) {
      clearEpisode(episode);
      episode.armed = true;
      return undefined;
    }
    if (!episode.armed) return undefined;
    // Onset jerk, tilt, and heading build up on the way to the trigger, so count them from release.
    episode.peakJerkGps = Math.max(episode.peakJerkGps, options.jerk);
    episode.tilted ||= options.tilting;
    episode.headingDeg += options.headingStepDeg ?? 0;
    if (!options.active) return undefined;
    episode.startedAtMs ??= options.now;
    episode.lastAtMs = options.now;
    episode.peakPrimary = Math.max(episode.peakPrimary, options.primary);
    episode.peakRotationDps = Math.max(episode.peakRotationDps, options.rotation);
    const durationMs = options.now - episode.startedAtMs;
    const tiltExcused = options.tiltExemptAbove !== undefined && episode.peakPrimary >= options.tiltExemptAbove;
    if (episode.emitted || options.now < episode.cooldownUntilMs
      || durationMs < options.minimumDurationMs || episode.peakJerkGps < options.minimumJerkGps
      || (episode.tilted && !tiltExcused)
      || episode.headingDeg < (options.minimumHeadingChangeDeg ?? 0)) return undefined;

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
        ...(options.headingStepDeg !== undefined ? { headingChangeDeg: episode.headingDeg } : {}),
      }),
    });
  }
}
