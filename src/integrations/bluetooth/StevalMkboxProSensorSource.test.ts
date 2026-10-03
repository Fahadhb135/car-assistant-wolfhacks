import assert from 'node:assert/strict';
import test from 'node:test';

import { ImuPipeline } from '../../core/imu';
import type { BluetoothClient } from './BluetoothClient';
import { bytesToBase64, bytesToHex } from './base64';
import { StevalMkboxProSensorSource } from './StevalMkboxProSensorSource';
import { STEVAL_MKBOXPRO_DATALOG2_V34_PROFILE as PROFILE } from './stevalMkboxProProfile';
import type {
  BluetoothErrorListener,
  BluetoothScanListener,
  GattCharacteristicTarget,
  GattServiceSnapshot,
  RawBlePacket,
  RawPacketListener,
} from './types';

const encode = (text: string) => new TextEncoder().encode(text);

function rawPacket(sensorId: number, xyz: readonly [number, number, number]): Uint8Array {
  const bytes = new Uint8Array(PROFILE.packetByteLength);
  bytes[0] = sensorId;
  for (let offset = 1; offset < bytes.length; offset += PROFILE.bytesPerVector) {
    for (let axis = 0; axis < 3; axis++) {
      const value = xyz[axis] < 0 ? 0x10000 + xyz[axis] : xyz[axis];
      bytes[offset + axis * 2] = value & 0xff;
      bytes[offset + axis * 2 + 1] = value >> 8;
    }
  }
  return bytes;
}

class FakeBluetoothClient implements BluetoothClient {
  packetListener: RawPacketListener | null = null;
  errorListener: BluetoothErrorListener | null = null;
  targets: readonly GattCharacteristicTarget[] = [];
  writeCount = 0;
  stopMonitoringCount = 0;
  respond = true;
  rejectCommandNumber: number | null = null;
  private completedCommandCount = 0;

  async requestPermissions(): Promise<boolean> { return true; }
  async startScan(_onDevice: BluetoothScanListener, _onError: BluetoothErrorListener): Promise<void> {}
  async stopScan(): Promise<void> {}
  async connectAndInspect(_deviceId: string): Promise<readonly GattServiceSnapshot[]> { return []; }
  async monitorNotifiableCharacteristics(
    onPacket: RawPacketListener,
    onError: BluetoothErrorListener,
  ): Promise<number> {
    return this.monitorCharacteristics([], onPacket, onError);
  }
  async monitorCharacteristics(
    targets: readonly GattCharacteristicTarget[],
    onPacket: RawPacketListener,
    onError: BluetoothErrorListener,
  ): Promise<number> {
    this.targets = targets;
    this.packetListener = onPacket;
    this.errorListener = onError;
    return targets.length;
  }
  async stopMonitoring(): Promise<void> {
    this.stopMonitoringCount++;
    this.packetListener = null;
    this.errorListener = null;
  }
  async writeWithoutResponse(
    _serviceUuid: string,
    _characteristicUuid: string,
    value: Uint8Array,
  ): Promise<void> {
    this.writeCount++;
    if (value[0] !== 0x20 && value[0] !== 0x80) return;
    this.completedCommandCount++;
    if (!this.respond) return;
    const status = this.completedCommandCount !== this.rejectCommandNumber;
    queueMicrotask(() => this.emitPnpl(status));
  }
  async disconnect(): Promise<void> {}
  async destroy(): Promise<void> {}

  emitRaw(bytes: Uint8Array, receivedMonotonicMs: number): void {
    this.packetListener?.(this.packet(PROFILE.rawStreamCharacteristicUuid, bytes, receivedMonotonicMs));
  }

  private emitPnpl(status: boolean): void {
    const response = encode(
      JSON.stringify({ PnPL_Response: { message: status ? '' : 'rejected', status } }),
    );
    const bytes = Uint8Array.of(0x20, ...response);
    this.packetListener?.(this.packet(PROFILE.pnplCharacteristicUuid, bytes, 0));
  }

  private packet(characteristicUuid: string, bytes: Uint8Array, time: number): RawBlePacket {
    return {
      receivedMonotonicMs: time,
      serviceUuid: PROFILE.serviceUuid,
      characteristicUuid,
      valueBase64: bytesToBase64(bytes),
      valueHex: bytesToHex(bytes),
      byteLength: bytes.length,
    };
  }
}

