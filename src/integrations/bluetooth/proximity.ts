import type { BluetoothDeviceSummary } from './types';

export type ProximityFilter = 'veryClose' | 'nearby' | 'all';

// BLE has no distance reading; RSSI (dBm) is the proxy. Thresholds are rough:
// about arm's length for -55 and about the same room for -70.
export const PROXIMITY_MIN_RSSI: Record<ProximityFilter, number | null> = {
  veryClose: -55,
  nearby: -70,
  all: null,
};

export function filterByProximity(
  devices: readonly BluetoothDeviceSummary[],
  filter: ProximityFilter,
): BluetoothDeviceSummary[] {
  const minRssi = PROXIMITY_MIN_RSSI[filter];
  return devices
    .filter((device) => minRssi === null || (device.rssi !== null && device.rssi >= minRssi))
    .sort((left, right) => (right.rssi ?? -Infinity) - (left.rssi ?? -Infinity));
}
