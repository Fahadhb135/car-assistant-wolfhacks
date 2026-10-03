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
  monitorNotifiableCharacteristics(onPacket: RawPacketListener): Promise<number>;
  disconnect(): Promise<void>;
  destroy(): Promise<void>;
}

export type { BluetoothDeviceSummary, GattServiceSnapshot };