test('starts with targeted subscriptions and drives raw packets through ImuPipeline', async () => {
  const client = new FakeBluetoothClient();
  const source = new StevalMkboxProSensorSource(client, { writePacingMs: 0 });
  const pipeline = new ImuPipeline();
  const samples = [] as Parameters<ImuPipeline['process']>[0][];
  const pipelineResults: ReturnType<ImuPipeline['process']>[] = [];
  const errors: Error[] = [];

  await source.start(
    (sample) => {
      samples.push(sample);
      pipelineResults.push(pipeline.process(sample));
    },
    (error) => errors.push(error),
  );

  assert.deepEqual(client.targets, [
    { serviceUuid: PROFILE.serviceUuid, characteristicUuid: PROFILE.pnplCharacteristicUuid },
    { serviceUuid: PROFILE.serviceUuid, characteristicUuid: PROFILE.rawStreamCharacteristicUuid },
  ]);
  assert.equal(source.getDiagnostics().acceptedCommandCount, 9);
  await assert.rejects(source.start(() => {}, () => {}), /while it is running/i);

  client.emitRaw(rawPacket(0, [0, 0, 2049]), 1_000);
  assert.equal(samples.length, 0);
  client.emitRaw(rawPacket(1, [0, 0, 0]), 1_010);

  assert.equal(samples.length, 40);
  assert.equal(pipelineResults.every((result) => result.accepted), true);
  assert.equal(errors.length, 0);
  assert.ok(Math.abs(samples[0].accelerationG.z - 0.999912) < 1e-12);
  assert.equal(source.getDiagnostics().estimatedSampleRateHz, 0);

  client.emitRaw(rawPacket(0, [0, 0, 2049]), 1_330);
  client.emitRaw(rawPacket(1, [0, 0, 0]), 1_010 + 1_000 / 3);
  assert.equal(samples.length, 80);
  assert.ok(Math.abs(source.getDiagnostics().estimatedSampleRateHz - 120) < 1e-9);
  assert.ok(
    Math.abs(source.getDiagnostics().largestPairInterarrivalGapMs - 1_000 / 3) < 1e-9,
  );

  await source.stop();
  assert.equal(source.getDiagnostics().state, 'idle');
  assert.equal(client.stopMonitoringCount, 1);
  await source.stop();
  assert.equal(client.stopMonitoringCount, 1);
});

test('reports malformed raw packets without emitting samples', async () => {
  const client = new FakeBluetoothClient();
  const source = new StevalMkboxProSensorSource(client, { writePacingMs: 0 });
  const errors: Error[] = [];
  let sampleCount = 0;
  await source.start(() => sampleCount++, (error) => errors.push(error));

  client.emitRaw(Uint8Array.of(0x7f, 1, 2, 3, 4, 5, 6), 1_000);
  assert.equal(sampleCount, 0);
  assert.equal(errors.length, 1);
  assert.equal(source.getDiagnostics().unknownSensorIdCount, 1);
  assert.equal(source.getDiagnostics().rejectedPacketCount, 1);
  await source.stop();
});

test('aborts rejected startup and performs best-effort cleanup', async () => {
  const client = new FakeBluetoothClient();
  client.rejectCommandNumber = 2;
  const source = new StevalMkboxProSensorSource(client, { writePacingMs: 0 });
  const errors: Error[] = [];

  await assert.rejects(source.start(() => {}, (error) => errors.push(error)), /rejected/i);
  assert.equal(source.getDiagnostics().state, 'idle');
  assert.equal(client.stopMonitoringCount, 1);
  assert.equal(errors.length, 1);
});

test('times out startup when the board does not acknowledge commands', async () => {
  const client = new FakeBluetoothClient();
  client.respond = false;
  const source = new StevalMkboxProSensorSource(client, {
    commandTimeoutMs: 5,
    writePacingMs: 0,
  });

  await assert.rejects(source.start(() => {}, () => {}), /timed out/i);
  assert.equal(source.getDiagnostics().state, 'idle');
  assert.equal(client.stopMonitoringCount, 1);
});
