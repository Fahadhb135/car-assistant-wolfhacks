import { toByteArray } from 'base64-js';

export function base64ToBytes(value: string): Uint8Array {
  return toByteArray(value);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

export function base64ToHex(value: string): string {
  return bytesToHex(base64ToBytes(value));
}
