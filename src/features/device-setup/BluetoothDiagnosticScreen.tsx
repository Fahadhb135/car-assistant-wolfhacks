import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ReactNativeBleClient,
  StreamMetrics,
  type BluetoothDeviceSummary,
  type GattServiceSnapshot,
  type RawBlePacket,
} from '@/integrations/bluetooth';
import type { StreamMetricsSnapshot } from '@/integrations/bluetooth/StreamMetrics';

const EMPTY_METRICS: StreamMetricsSnapshot = {
  packetCount: 0,
  byteCount: 0,
  packetsPerSecond: 0,
  largestInterarrivalGapMs: 0,
  monitoredCharacteristicCount: 0,
};

export function BluetoothDiagnosticScreen() {
  const clientRef = useRef<ReactNativeBleClient | null>(null);
  const metricsRef = useRef(new StreamMetrics());
  const packetPreviewRef = useRef<RawBlePacket[]>([]);

  const [status, setStatus] = useState('Ready to scan');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Record<string, BluetoothDeviceSummary>>({});
  const [selectedDevice, setSelectedDevice] = useState<BluetoothDeviceSummary | null>(null);
  const [services, setServices] = useState<readonly GattServiceSnapshot[]>([]);
  const [packets, setPackets] = useState<readonly RawBlePacket[]>([]);
  const [metrics, setMetrics] = useState<StreamMetricsSnapshot>(EMPTY_METRICS);
  const [busy, setBusy] = useState(false);

  if (!clientRef.current && Platform.OS !== 'web') {
    clientRef.current = new ReactNativeBleClient();
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setMetrics(metricsRef.current.snapshot());
      setPackets([...packetPreviewRef.current]);
    }, 1_000);

    return () => {
      clearInterval(timer);
      void clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, []);

  const sortedDevices = useMemo(
    () =>
      Object.values(devices).sort((left, right) => {
        const leftName = left.localName ?? left.name ?? '';
        const rightName = right.localName ?? right.name ?? '';
        return leftName.localeCompare(rightName);
      }),
    [devices],
  );

  async function startScan() {
    if (!clientRef.current) {
      setError('Bluetooth diagnostics require an iOS or Android development build.');
      return;
    }

    setError(null);
    setDevices({});
    setServices([]);
    setSelectedDevice(null);
    setStatus('Requesting Bluetooth permission…');

    try {
      const granted = await clientRef.current.requestPermissions();
      if (!granted) {
        setError('Bluetooth permission was denied.');
        setStatus('Permission denied');
        return;
      }

      setStatus('Scanning for BLE devices…');
      await clientRef.current.startScan(
        (device) => {
          setDevices((current) => ({ ...current, [device.id]: device }));
        },
        (scanError) => {
          setError(scanError.message);
          setStatus('Scan failed');
        },
      );
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
      setStatus('Scan failed');
    }
  }

  async function stopScan() {
    await clientRef.current?.stopScan();
    setStatus('Scan stopped');
  }

  async function connect(device: BluetoothDeviceSummary) {
    if (!clientRef.current) {
      return;
    }

    setBusy(true);
    setError(null);
    setSelectedDevice(device);
    setServices([]);
    setStatus(`Connecting to ${device.localName ?? device.name ?? device.id}…`);

    try {
      const discoveredServices = await clientRef.current.connectAndInspect(device.id);
      setServices(discoveredServices);
      setStatus(`Connected; discovered ${discoveredServices.length} services`);
      console.info('[BLE GATT snapshot]', JSON.stringify(discoveredServices, null, 2));
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : String(connectionError));
      setStatus('Connection failed');
    } finally {
      setBusy(false);
    }
  }

  async function monitorNotifications() {
    if (!clientRef.current) {
      return;
    }

    setBusy(true);
    setError(null);
    packetPreviewRef.current = [];
    setPackets([]);

    try {
      metricsRef.current.reset();
      const monitoredCount = await clientRef.current.monitorNotifiableCharacteristics((packet) => {
        metricsRef.current.record(packet);
        if (packetPreviewRef.current.length < 20) {
          packetPreviewRef.current.push(packet);
          console.info('[BLE packet]', JSON.stringify(packet));
        }
      });

      metricsRef.current.setMonitoredCharacteristicCount(monitoredCount);
      setStatus(`Monitoring ${monitoredCount} notifiable characteristics`);
    } catch (monitorError) {
      setError(monitorError instanceof Error ? monitorError.message : String(monitorError));
      setStatus('Could not start monitoring');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.heading}>STEVAL-MKBOXPRO BLE diagnostics</Text>
        <Text selectable>Status: {status}</Text>
        {error ? <Text selectable style={styles.error}>Error: {error}</Text> : null}

        <View style={styles.actions}>
          <Button title="Start scan" onPress={startScan} disabled={busy} />
          <Button title="Stop scan" onPress={stopScan} />
        </View>

        <Text style={styles.sectionHeading}>Discovered devices ({sortedDevices.length})</Text>
        {sortedDevices.map((device) => (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            key={device.id}
            onPress={() => void connect(device)}
            style={styles.device}
          >
            <Text selectable style={styles.deviceName}>
              {device.localName ?? device.name ?? 'Unnamed BLE device'}
            </Text>
            <Text selectable>ID: {device.id}</Text>
            <Text>RSSI: {device.rssi ?? 'unknown'}</Text>
            <Text selectable>Advertised services: {device.serviceUuids.join(', ') || 'none'}</Text>
          </Pressable>
        ))}

        {selectedDevice ? (
          <>
            <Text style={styles.sectionHeading}>
              GATT services for {selectedDevice.localName ?? selectedDevice.name ?? selectedDevice.id}
            </Text>
            {services.map((service) => (
              <View key={service.uuid} style={styles.service}>
                <Text selectable style={styles.serviceUuid}>{service.uuid}</Text>
                {service.characteristics.map((characteristic) => (
                  <Text selectable key={characteristic.uuid} style={styles.characteristic}>
                    {characteristic.uuid}{'\n'}
                    read={String(characteristic.isReadable)} write={String(
                      characteristic.isWritableWithResponse ||
                        characteristic.isWritableWithoutResponse,
                    )} notify={String(
                      characteristic.isNotifiable || characteristic.isIndicatable,
                    )}
                  </Text>
                ))}
              </View>
            ))}

            <Button
              title="Monitor notifiable characteristics"
              onPress={monitorNotifications}
              disabled={busy || services.length === 0}
            />

            <Text style={styles.sectionHeading}>Stream metrics</Text>
            <Text>Characteristics monitored: {metrics.monitoredCharacteristicCount}</Text>
            <Text>Packets: {metrics.packetCount}</Text>
            <Text>Bytes: {metrics.byteCount}</Text>
            <Text>Packets/second: {metrics.packetsPerSecond.toFixed(1)}</Text>
            <Text>Largest packet gap: {metrics.largestInterarrivalGapMs.toFixed(1)} ms</Text>

            <Text style={styles.sectionHeading}>First packets ({packets.length}/20)</Text>
            {packets.map((packet, index) => (
              <Text selectable key={`${packet.characteristicUuid}-${index}`} style={styles.packet}>
                {packet.characteristicUuid} ({packet.byteLength} bytes){'\n'}
                {packet.valueHex}
              </Text>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { gap: 12, padding: 16 },
  heading: { fontSize: 20, fontWeight: '700' },
  sectionHeading: { fontSize: 16, fontWeight: '700', marginTop: 12 },
  actions: { gap: 8 },
  error: { color: '#b00020' },
  device: { borderColor: '#999', borderRadius: 6, borderWidth: 1, gap: 4, padding: 12 },
  deviceName: { fontWeight: '700' },
  service: { borderColor: '#bbb', borderWidth: 1, gap: 8, padding: 10 },
  serviceUuid: { fontWeight: '700' },
  characteristic: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  packet: { backgroundColor: '#eee', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), padding: 8 },
});
