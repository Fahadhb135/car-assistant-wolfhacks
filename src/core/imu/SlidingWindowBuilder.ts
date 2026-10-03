import type { ImuSample } from '../sensors/types';
import type { SlidingWindowConfig, TimeWindow } from './types';

export type WindowBuildResult = Readonly<{
  windows: readonly TimeWindow[];
  skippedWindowCount: number;
}>;

export class SlidingWindowBuilder {
  private samples: ImuSample[] = [];
  private nextWindowStartMs: number | undefined;

  constructor(private readonly config: SlidingWindowConfig) {}

  push(sample: ImuSample): WindowBuildResult {
    this.nextWindowStartMs ??= sample.receivedMonotonicMs;
    this.samples.push(sample);
    if (this.samples.length > this.config.maximumBufferedSamples) {
      this.samples.splice(0, this.samples.length - this.config.maximumBufferedSamples);
    }

    const windows: TimeWindow[] = [];
    let emitted = 0;
    while (
      this.nextWindowStartMs !== undefined &&
      sample.receivedMonotonicMs >= this.nextWindowStartMs + this.config.durationMs &&
      emitted < this.config.maximumCatchUpWindows
    ) {
      const startedAtMs = this.nextWindowStartMs;
      const endedAtMs = startedAtMs + this.config.durationMs;
      windows.push(Object.freeze({
        startedAtMs,
        endedAtMs,
        samples: Object.freeze(this.samples.filter((value) =>
          value.receivedMonotonicMs >= startedAtMs && value.receivedMonotonicMs < endedAtMs)),
      }));
      this.nextWindowStartMs += this.config.stepMs;
      emitted += 1;
    }

    let skippedWindowCount = 0;
    if (
      this.nextWindowStartMs !== undefined &&
      sample.receivedMonotonicMs >= this.nextWindowStartMs + this.config.durationMs
    ) {
      const calculatedSkipCount = Math.floor(
        (sample.receivedMonotonicMs - (this.nextWindowStartMs + this.config.durationMs)) /
          this.config.stepMs,
      ) + 1;
      if (Number.isSafeInteger(calculatedSkipCount)) {
        skippedWindowCount = calculatedSkipCount;
        this.nextWindowStartMs += skippedWindowCount * this.config.stepMs;
      } else {
        skippedWindowCount = Number.MAX_SAFE_INTEGER;
        this.nextWindowStartMs = sample.receivedMonotonicMs - this.config.durationMs + this.config.stepMs;
      }
    }

    if (this.nextWindowStartMs !== undefined) {
      let removeCount = 0;
      while (removeCount < this.samples.length && this.samples[removeCount]!.receivedMonotonicMs < this.nextWindowStartMs) {
        removeCount += 1;
      }
      if (removeCount > 0) this.samples.splice(0, removeCount);
    }

    return Object.freeze({ windows: Object.freeze(windows), skippedWindowCount });
  }

  reset(): void {
    this.samples = [];
    this.nextWindowStartMs = undefined;
  }
}
