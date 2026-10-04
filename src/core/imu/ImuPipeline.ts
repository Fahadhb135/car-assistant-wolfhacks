import type { ImuEvent } from '../events/types';
import type { ImuSample } from '../sensors/types';
import { resolvePipelineConfig } from './config';
import { CrashCandidateDetector } from './CrashCandidateDetector';
import { DrivingBehaviorDetector, type MotionPeaks } from './DrivingBehaviorDetector';
import { extractWindowFeatures } from './features';
import { SampleValidator } from './sampleValidation';
import { SlidingWindowBuilder } from './SlidingWindowBuilder';
import { StreamHealth } from './StreamHealth';
import { SwerveCandidateDetector } from './SwerveCandidateDetector';
import { TimeRingBuffer } from './TimeRingBuffer';
import type {
  ImuArbitrationSnapshot,
  ImuPipelineResult,
  PartialImuPipelineConfig,
  StreamHealthSnapshot,
} from './types';
import { enabledKinds, tuningToConfig, type ImuTuning } from './tuning';
import { toVehicleFrame, type VehicleFrameCalibration } from './VehicleFrame';

const NON_CRASH_PRIORITY: Readonly<Record<ImuEvent['kind'], number>> = Object.freeze({
  crash_candidate: Number.POSITIVE_INFINITY,
  hard_braking_candidate: 4,
  harsh_corner_candidate: 3,
  rapid_acceleration_candidate: 2,
  swerve_candidate: 1,
});

export class ImuPipeline {
  private config;
  private enabled?: ReadonlySet<ImuEvent['kind']>;
  private readonly validator;
  private readonly health = new StreamHealth();
  private readonly buffer;
  private readonly windows;
  private readonly crashDetector;
  private readonly swerveDetector;
  private readonly behaviorDetector;
  private vehicleCalibration?: VehicleFrameCalibration;
  private lastProcessedAtMs = 0;
  private lastNonCrashEventAtMs = Number.NEGATIVE_INFINITY;
  private suppressedCount = 0;
  private suppressedByKind: Partial<Record<ImuEvent['kind'], number>> = {};

  constructor(config: PartialImuPipelineConfig = {}) {
    this.config = resolvePipelineConfig(config);
    this.validator = new SampleValidator(this.config.validation);
    this.buffer = new TimeRingBuffer(this.config.bufferRetentionMs, this.config.maximumBufferedSamples);
    this.windows = new SlidingWindowBuilder(this.config.windows);
    this.crashDetector = new CrashCandidateDetector(this.config.crash);
    this.swerveDetector = new SwerveCandidateDetector(this.config.swerve);
    this.behaviorDetector = new DrivingBehaviorDetector(this.config.behaviors);
  }

  /** Applies live tuning (thresholds and which detectors are on) without losing stream state. */
  setTuning(tuning: ImuTuning): void {
    this.config = resolvePipelineConfig(tuningToConfig(tuning));
    this.enabled = enabledKinds(tuning);
    this.crashDetector.setConfig(this.config.crash);
    this.swerveDetector.setConfig(this.config.swerve);
    this.behaviorDetector.setConfig(this.config.behaviors);
  }

  setVehicleCalibration(calibration: VehicleFrameCalibration | undefined): void {
    this.vehicleCalibration = calibration;
    this.behaviorDetector.reset();
  }

  hasVehicleCalibration(): boolean {
    return this.vehicleCalibration !== undefined;
  }

