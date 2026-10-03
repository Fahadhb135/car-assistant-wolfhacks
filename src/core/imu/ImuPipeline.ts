import type { ImuEvent } from '../events/types';
import type { ImuSample } from '../sensors/types';
import { resolvePipelineConfig } from './config';
import { CrashCandidateDetector } from './CrashCandidateDetector';
import { extractWindowFeatures } from './features';
import { SampleValidator } from './sampleValidation';
import { SlidingWindowBuilder } from './SlidingWindowBuilder';
import { StreamHealth } from './StreamHealth';
import { SwerveCandidateDetector } from './SwerveCandidateDetector';
import { TimeRingBuffer } from './TimeRingBuffer';
import type { ImuPipelineResult, PartialImuPipelineConfig, StreamHealthSnapshot } from './types';

export class ImuPipeline {
  private readonly config;
  private readonly validator;
  private readonly health = new StreamHealth();
  private readonly buffer;
  private readonly windows;
  private readonly crashDetector;
  private readonly swerveDetector;

  constructor(config: PartialImuPipelineConfig = {}) {
    this.config = resolvePipelineConfig(config);
    this.validator = new SampleValidator(this.config.validation);
    this.buffer = new TimeRingBuffer(this.config.bufferRetentionMs, this.config.maximumBufferedSamples);
    this.windows = new SlidingWindowBuilder(this.config.windows);
    this.crashDetector = new CrashCandidateDetector(this.config.crash);
    this.swerveDetector = new SwerveCandidateDetector(this.config.swerve);
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
      });
    }

    this.validator.accept(sample);
    this.health.recordAccepted(sample);
    this.buffer.push(sample);
    const events: ImuEvent[] = [];
    const crashEvent = this.crashDetector.process(sample);
    if (crashEvent) events.push(crashEvent);

    const buildResult = this.windows.push(sample);
    const completedWindows = buildResult.windows.map((window) =>
      extractWindowFeatures(window, this.config.swerve.rotationAxis, this.config.swerve.directionDeadbandDps));
    for (const features of completedWindows) {
      const event = this.swerveDetector.process(features);
      if (event) events.push(event);
    }

    return Object.freeze({
      accepted: true,
      events: Object.freeze(events),
      completedWindows: Object.freeze(completedWindows),
      skippedWindowCount: buildResult.skippedWindowCount,
      health: this.health.snapshot(),
    });
  }

  getHealth(): StreamHealthSnapshot {
    return this.health.snapshot();
  }

  getBufferedSamples(): readonly ImuSample[] {
    return this.buffer.values();
  }

  reset(): void {
    this.validator.reset();
    this.health.reset();
    this.buffer.reset();
    this.windows.reset();
    this.crashDetector.reset();
    this.swerveDetector.reset();
  }
}
