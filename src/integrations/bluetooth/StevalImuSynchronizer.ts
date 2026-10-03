import type { ImuSample, Vector3 } from '../../core/sensors/types';
import type { DecodedStevalBatch } from './stevalMkboxProDecoder';
import { STEVAL_MKBOXPRO_DATALOG2_V34_PROFILE as PROFILE } from './stevalMkboxProProfile';

type QueuedBatch = Readonly<{
  vectors: readonly Vector3[];
  receivedMonotonicMs: number;
}>;

export type SynchronizationResult = Readonly<{
  samples: readonly ImuSample[];
  resynchronized: boolean;
  droppedBatchCount: number;
}>;

export type StevalImuSynchronizerOptions = Readonly<{
  maximumQueuedBatches?: number;
}>;

/**
 * Pairs the board's separate accelerometer and gyroscope batches by FIFO
 * ordinal. DATALOG2 supplies neither timestamps nor packet sequence numbers,
 * so this is deliberately a best-effort alignment.
 */
export class StevalImuSynchronizer {
  private readonly maximumQueuedBatches: number;
  private accelerationQueue: QueuedBatch[] = [];
  private gyroscopeQueue: QueuedBatch[] = [];
  private nextSequence = 0;
  private nextSampleTimeMs: number | undefined;
  private lastEmittedTimeMs: number | undefined;

  constructor(options: StevalImuSynchronizerOptions = {}) {
    this.maximumQueuedBatches = options.maximumQueuedBatches ?? 4;
    if (!Number.isInteger(this.maximumQueuedBatches) || this.maximumQueuedBatches < 1) {
      throw new Error('maximumQueuedBatches must be a positive integer.');
    }
  }

  push(batch: DecodedStevalBatch, receivedMonotonicMs: number): SynchronizationResult {
    if (!Number.isFinite(receivedMonotonicMs)) {
      throw new Error('receivedMonotonicMs must be finite.');
    }

    const queued = Object.freeze({ vectors: batch.vectors, receivedMonotonicMs });
    if (batch.sensor === 'accelerometer') {
      this.accelerationQueue.push(queued);
    } else {
      this.gyroscopeQueue.push(queued);
    }

    if (
      this.accelerationQueue.length > this.maximumQueuedBatches ||
      this.gyroscopeQueue.length > this.maximumQueuedBatches
    ) {
      const droppedBatchCount = this.accelerationQueue.length + this.gyroscopeQueue.length;
      this.clearQueuesForResynchronization();
      return Object.freeze({ samples: Object.freeze([]), resynchronized: true, droppedBatchCount });
    }

    const samples: ImuSample[] = [];
    while (this.accelerationQueue.length > 0 && this.gyroscopeQueue.length > 0) {
      const acceleration = this.accelerationQueue.shift()!;
      const gyroscope = this.gyroscopeQueue.shift()!;
      if (acceleration.vectors.length !== gyroscope.vectors.length) {
        const droppedBatchCount =
          2 + this.accelerationQueue.length + this.gyroscopeQueue.length;
        this.clearQueuesForResynchronization();
        return Object.freeze({
          samples: Object.freeze(samples),
          resynchronized: true,
          droppedBatchCount,
        });
      }

      const periodMs = 1_000 / PROFILE.sampleRateHz;
      if (this.nextSampleTimeMs === undefined) {
        const receivedAtMs = Math.max(
          acceleration.receivedMonotonicMs,
          gyroscope.receivedMonotonicMs,
        );
        const batchStartMs = receivedAtMs - (acceleration.vectors.length - 1) * periodMs;
        this.nextSampleTimeMs = Math.max(
          batchStartMs,
          this.lastEmittedTimeMs === undefined ? batchStartMs : this.lastEmittedTimeMs + periodMs,
        );
      }

      for (let index = 0; index < acceleration.vectors.length; index++) {
        const sampleTimeMs = this.nextSampleTimeMs;
        samples.push(
          Object.freeze({
            sequence: this.nextSequence++,
            deviceTimeMs: sampleTimeMs,
            receivedMonotonicMs: sampleTimeMs,
            accelerationG: acceleration.vectors[index],
            angularVelocityDps: gyroscope.vectors[index],
            frame: 'sensor',
          }),
        );
        this.lastEmittedTimeMs = sampleTimeMs;
        this.nextSampleTimeMs += periodMs;
      }
    }

    return Object.freeze({
      samples: Object.freeze(samples),
      resynchronized: false,
      droppedBatchCount: 0,
    });
  }

  getQueueDepths(): Readonly<{ accelerometer: number; gyroscope: number }> {
    return Object.freeze({
      accelerometer: this.accelerationQueue.length,
      gyroscope: this.gyroscopeQueue.length,
    });
  }

  reset(): void {
    this.accelerationQueue = [];
    this.gyroscopeQueue = [];
    this.nextSequence = 0;
    this.nextSampleTimeMs = undefined;
    this.lastEmittedTimeMs = undefined;
  }

  private clearQueuesForResynchronization(): void {
    this.accelerationQueue = [];
    this.gyroscopeQueue = [];
    this.nextSampleTimeMs = undefined;
  }
}
