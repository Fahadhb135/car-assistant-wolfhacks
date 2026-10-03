import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeStevalMkboxProImuPacket,
  StevalPacketDecodeError,
} from './stevalMkboxProDecoder';
import { STEVAL_MKBOXPRO_DATALOG2_V34_PROFILE as PROFILE } from './stevalMkboxProProfile';

function setInt16LittleEndian(packet: Uint8Array, offset: number, value: number): void {
  const unsigned = value < 0 ? 0x10000 + value : value;
  packet[offset] = unsigned & 0xff;
  packet[offset + 1] = unsigned >> 8;
}

function packet(sensorId: number, xyz: readonly [number, number, number] = [0, 0, 0]): Uint8Array {
  const bytes = new Uint8Array(PROFILE.packetByteLength);
  bytes[0] = sensorId;
  for (let offset = 1; offset < bytes.length; offset += PROFILE.bytesPerVector) {
    setInt16LittleEndian(bytes, offset, xyz[0]);
    setInt16LittleEndian(bytes, offset + 2, xyz[1]);
    setInt16LittleEndian(bytes, offset + 4, xyz[2]);
  }
  return bytes;
}

function expectCode(bytes: Uint8Array, code: string): void {
  assert.throws(
    () => decodeStevalMkboxProImuPacket(bytes),
    (error: unknown) => error instanceof StevalPacketDecodeError && error.code === code,
  );
}

test('decodes 40 signed accelerometer vectors and scales them to g', () => {
  const decoded = decodeStevalMkboxProImuPacket(packet(0x00, [1, -2, 32767]));
  assert.equal(decoded.sensor, 'accelerometer');
  assert.equal(decoded.vectors.length, 40);
  assert.deepEqual(decoded.vectors[0], {
    x: 0.000488,
    y: -0.000976,
    z: 32767 * 0.000488,
  });
});

test('decodes signed gyroscope vectors and scales them to dps', () => {
  const decoded = decodeStevalMkboxProImuPacket(packet(0x01, [-32768, 100, -100]));
  assert.equal(decoded.sensor, 'gyroscope');
  assert.equal(decoded.vectors[0].x, -32768 * 0.035);
  assert.ok(Math.abs(decoded.vectors[0].y - 3.5) < 1e-12);
  assert.ok(Math.abs(decoded.vectors[0].z + 3.5) < 1e-12);
});

test('rejects empty, unknown, truncated, misaligned, and oversized packets', () => {
  expectCode(new Uint8Array(), 'empty_packet');
  expectCode(packet(0x7f), 'unknown_sensor_id');
  expectCode(new Uint8Array(235), 'unexpected_packet_length');
  expectCode(new Uint8Array(240), 'incomplete_xyz_sample');
  expectCode(new Uint8Array(247), 'unexpected_packet_length');
});
