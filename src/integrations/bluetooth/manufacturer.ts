import { base64ToBytes, bytesToHex } from './base64';
import type { BluetoothDeviceSummary } from './types';

// Bluetooth SIG company identifier for STMicroelectronics. Manufacturer data
// starts with the company ID as two little-endian bytes.
export const ST_COMPANY_ID = 0x0030;

export function manufacturerCompanyId(device: BluetoothDeviceSummary): number | null {
  if (!device.manufacturerDataBase64) {
    return null;
  }
  const bytes = base64ToBytes(device.manufacturerDataBase64);
  return bytes.length < 2 ? null : bytes[0] | (bytes[1] << 8);
}

export function isStMicroelectronicsDevice(device: BluetoothDeviceSummary): boolean {
  return manufacturerCompanyId(device) === ST_COMPANY_ID;
}

export function manufacturerDataHex(device: BluetoothDeviceSummary): string | null {
  return device.manufacturerDataBase64 ? bytesToHex(base64ToBytes(device.manufacturerDataBase64)) : null;
}
