import assert from 'node:assert/strict';
import test from 'node:test';

import { filterByProximity } from './proximity';
import type { BluetoothDeviceSummary } from './types';

function device(id: string, rssi: number | null): BluetoothDeviceSummary {
  return { id, name: null, localName: null, rssi, serviceUuids: [], manufacturerDataBase64: null };
}

const devices = [device('far', -90), device('room', -65), device('unknown', null), device('close', -40)];

test('keeps only devices at or above the RSSI threshold, strongest first', () => {
  assert.deepEqual(filterByProximity(devices, 'nearby').map((d) => d.id), ['close', 'room']);
  assert.deepEqual(filterByProximity(devices, 'veryClose').map((d) => d.id), ['close']);
});

test('all keeps every device and puts unknown RSSI last', () => {
  assert.deepEqual(filterByProximity(devices, 'all').map((d) => d.id), ['close', 'room', 'far', 'unknown']);
});