  process(sample: ImuSample): ImuPipelineResult {
    this.health.recordReceived();
    const reason = this.validator.validate(sample);
    if (reason) {
      this.health.recordRejected(reason);
      return Object.freeze({
        accepted: false,
        reason,
        events: Object.freeze([]),
        completedWindows: Object.freeze([]),
        skippedWindowCount: 0,
        health: this.health.snapshot(),
        arbitration: this.arbitrationSnapshot(this.lastProcessedAtMs),
      });
    }

    this.validator.accept(sample);
    this.health.recordAccepted(sample);
    this.lastProcessedAtMs = sample.receivedMonotonicMs;
    this.buffer.push(sample);
    const candidates: ImuEvent[] = [];
    const crashEvent = this.crashDetector.process(sample);
    if (crashEvent) candidates.push(crashEvent);
    if (this.vehicleCalibration) {
      candidates.push(...this.behaviorDetector.process(toVehicleFrame(sample, this.vehicleCalibration)));
    }

    const buildResult = this.windows.push(sample);
    const completedWindows = buildResult.windows.map((window) =>
      extractWindowFeatures(window, this.config.swerve.rotationAxis, this.config.swerve.directionDeadbandDps));
    for (const features of completedWindows) {
      const event = this.swerveDetector.process(features);
      if (event) candidates.push(event);
    }
    const enabled = this.enabled;
    const events = this.arbitrate(
      enabled ? candidates.filter((candidate) => enabled.has(candidate.kind)) : candidates,
      sample.receivedMonotonicMs,
    );

    return Object.freeze({
      accepted: true,
      events: Object.freeze(events),
      completedWindows: Object.freeze(completedWindows),
      skippedWindowCount: buildResult.skippedWindowCount,
      health: this.health.snapshot(),
      arbitration: this.arbitrationSnapshot(sample.receivedMonotonicMs),
    });
  }

  /** Smoothed vehicle-frame extremes since the last call; undefined until calibrated samples arrive. */
  takeMotionPeaks(): MotionPeaks | undefined {
    return this.behaviorDetector.takeMotionPeaks();
  }

  getHealth(): StreamHealthSnapshot {
    return this.health.snapshot();
  }

  getBufferedSamples(): readonly ImuSample[] {
    return this.buffer.values();
  }

  getArbitrationState(): ImuArbitrationSnapshot {
    return this.arbitrationSnapshot(this.lastProcessedAtMs);
  }

  reset(): void {
    this.validator.reset();
    this.health.reset();
    this.buffer.reset();
    this.windows.reset();
    this.crashDetector.reset();
    this.swerveDetector.reset();
    this.behaviorDetector.reset();
    this.lastProcessedAtMs = 0;
    this.lastNonCrashEventAtMs = Number.NEGATIVE_INFINITY;
    this.suppressedCount = 0;
    this.suppressedByKind = {};
  }

  private arbitrate(candidates: readonly ImuEvent[], nowMs: number): readonly ImuEvent[] {
    const crash = candidates.find((event) => event.kind === 'crash_candidate');
    if (crash) {
      for (const candidate of candidates) {
        if (candidate !== crash) this.recordSuppressed(candidate.kind);
      }
      return Object.freeze([crash]);
    }
    if (candidates.length === 0) return Object.freeze([]);

    const ordered = [...candidates].sort((a, b) =>
      NON_CRASH_PRIORITY[b.kind] - NON_CRASH_PRIORITY[a.kind]
      || a.occurredAtMs - b.occurredAtMs);
    if (nowMs - this.lastNonCrashEventAtMs < this.config.nonCrashMotionCooldownMs) {
      for (const candidate of ordered) this.recordSuppressed(candidate.kind);
      return Object.freeze([]);
    }

    const admitted = ordered[0]!;
    this.lastNonCrashEventAtMs = nowMs;
    for (const candidate of ordered.slice(1)) this.recordSuppressed(candidate.kind);
    return Object.freeze([admitted]);
  }

  private recordSuppressed(kind: ImuEvent['kind']): void {
    this.suppressedCount += 1;
    this.suppressedByKind[kind] = (this.suppressedByKind[kind] ?? 0) + 1;
  }

  private arbitrationSnapshot(nowMs: number): ImuArbitrationSnapshot {
    const cooldownUntil = Number.isFinite(this.lastNonCrashEventAtMs)
      ? this.lastNonCrashEventAtMs + this.config.nonCrashMotionCooldownMs
      : null;
    const remaining = cooldownUntil === null ? 0 : Math.max(0, cooldownUntil - nowMs);
    return Object.freeze({
      nonCrashCooldownUntilMs: remaining > 0 ? cooldownUntil : null,
      nonCrashCooldownRemainingMs: remaining,
      suppressedCount: this.suppressedCount,
      suppressedByKind: Object.freeze({ ...this.suppressedByKind }),
    });
  }
}
