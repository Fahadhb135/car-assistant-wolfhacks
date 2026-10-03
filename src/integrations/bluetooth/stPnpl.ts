// ST DATALOG2 ("HSD2") BLE protocol, as implemented in
// github.com/STMicroelectronics/fp-sns-datalog2 (STM32_BLE_Manager and the
// SensorTile.boxPro DATALOG2 application).
//
// - PnPL JSON commands are written to the PnPL characteristic and answered
//   with notifications on the same characteristic.
// - Sensor data arrives on the raw PnPL-controlled characteristic, but only
//   while it is subscribed, the sensor's st_ble_stream is enabled, and a log
//   is running. DATALOG2 starts the BLE stream as part of starting the SD-card
//   log, so the board needs an SD card.

export const ST_FEATURE_SERVICE_UUID = '00000000-0001-11e1-9ab4-0002a5d5c51b';
export const ST_PNPL_CHARACTERISTIC_UUID = '0000001b-0002-11e1-ac36-0002a5d5c51b';
export const ST_RAW_STREAM_CHARACTERISTIC_UUID = '00000023-0002-11e1-ac36-0002a5d5c51b';

// Packet-type header bytes (ble_comm_tp_packet_t in BLE_Manager.h).
const START = 0x00;
const START_END = 0x20;
const MIDDLE = 0x40;
const END = 0x80;

/**
 * Splits a command into BLE writes. Phone-to-board start packets carry the
 * total length as two big-endian bytes after the header; later packets carry
 * only the header.
 */
export function frameStPnplCommand(json: string, packetSize = 20): Uint8Array[] {
  const payload = utf8Encode(json);
  if (payload.length > 0xffff) {
    throw new Error('PnPL command is too long for a 16-bit length header.');
  }

  const lengthHigh = payload.length >> 8;
  const lengthLow = payload.length & 0xff;
  const firstChunkSize = packetSize - 3;

  if (payload.length <= firstChunkSize) {
    return [Uint8Array.of(START_END, lengthHigh, lengthLow, ...payload)];
  }

  const packets = [Uint8Array.of(START, lengthHigh, lengthLow, ...payload.subarray(0, firstChunkSize))];
  for (let offset = firstChunkSize; offset < payload.length; offset += packetSize - 1) {
    const chunk = payload.subarray(offset, offset + packetSize - 1);
    const isLast = offset + packetSize - 1 >= payload.length;
    packets.push(Uint8Array.of(isLast ? END : MIDDLE, ...chunk));
  }
  return packets;
}

/**
 * Reassembles board-to-phone PnPL notifications. These use a one-byte header
 * with no length field (ble_command_tp_encapsulate).
 */
export class StPnplResponseAssembler {
  private chunks: Uint8Array[] = [];

  /** Returns the complete message once its last packet arrives, otherwise null. */
  push(packet: Uint8Array): string | null {
    if (packet.length === 0) {
      return null;
    }

    const header = packet[0];
    const body = packet.subarray(1);

    if (header === START_END) {
      this.chunks = [];
      return decode([body]);
    }
    if (header === START) {
      this.chunks = [body];
      return null;
    }
    if (header === MIDDLE && this.chunks.length > 0) {
      this.chunks.push(body);
      return null;
    }
    if (header === END && this.chunks.length > 0) {
      const message = decode([...this.chunks, body]);
      this.chunks = [];
      return message;
    }
    return null;
  }
}

function decode(chunks: readonly Uint8Array[]): string {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return utf8Decode(joined);
}

// Hermes does not reliably provide TextEncoder/TextDecoder, so convert via
// percent-encoding, which handles any UTF-8 text.
function utf8Encode(text: string): Uint8Array {
  const escaped = encodeURIComponent(text);
  const bytes: number[] = [];
  for (let index = 0; index < escaped.length; index++) {
    if (escaped[index] === '%') {
      bytes.push(parseInt(escaped.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(escaped.charCodeAt(index));
    }
  }
  return Uint8Array.from(bytes);
}

function utf8Decode(bytes: Uint8Array): string {
  let escaped = '';
  for (const byte of bytes) {
    escaped += `%${byte.toString(16).padStart(2, '0')}`;
  }
  try {
    return decodeURIComponent(escaped);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

// Enum indices from Lsm6dsv16x_{Acc,Gyro}_PnPL.h.
const ODR_120_HZ = 4;
const ACC_FS_16_G = 3;
const GYRO_FS_1000_DPS = 3;

/** Commands that make DATALOG2 stream LSM6DSV16X accelerometer and gyroscope data at 120 Hz. */
export function startImuStreamCommands(): string[] {
  return [
    JSON.stringify({ lsm6dsv16x_acc: { enable: true } }),
    JSON.stringify({ lsm6dsv16x_acc: { odr: ODR_120_HZ } }),
    JSON.stringify({ lsm6dsv16x_acc: { fs: ACC_FS_16_G } }),
    JSON.stringify({ lsm6dsv16x_acc: { st_ble_stream: { acc: { enable: true } } } }),
    JSON.stringify({ lsm6dsv16x_gyro: { enable: true } }),
    JSON.stringify({ lsm6dsv16x_gyro: { odr: ODR_120_HZ } }),
    JSON.stringify({ lsm6dsv16x_gyro: { fs: GYRO_FS_1000_DPS } }),
    JSON.stringify({ lsm6dsv16x_gyro: { st_ble_stream: { gyro: { enable: true } } } }),
    JSON.stringify({ 'log_controller*start_log': { interface: 0 } }),
  ];
}

export function stopImuStreamCommands(): string[] {
  return [JSON.stringify({ 'log_controller*stop_log': { interface: 0 } })];
}

/** A raw-stream notification is one sensor-ID byte followed by whole samples. */
export function parseRawStreamPacket(packet: Uint8Array): { sensorId: number; samples: Uint8Array } | null {
  return packet.length < 2 ? null : { sensorId: packet[0], samples: packet.subarray(1) };
}
