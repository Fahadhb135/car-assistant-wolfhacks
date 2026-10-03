import type { Vector3 } from '../../core/sensors/types';
import { STEVAL_MKBOXPRO_DATALOG2_V34_PROFILE as PROFILE } from './stevalMkboxProProfile';

export type StevalSensorKind = 'accelerometer' | 'gyroscope';

export type DecodedStevalBatch = Readonly<{
  sensor: StevalSensorKind;
  sensorId: number;
  vectors: readonly Vector3[];
}>;

export type StevalPacketDecodeErrorCode =
  | 'empty_packet'
  | 'unknown_sensor_id'
  | 'unexpected_packet_length'
  | 'incomplete_xyz_sample';

export class StevalPacketDecodeError extends Error {
  constructor(
    readonly code: StevalPacketDecodeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StevalPacketDecodeError';
  }
}

function signedInt16LittleEndian(bytes: Uint8Array, offset: number): number {
  const unsigned = bytes[offset] | (bytes[offset + 1] << 8);
  return unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
}

/** Decodes one strict DATALOG2 v3.4 raw-stream notification. */
export function decodeStevalMkboxProImuPacket(packet: Uint8Array): DecodedStevalBatch {
  if (packet.length === 0) {
    throw new StevalPacketDecodeError('empty_packet', 'The raw IMU packet is empty.');
  }

  const sensorId = packet[0];
  const sensor =
    sensorId === PROFILE.sensors.accelerometer.id
      ? 'accelerometer'
      : sensorId === PROFILE.sensors.gyroscope.id
        ? 'gyroscope'
        : null;
  if (!sensor) {
    throw new StevalPacketDecodeError(
      'unknown_sensor_id',
      `Unknown DATALOG2 sensor ID 0x${sensorId.toString(16).padStart(2, '0')}.`,
    );
  }

  const payloadLength = packet.length - 1;
  if (payloadLength % PROFILE.bytesPerVector !== 0) {
    throw new StevalPacketDecodeError(
      'incomplete_xyz_sample',
      `Raw packet payload has ${payloadLength} bytes; XYZ samples require multiples of ${PROFILE.bytesPerVector}.`,
    );
  }
  if (packet.length !== PROFILE.packetByteLength) {
    throw new StevalPacketDecodeError(
      'unexpected_packet_length',
      `Raw packet has ${packet.length} bytes; expected ${PROFILE.packetByteLength}.`,
    );
  }

  const scale =
    sensor === 'accelerometer'
      ? PROFILE.sensors.accelerometer.scaleGPerLsb
      : PROFILE.sensors.gyroscope.scaleDpsPerLsb;
  const vectors: Vector3[] = [];
  for (let offset = 1; offset < packet.length; offset += PROFILE.bytesPerVector) {
    vectors.push(
      Object.freeze({
        x: signedInt16LittleEndian(packet, offset) * scale,
        y: signedInt16LittleEndian(packet, offset + 2) * scale,
        z: signedInt16LittleEndian(packet, offset + 4) * scale,
      }),
    );
  }

  return Object.freeze({ sensor, sensorId, vectors: Object.freeze(vectors) });
}
