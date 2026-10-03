import assert from 'node:assert/strict';
import test from 'node:test';

import { base64ToBytes, base64ToHex, bytesToHex } from './base64';

test('decodes BLE characteristic Base64 values', () => {
  assert.deepEqual(Array.from(base64ToBytes('AP+AQQ==')), [0x00, 0xff, 0x80, 0x41]);
  assert.equal(base64ToHex('AP+AQQ=='), '00 ff 80 41');
});

test('formats each byte as two hexadecimal digits', () => {
  assert.equal(bytesToHex(Uint8Array.from([0, 1, 15, 16, 255])), '00 01 0f 10 ff');
});
