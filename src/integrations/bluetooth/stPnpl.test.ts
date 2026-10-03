import assert from 'node:assert/strict';
import test from 'node:test';

import { bytesToHex } from './base64';
import {
  frameStPnplCommand,
  parseRawStreamPacket,
  startImuStreamCommands,
  StPnplResponseAssembler,
} from './stPnpl';

const encode = (text: string) => new TextEncoder().encode(text);

test('frames a short command as one start-end packet with a big-endian length', () => {
  const [packet, ...rest] = frameStPnplCommand('{"a":1}');
  assert.equal(rest.length, 0);
  assert.equal(bytesToHex(packet.subarray(0, 3)), '20 00 07');
  assert.equal(new TextDecoder().decode(packet.subarray(3)), '{"a":1}');
});

test('matches the 41-byte example from ST community', () => {
  // {"stts22h_temp":{"enable":true, "odr":1}}
  const packets = frameStPnplCommand('{"stts22h_temp":{"enable":true, "odr":1}}');
  assert.deepEqual(packets.map(bytesToHex), [
    '00 00 29 7b 22 73 74 74 73 32 32 68 5f 74 65 6d 70 22 3a 7b',
    '40 22 65 6e 61 62 6c 65 22 3a 74 72 75 65 2c 20 22 6f 64 72',
    '80 22 3a 31 7d 7d',
  ]);
});

test('every packet fits the requested packet size', () => {
  for (const command of startImuStreamCommands()) {
    for (const packet of frameStPnplCommand(command, 20)) {
      assert.ok(packet.length <= 20);
    }
  }
});

test('reassembles board responses that have no length field', () => {
  const assembler = new StPnplResponseAssembler();
  assert.equal(assembler.push(Uint8Array.of(0x00, ...encode('{"PnPL_'))), null);
  assert.equal(assembler.push(Uint8Array.of(0x40, ...encode('Response":'))), null);
  assert.equal(assembler.push(Uint8Array.of(0x80, ...encode('{}}'))), '{"PnPL_Response":{}}');
  assert.equal(assembler.push(Uint8Array.of(0x20, ...encode('{"ok":true}'))), '{"ok":true}');
});

test('strips the NUL terminator the firmware appends to responses', () => {
  const assembler = new StPnplResponseAssembler();
  const response = assembler.push(Uint8Array.of(0x20, ...encode('{"PnPL_Response":{"status":true}}'), 0x00));
  assert.equal(response, '{"PnPL_Response":{"status":true}}');
  assert.doesNotThrow(() => JSON.parse(response ?? ''));
});

test('ignores continuation packets without a start', () => {
  const assembler = new StPnplResponseAssembler();
  assert.equal(assembler.push(Uint8Array.of(0x80, ...encode('}'))), null);
});

test('splits a raw stream packet into sensor ID and samples', () => {
  const parsed = parseRawStreamPacket(Uint8Array.of(3, 1, 2, 3, 4, 5, 6));
  assert.equal(parsed?.sensorId, 3);
  assert.equal(parsed?.samples.length, 6);
  assert.equal(parseRawStreamPacket(Uint8Array.of(3)), null);
});
