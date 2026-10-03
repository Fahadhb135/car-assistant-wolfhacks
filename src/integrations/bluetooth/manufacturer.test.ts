import assert from 'node:assert/strict';
import test from 'node:test';

import { isStMicroelectronicsDevice, manufacturerCompanyId } from './manufacturer';
import type { BluetoothDeviceSummary } from './types';

function device(manufacturerDataBase64: string | null): BluetoothDeviceSummary {
  return { id: 'x', name: null, localName: null, rssi: -50, serviceUuids: [], manufacturerDataBase64 };
}

test('reads the little-endian company ID from manufacturer data', () => {
  // 30 00 02 05 -> STMicroelectronics (0x0030)
  assert.equal(manufacturerCompanyId(device('MAACBQ==')), 0x0030);
  // 4c 00 -> Apple (0x004c)
  assert.equal(manufacturerCompanyId(device('TAA=')), 0x004c);
});

test('recognizes STMicroelectronics devices only', () => {
  assert.equal(isStMicroelectronicsDevice(device('MAACBQ==')), true);
  assert.equal(isStMicroelectronicsDevice(device('TAA=')), false);
  assert.equal(isStMicroelectronicsDevice(device(null)), false);
  assert.equal(isStMicroelectronicsDevice(device('MA==')), false);
});
