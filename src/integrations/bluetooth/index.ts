export type { BluetoothClient } from './BluetoothClient';
export { isStMicroelectronicsDevice, manufacturerDataHex } from './manufacturer';
export { filterByProximity, PROXIMITY_MIN_RSSI, type ProximityFilter } from './proximity';
export { ReactNativeBleClient } from './ReactNativeBleClient';
export { StreamMetrics } from './StreamMetrics';
export type {
  BluetoothDeviceSummary,
  GattCharacteristicSnapshot,
  GattServiceSnapshot,
  RawBlePacket,
} from './types';
