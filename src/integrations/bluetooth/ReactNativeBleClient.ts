import {
  BleManager,
  type Device,
  type Subscription,
} from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';

import type { BluetoothClient } from './BluetoothClient';
import { base64ToBytes, bytesToBase64, bytesToHex } from './base64';
import { asError } from './errors';
import type {
  BluetoothDeviceSummary,
  BluetoothErrorListener,
  BluetoothScanListener,
  GattServiceSnapshot,
  RawPacketListener,
} from './types';

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function summarizeDevice(device: Device): BluetoothDeviceSummary {
  return {
    id: device.id,
    name: device.name,
    localName: device.localName,
    rssi: device.rssi,
    serviceUuids: device.serviceUUIDs ?? [],
    manufacturerDataBase64: device.manufacturerData,
  };
}

export class ReactNativeBleClient implements BluetoothClient {
  private readonly manager = new BleManager();
  private connectedDevice: Device | null = null;
  private gattServices: readonly GattServiceSnapshot[] = [];
  private notificationSubscriptions: Subscription[] = [];

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      // iOS presents its system Bluetooth prompt when the manager first uses BLE.
      return true;
    }

    if (Number(Platform.Version) < 31) {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }

    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);

    return (
      result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
        PermissionsAndroid.RESULTS.GRANTED &&
      result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
        PermissionsAndroid.RESULTS.GRANTED
    );
  }

  async startScan(
    onDevice: BluetoothScanListener,
    onError: BluetoothErrorListener,
  ): Promise<void> {
    await this.stopScan();

    await this.manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        onError(asError(error));
        return;
      }

      if (device) {
        onDevice(summarizeDevice(device));
      }
    });
  }

  async stopScan(): Promise<void> {
    await this.manager.stopDeviceScan();
  }

  async connectAndInspect(deviceId: string): Promise<readonly GattServiceSnapshot[]> {
    await this.stopScan();
    await this.disconnect();

    console.info('[BLE connect] connecting', deviceId);
    const connected = await this.manager.connectToDevice(deviceId, { timeout: 10_000 });
    console.info('[BLE connect] connected; discovering services');
    this.connectedDevice = await withTimeout(
      connected.discoverAllServicesAndCharacteristics(),
      15_000,
      'Service discovery timed out after 15 s.',
    );
    console.info('[BLE connect] discovery complete');

    const services = await this.connectedDevice.services();
    this.gattServices = await Promise.all(
      services.map(async (service) => {
        const characteristics = await service.characteristics();
        return {
          uuid: service.uuid,
          characteristics: characteristics.map((characteristic) => ({
            uuid: characteristic.uuid,
            serviceUuid: service.uuid,
            isReadable: characteristic.isReadable,
            isWritableWithResponse: characteristic.isWritableWithResponse,
            isWritableWithoutResponse: characteristic.isWritableWithoutResponse,
            isNotifiable: characteristic.isNotifiable,
            isIndicatable: characteristic.isIndicatable,
          })),
        } satisfies GattServiceSnapshot;
      }),
    );

    return this.gattServices;
  }

  async monitorNotifiableCharacteristics(
    onPacket: RawPacketListener,
    onError: BluetoothErrorListener,
  ): Promise<number> {
    if (!this.connectedDevice) {
      throw new Error('Connect to a Bluetooth device before monitoring notifications.');
    }

    this.removeNotificationSubscriptions();

    for (const service of this.gattServices) {
      for (const characteristic of service.characteristics) {
        if (!characteristic.isNotifiable && !characteristic.isIndicatable) {
          continue;
        }

        const subscription = this.manager.monitorCharacteristicForDevice(
          this.connectedDevice.id,
          service.uuid,
          characteristic.uuid,
          (error, updatedCharacteristic) => {
            if (error) {
              onError(new Error(`${characteristic.uuid}: ${error.message}`));
              return;
            }
            if (!updatedCharacteristic?.value) {
              return;
            }

            const bytes = base64ToBytes(updatedCharacteristic.value);
            onPacket({
              receivedMonotonicMs: monotonicNow(),
              serviceUuid: service.uuid,
              characteristicUuid: characteristic.uuid,
              valueBase64: updatedCharacteristic.value,
              valueHex: bytesToHex(bytes),
              byteLength: bytes.byteLength,
            });
          },
        );

        this.notificationSubscriptions.push(subscription);
      }
    }

    return this.notificationSubscriptions.length;
  }

  async writeWithoutResponse(
    serviceUuid: string,
    characteristicUuid: string,
    value: Uint8Array,
  ): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('Connect to a Bluetooth device before writing.');
    }

    await this.manager.writeCharacteristicWithoutResponseForDevice(
      this.connectedDevice.id,
      serviceUuid,
      characteristicUuid,
      bytesToBase64(value),
    );
  }

  async disconnect(): Promise<void> {
    this.removeNotificationSubscriptions();

    const device = this.connectedDevice;
    this.connectedDevice = null;
    this.gattServices = [];

    if (device && (await this.manager.isDeviceConnected(device.id))) {
      await this.manager.cancelDeviceConnection(device.id);
    }
  }

  async destroy(): Promise<void> {
    await this.stopScan();
    await this.disconnect();
    await this.manager.destroy();
  }

  private removeNotificationSubscriptions(): void {
    for (const subscription of this.notificationSubscriptions) {
      subscription.remove();
    }
    this.notificationSubscriptions = [];
  }
}
