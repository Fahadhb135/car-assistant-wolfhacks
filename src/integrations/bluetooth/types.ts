export type BluetoothDeviceSummary = Readonly<{
  id: string;
  name: string | null;
  localName: string | null;
  rssi: number | null;
  serviceUuids: readonly string[];
  manufacturerDataBase64: string | null;
}>;

export type GattCharacteristicSnapshot = Readonly<{
  uuid: string;
  serviceUuid: string;
  isReadable: boolean;
  isWritableWithResponse: boolean;
  isWritableWithoutResponse: boolean;
  isNotifiable: boolean;
  isIndicatable: boolean;
}>;

export type GattServiceSnapshot = Readonly<{
  uuid: string;
  characteristics: readonly GattCharacteristicSnapshot[];
}>;

export type GattCharacteristicTarget = Readonly<{
  serviceUuid: string;
  characteristicUuid: string;
}>;

export type RawBlePacket = Readonly<{
  receivedMonotonicMs: number;
  serviceUuid: string;
  characteristicUuid: string;
  valueBase64: string;
  valueHex: string;
  byteLength: number;
}>;

export type BluetoothScanListener = (device: BluetoothDeviceSummary) => void;
export type BluetoothErrorListener = (error: Error) => void;
export type RawPacketListener = (packet: RawBlePacket) => void;
