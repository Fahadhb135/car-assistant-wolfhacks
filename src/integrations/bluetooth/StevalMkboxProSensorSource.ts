import type {
  SensorErrorListener,
  SensorSampleListener,
  SensorSource,
} from '../../core/sensors/SensorSource';
import type { BluetoothClient } from './BluetoothClient';
import { base64ToBytes } from './base64';
import {
  decodeStevalMkboxProImuPacket,
  StevalPacketDecodeError,
  type StevalPacketDecodeErrorCode,
} from './stevalMkboxProDecoder';
import { StevalImuSynchronizer } from './StevalImuSynchronizer';
import { STEVAL_MKBOXPRO_DATALOG2_V34_PROFILE as PROFILE } from './stevalMkboxProProfile';
import {
  frameStPnplCommand,
  startImuStreamCommands,
  StPnplResponseAssembler,
  stopImuStreamCommands,
} from './stPnpl';
import type { RawBlePacket } from './types';

type SourceState = 'idle' | 'starting' | 'running' | 'stopping';

type PendingResponse = {
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type StevalSourceDiagnostics = Readonly<{
  state: SourceState;
  monitoredCharacteristicCount: number;
  acceptedCommandCount: number;
  decodedBatchCount: number;
  decodedVectorCount: number;
  rejectedPacketCount: number;
  rejectionCounts: Readonly<Partial<Record<StevalPacketDecodeErrorCode, number>>>;
  unknownSensorIdCount: number;
  queueResynchronizationCount: number;
  droppedBatchCount: number;
  emittedSampleCount: number;
  estimatedSampleRateHz: number;
  largestPairInterarrivalGapMs: number;
  accelerometerQueueDepth: number;
  gyroscopeQueueDepth: number;
}>;

export type StevalMkboxProSensorSourceOptions = Readonly<{
  commandTimeoutMs?: number;
  writePacingMs?: number;
  maximumQueuedBatches?: number;
}>;

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function responseSucceeded(response: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response);
  } catch {
    throw new Error(`The board returned invalid PnPL JSON: ${response}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`The board returned an invalid PnPL response: ${response}`);
  }
  const envelope = (parsed as { PnPL_Response?: unknown }).PnPL_Response;
  if (!envelope || typeof envelope !== 'object') {
    throw new Error(`The board returned an unexpected PnPL response: ${response}`);
  }
  const status = (envelope as { status?: unknown }).status;
  if (status !== true) {
    const message = (envelope as { message?: unknown }).message;
    throw new Error(
      `The board rejected a PnPL command${typeof message === 'string' && message ? `: ${message}` : '.'}`,
    );
  }
  return true;
}

/** Live normalized IMU source for the factory STEVAL-MKBOXPRO DATALOG2 v3.4 firmware. */
export class StevalMkboxProSensorSource implements SensorSource {
  private readonly commandTimeoutMs: number;
  private readonly writePacingMs: number;
  private readonly synchronizer: StevalImuSynchronizer;
  private assembler = new StPnplResponseAssembler();
  private state: SourceState = 'idle';
  private onSample: SensorSampleListener | null = null;
  private onError: SensorErrorListener | null = null;
  private pendingResponse: PendingResponse | null = null;
  private monitoredCharacteristicCount = 0;
  private acceptedCommandCount = 0;
  private decodedBatchCount = 0;
  private decodedVectorCount = 0;
  private rejectedPacketCount = 0;
  private rejectionCounts: Partial<Record<StevalPacketDecodeErrorCode, number>> = {};
  private unknownSensorIdCount = 0;
  private queueResynchronizationCount = 0;
  private droppedBatchCount = 0;
  private emittedSampleCount = 0;
  private completedPairCount = 0;
  private firstPairReceivedTimeMs: number | undefined;
  private lastPairReceivedTimeMs: number | undefined;
  private largestPairInterarrivalGapMs = 0;

  constructor(
    private readonly client: BluetoothClient,
    options: StevalMkboxProSensorSourceOptions = {},
  ) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? 3_000;
    this.writePacingMs = options.writePacingMs ?? 20;
    this.synchronizer = new StevalImuSynchronizer({
      maximumQueuedBatches: options.maximumQueuedBatches,
    });
  }

  async start(onSample: SensorSampleListener, onError: SensorErrorListener): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start the SensorTile source while it is ${this.state}.`);
    }

    this.resetSession();
    this.onSample = onSample;
    this.onError = onError;
    this.state = 'starting';

    try {
      this.monitoredCharacteristicCount = await this.client.monitorCharacteristics(
        [
          {
            serviceUuid: PROFILE.serviceUuid,
            characteristicUuid: PROFILE.pnplCharacteristicUuid,
          },
          {
            serviceUuid: PROFILE.serviceUuid,
            characteristicUuid: PROFILE.rawStreamCharacteristicUuid,
          },
        ],
        (packet) => this.handlePacket(packet),
        (error) => this.handleMonitorError(error),
      );

      // A drive that ended without stop_log (app reload, crash, lost connection) leaves the board
      // logging, and DATALOG2 rejects start_log while a log is running. Stop any leftover log
      // first; the board may reject this when nothing is running, which is fine.
      for (const command of stopImuStreamCommands()) {
        await this.sendCommand(command).catch(() => undefined);
      }
      for (const command of startImuStreamCommands()) {
        await this.sendCommand(command);
        this.acceptedCommandCount++;
      }
      this.state = 'running';
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.onError?.(error);
      await this.cleanupAfterFailedStart();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'idle') return;
    if (this.state === 'stopping') return;
    if (this.state === 'starting') {
      throw new Error('Cannot stop the SensorTile source while startup is in progress.');
    }

    this.state = 'stopping';
    let stopError: Error | null = null;
    try {
      for (const command of stopImuStreamCommands()) {
        await this.sendCommand(command);
      }
    } catch (cause) {
      stopError = cause instanceof Error ? cause : new Error(String(cause));
      this.onError?.(stopError);
    } finally {
      this.rejectPendingResponse(new Error('SensorTile monitoring stopped.'));
      await this.client.stopMonitoring();
      this.synchronizer.reset();
      this.state = 'idle';
      this.onSample = null;
      this.onError = null;
      this.monitoredCharacteristicCount = 0;
    }

    if (stopError) throw stopError;
  }

  getDiagnostics(): StevalSourceDiagnostics {
    const queues = this.synchronizer.getQueueDepths();
    const durationMs =
      this.firstPairReceivedTimeMs === undefined || this.lastPairReceivedTimeMs === undefined
        ? 0
        : this.lastPairReceivedTimeMs - this.firstPairReceivedTimeMs;
    return Object.freeze({
      state: this.state,
      monitoredCharacteristicCount: this.monitoredCharacteristicCount,
      acceptedCommandCount: this.acceptedCommandCount,
      decodedBatchCount: this.decodedBatchCount,
      decodedVectorCount: this.decodedVectorCount,
      rejectedPacketCount: this.rejectedPacketCount,
      rejectionCounts: Object.freeze({ ...this.rejectionCounts }),
      unknownSensorIdCount: this.unknownSensorIdCount,
      queueResynchronizationCount: this.queueResynchronizationCount,
      droppedBatchCount: this.droppedBatchCount,
      emittedSampleCount: this.emittedSampleCount,
      estimatedSampleRateHz:
        durationMs > 0
          ? ((this.completedPairCount - 1) * PROFILE.samplesPerPacket * 1_000) / durationMs
          : 0,
      largestPairInterarrivalGapMs: this.largestPairInterarrivalGapMs,
      accelerometerQueueDepth: queues.accelerometer,
      gyroscopeQueueDepth: queues.gyroscope,
    });
  }

  private handlePacket(packet: RawBlePacket): void {
    const characteristicUuid = packet.characteristicUuid.toLowerCase();
    if (characteristicUuid === PROFILE.pnplCharacteristicUuid) {
      this.handlePnplPacket(base64ToBytes(packet.valueBase64));
      return;
    }
    if (characteristicUuid !== PROFILE.rawStreamCharacteristicUuid || this.state !== 'running') {
      return;
    }

    try {
      const batch = decodeStevalMkboxProImuPacket(base64ToBytes(packet.valueBase64));
      this.decodedBatchCount++;
      this.decodedVectorCount += batch.vectors.length;
      const result = this.synchronizer.push(batch, packet.receivedMonotonicMs);
      if (result.resynchronized) {
        this.queueResynchronizationCount++;
        this.droppedBatchCount += result.droppedBatchCount;
        this.onError?.(
          new Error(
            `SensorTile streams became imbalanced; dropped ${result.droppedBatchCount} batches and resynchronized.`,
          ),
        );
      }
      if (result.samples.length > 0) {
        this.completedPairCount += result.samples.length / PROFILE.samplesPerPacket;
        this.firstPairReceivedTimeMs ??= packet.receivedMonotonicMs;
        if (this.lastPairReceivedTimeMs !== undefined) {
          this.largestPairInterarrivalGapMs = Math.max(
            this.largestPairInterarrivalGapMs,
            packet.receivedMonotonicMs - this.lastPairReceivedTimeMs,
          );
        }
        this.lastPairReceivedTimeMs = packet.receivedMonotonicMs;
      }
      for (const sample of result.samples) {
        this.emittedSampleCount++;
        this.onSample?.(sample);
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.rejectedPacketCount++;
      if (error instanceof StevalPacketDecodeError) {
        this.rejectionCounts[error.code] = (this.rejectionCounts[error.code] ?? 0) + 1;
        if (error.code === 'unknown_sensor_id') this.unknownSensorIdCount++;
      }
      this.onError?.(error);
    }
  }

  private handlePnplPacket(bytes: Uint8Array): void {
    const response = this.assembler.push(bytes);
    if (!response || !this.pendingResponse) return;

    const pending = this.pendingResponse;
    this.pendingResponse = null;
    clearTimeout(pending.timer);
    try {
      responseSucceeded(response);
      pending.resolve(response);
    } catch (cause) {
      pending.reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  private handleMonitorError(error: Error): void {
    this.rejectPendingResponse(error);
    this.onError?.(error);
  }

  private async sendCommand(command: string): Promise<string> {
    if (this.pendingResponse) {
      throw new Error('A PnPL command is already awaiting a response.');
    }

    const response = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingResponse?.timer === timer) this.pendingResponse = null;
        reject(new Error(`PnPL command timed out after ${this.commandTimeoutMs} ms: ${command}`));
      }, this.commandTimeoutMs);
      this.pendingResponse = { resolve, reject, timer };
    });
    // The timeout can fire while the writes below are still stalled on a dropped link, before
    // anything awaits `response`; mark it observed so that isn't reported as an uncaught rejection.
    // The rejection still reaches the `await response` / catch below.
    response.catch(() => undefined);

    try {
      for (const packet of frameStPnplCommand(command)) {
        await this.client.writeWithoutResponse(
          PROFILE.serviceUuid,
          PROFILE.pnplCharacteristicUuid,
          packet,
        );
        await delay(this.writePacingMs);
      }
      return await response;
    } catch (cause) {
      this.rejectPendingResponse(cause instanceof Error ? cause : new Error(String(cause)));
      await response.catch(() => undefined);
      // Name the command so a rejection on the drive screen says which setting the board refused.
      const message = cause instanceof Error ? cause.message : String(cause);
      throw message.includes(command) ? cause : new Error(`${message} Command: ${command}`);
    }
  }

  private rejectPendingResponse(error: Error): void {
    const pending = this.pendingResponse;
    if (!pending) return;
    this.pendingResponse = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private async cleanupAfterFailedStart(): Promise<void> {
    this.state = 'stopping';
    try {
      for (const command of stopImuStreamCommands()) {
        await this.sendCommand(command);
      }
    } catch {
      // Best effort: startup may have failed before PnPL became usable.
    }
    this.rejectPendingResponse(new Error('SensorTile startup was aborted.'));
    await this.client.stopMonitoring();
    this.synchronizer.reset();
    this.state = 'idle';
    this.onSample = null;
    this.onError = null;
    this.monitoredCharacteristicCount = 0;
  }

  private resetSession(): void {
    this.assembler = new StPnplResponseAssembler();
    this.synchronizer.reset();
    this.monitoredCharacteristicCount = 0;
    this.acceptedCommandCount = 0;
    this.decodedBatchCount = 0;
    this.decodedVectorCount = 0;
    this.rejectedPacketCount = 0;
    this.rejectionCounts = {};
    this.unknownSensorIdCount = 0;
    this.queueResynchronizationCount = 0;
    this.droppedBatchCount = 0;
    this.emittedSampleCount = 0;
    this.completedPairCount = 0;
    this.firstPairReceivedTimeMs = undefined;
    this.lastPairReceivedTimeMs = undefined;
    this.largestPairInterarrivalGapMs = 0;
  }
}
