import type { ImuSample } from '../sensors/types';

export class TimeRingBuffer {
  private samples: ImuSample[] = [];

  constructor(
    private readonly retentionMs: number,
    private readonly maximumSamples: number,
  ) {}

  push(sample: ImuSample): void {
    this.samples.push(sample);
    const cutoff = sample.receivedMonotonicMs - this.retentionMs;
    let removeCount = 0;
    while (removeCount < this.samples.length && this.samples[removeCount]!.receivedMonotonicMs < cutoff) removeCount += 1;
    if (removeCount > 0) this.samples.splice(0, removeCount);
    if (this.samples.length > this.maximumSamples) this.samples.splice(0, this.samples.length - this.maximumSamples);
  }

  values(): readonly ImuSample[] {
    return Object.freeze([...this.samples]);
  }

  get size(): number {
    return this.samples.length;
  }

  reset(): void {
    this.samples = [];
  }
}
