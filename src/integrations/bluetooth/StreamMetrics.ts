import type { RawBlePacket } from './types';

export type StreamMetricsSnapshot = Readonly<{
  packetCount: number;
  byteCount: number;
  packetsPerSecond: number;
  largestInterarrivalGapMs: number;
  monitoredCharacteristicCount: number;
}>;

export class StreamMetrics {
  private startedAtMs = 0;
  private lastPacketAtMs: number | null = null;
  private packetCount = 0;
  private byteCount = 0;
  private largestInterarrivalGapMs = 0;
  private monitoredCharacteristicCount = 0;

  reset(monitoredCharacteristicCount = 0, nowMs = performance.now()): void {
    this.startedAtMs = nowMs;
    this.lastPacketAtMs = null;
    this.packetCount = 0;
    this.byteCount = 0;
    this.largestInterarrivalGapMs = 0;
    this.monitoredCharacteristicCount = monitoredCharacteristicCount;
  }

  setMonitoredCharacteristicCount(count: number): void {
    this.monitoredCharacteristicCount = count;
  }

  record(packet: RawBlePacket): void {
    if (this.lastPacketAtMs !== null) {
      this.largestInterarrivalGapMs = Math.max(
        this.largestInterarrivalGapMs,
        packet.receivedMonotonicMs - this.lastPacketAtMs,
      );
    }

    this.lastPacketAtMs = packet.receivedMonotonicMs;
    this.packetCount += 1;
    this.byteCount += packet.byteLength;
  }

  snapshot(nowMs = performance.now()): StreamMetricsSnapshot {
    const elapsedSeconds = Math.max((nowMs - this.startedAtMs) / 1_000, 0.001);
    return {
      packetCount: this.packetCount,
      byteCount: this.byteCount,
      packetsPerSecond: this.packetCount / elapsedSeconds,
      largestInterarrivalGapMs: this.largestInterarrivalGapMs,
      monitoredCharacteristicCount: this.monitoredCharacteristicCount,
    };
  }
}
