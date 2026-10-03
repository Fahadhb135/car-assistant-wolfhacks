export const STEVAL_MKBOXPRO_DATALOG2_V34_PROFILE = Object.freeze({
  id: 'steval-mkboxpro-datalog2-v3.4',
  advertisedName: 'HSD2v34',
  serviceUuid: '00000000-0001-11e1-9ab4-0002a5d5c51b',
  pnplCharacteristicUuid: '0000001b-0002-11e1-ac36-0002a5d5c51b',
  rawStreamCharacteristicUuid: '00000023-0002-11e1-ac36-0002a5d5c51b',
  sampleRateHz: 120,
  samplesPerPacket: 40,
  bytesPerVector: 6,
  packetByteLength: 241,
  sensors: Object.freeze({
    accelerometer: Object.freeze({
      id: 0x00,
      fullScaleG: 16,
      scaleGPerLsb: 0.000488,
      odrIndex: 4,
      fullScaleIndex: 3,
    }),
    gyroscope: Object.freeze({
      id: 0x01,
      fullScaleDps: 1_000,
      scaleDpsPerLsb: 0.035,
      odrIndex: 4,
      fullScaleIndex: 3,
    }),
  }),
} as const);

export const ST_FEATURE_SERVICE_UUID = STEVAL_MKBOXPRO_DATALOG2_V34_PROFILE.serviceUuid;
export const ST_PNPL_CHARACTERISTIC_UUID =
  STEVAL_MKBOXPRO_DATALOG2_V34_PROFILE.pnplCharacteristicUuid;
export const ST_RAW_STREAM_CHARACTERISTIC_UUID =
  STEVAL_MKBOXPRO_DATALOG2_V34_PROFILE.rawStreamCharacteristicUuid;
