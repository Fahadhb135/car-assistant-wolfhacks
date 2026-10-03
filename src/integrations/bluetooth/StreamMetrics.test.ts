import assert from 'node:assert/strict';
import test from 'node:test';

import { StreamMetrics } from './StreamMetrics';
import type { RawBlePacket } from './types';

function packet(receivedMonotonicMs: number, byteLength: number): RawBlePacket {
  return {
    receivedMonotonicMs,
    serviceUuid: 'service',
    characteristicUuid: 'characteristic',
    valueBase64: '',
    valueHex: '',
    byteLength,
  };
}

test('reports packet throughput, bytes, and the largest interarrival gap', () => {
  const metrics = new StreamMetrics();
  metrics.reset(2, 1_000);
  metrics.record(packet(1_100, 8));
  metrics.record(packet(1_140, 12));
  metrics.record(packet(1_250, 4));

  assert.deepEqual(metrics.snapshot(2_000), {
    packetCount: 3,
    byteCount: 24,
    packetsPerSecond: 3,
    largestInterarrivalGapMs: 110,
    monitoredCharacteristicCount: 2,
  });
});

test('reset clears metrics from an earlier stream', () => {
  const metrics = new StreamMetrics();
  metrics.reset(1, 0);
  metrics.record(packet(10, 5));
  metrics.reset(0, 100);
  metrics.setMonitoredCharacteristicCount(3);

  assert.deepEqual(metrics.snapshot(1_100), {
    packetCount: 0,
    byteCount: 0,
    packetsPerSecond: 0,
    largestInterarrivalGapMs: 0,
    monitoredCharacteristicCount: 3,
  });
});
