import assert from 'node:assert/strict';
import test from 'node:test';

import type { Vector3 } from '../../core/sensors/types';
import type { DecodedStevalBatch, StevalSensorKind } from './stevalMkboxProDecoder';
import { StevalImuSynchronizer } from './StevalImuSynchronizer';

function batch(sensor: StevalSensorKind, base: number): DecodedStevalBatch {
  const vectors: Vector3[] = Array.from({ length: 40 }, (_, index) =>
    Object.freeze({ x: base + index, y: base + index + 1, z: base + index + 2 }),
  );
  return Object.freeze({
    sensor,
    sensorId: sensor === 'accelerometer' ? 0 : 1,
    vectors: Object.freeze(vectors),
  });
}

test('waits for both sensors and pairs batches in either arrival order', () => {
  for (const accelerationFirst of [true, false]) {
    const synchronizer = new StevalImuSynchronizer();
    const first = accelerationFirst ? batch('accelerometer', 10) : batch('gyroscope', 100);
    const second = accelerationFirst ? batch('gyroscope', 100) : batch('accelerometer', 10);

    assert.equal(synchronizer.push(first, 1_000).samples.length, 0);
    const result = synchronizer.push(second, 1_010);
    assert.equal(result.samples.length, 40);
    assert.deepEqual(result.samples[0].accelerationG, { x: 10, y: 11, z: 12 });
    assert.deepEqual(result.samples[0].angularVelocityDps, { x: 100, y: 101, z: 102 });
    assert.equal(result.samples[0].sequence, 0);
    assert.equal(result.samples[39].sequence, 39);
    assert.ok(Math.abs(result.samples[39].receivedMonotonicMs - 1_010) < 1e-9);
    assert.ok(
      Math.abs(
        result.samples[1].receivedMonotonicMs -
          result.samples[0].receivedMonotonicMs -
          1_000 / 120,
      ) < 1e-9,
    );
  }
});

test('continues a monotonic synthetic 120 Hz clock across packet jitter', () => {
  const synchronizer = new StevalImuSynchronizer();
  synchronizer.push(batch('accelerometer', 0), 1_000);
  const first = synchronizer.push(batch('gyroscope', 0), 1_020).samples;
  synchronizer.push(batch('gyroscope', 40), 1_100);
  const second = synchronizer.push(batch('accelerometer', 40), 1_500).samples;

  assert.equal(second[0].sequence, 40);
  assert.ok(
    Math.abs(second[0].receivedMonotonicMs - first[39].receivedMonotonicMs - 1_000 / 120) <
      1e-9,
  );
});

test('bounds imbalanced queues and deterministically resynchronizes', () => {
  const synchronizer = new StevalImuSynchronizer({ maximumQueuedBatches: 1 });
  assert.equal(synchronizer.push(batch('accelerometer', 0), 100).resynchronized, false);
  const overflow = synchronizer.push(batch('accelerometer', 40), 200);
  assert.equal(overflow.resynchronized, true);
  assert.equal(overflow.droppedBatchCount, 2);
  assert.deepEqual(synchronizer.getQueueDepths(), { accelerometer: 0, gyroscope: 0 });

  assert.equal(synchronizer.push(batch('gyroscope', 0), 300).samples.length, 0);
  assert.equal(synchronizer.push(batch('accelerometer', 0), 310).samples.length, 40);
});
