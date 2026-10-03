import type { ImuSample } from '../sensors/types';
import type { SampleRejectionReason, StreamHealthSnapshot } from './types';

export class StreamHealth {
  private receivedCount = 0;
  private acceptedCount = 0;
  private rejectionCounts: Partial<Record<SampleRejectionReason, number>> = {};
  private firstTimestampMs: number | undefined;
  private lastTimestampMs: number | undefined;
  private lastSequence: number | undefined;
  private missingSequenceCount = 0;
  private largestInterSampleGapMs = 0;

  recordReceived(): void {
    this.receivedCount += 1;
  }

  recordRejected(reason: SampleRejectionReason): void {
    this.rejectionCounts[reason] = (this.rejectionCounts[reason] ?? 0) + 1;
  }

  recordAccepted(sample: ImuSample): void {
    this.acceptedCount += 1;
    this.firstTimestampMs ??= sample.receivedMonotonicMs;
    if (this.lastTimestampMs !== undefined) {
      this.largestInterSampleGapMs = Math.max(this.largestInterSampleGapMs, sample.receivedMonotonicMs - this.lastTimestampMs);
    }
    if (sample.sequence !== undefined && this.lastSequence !== undefined && sample.sequence > this.lastSequence + 1) {
      this.missingSequenceCount += sample.sequence - this.lastSequence - 1;
    }
    this.lastTimestampMs = sample.receivedMonotonicMs;
    if (sample.sequence !== undefined) this.lastSequence = sample.sequence;
  }

  snapshot(): StreamHealthSnapshot {
    const elapsedMs = this.firstTimestampMs === undefined || this.lastTimestampMs === undefined
      ? 0
      : this.lastTimestampMs - this.firstTimestampMs;
    const estimatedSampleRateHz = elapsedMs > 0 && this.acceptedCount > 1
      ? ((this.acceptedCount - 1) * 1_000) / elapsedMs
      : 0;
    return Object.freeze({
      receivedCount: this.receivedCount,
      acceptedCount: this.acceptedCount,
      rejectedCount: this.receivedCount - this.acceptedCount,
      rejectionCounts: Object.freeze({ ...this.rejectionCounts }),
      estimatedSampleRateHz,
      missingSequenceCount: this.missingSequenceCount,
      largestInterSampleGapMs: this.largestInterSampleGapMs,
    });
  }

  reset(): void {
    this.receivedCount = 0;
    this.acceptedCount = 0;
    this.rejectionCounts = {};
    this.firstTimestampMs = undefined;
    this.lastTimestampMs = undefined;
    this.lastSequence = undefined;
    this.missingSequenceCount = 0;
    this.largestInterSampleGapMs = 0;
  }
}
