import type {
  BluetoothDeviceSummary,
  BluetoothErrorListener,
  BluetoothScanListener,
  GattServiceSnapshot,
  RawPacketListener,
} from './types';

/** Native BLE boundary. Keeping it small lets unit tests supply a fake client. */
export interface BluetoothClient {
  requestPermissions(): Promise<boolean>;
  startScan(onDevice: BluetoothScanListener, onError: BluetoothErrorListener): Promise<void>;
  stopScan(): Promise<void>;
  connectAndInspect(deviceId: string): Promise<readonly GattServiceSnapshot[]>;
  monitorNotifiableCharacteristics(
    onPacket: RawPacketListener,
    onError: BluetoothErrorListener,
  ): Promise<number>;
  writeWithoutResponse(serviceUuid: string, characteristicUuid: string, value: Uint8Array): Promise<void>;
  disconnect(): Promise<void>;
  destroy(): Promise<void>;
}

export type { BluetoothDeviceSummary, GattServiceSnapshot };
