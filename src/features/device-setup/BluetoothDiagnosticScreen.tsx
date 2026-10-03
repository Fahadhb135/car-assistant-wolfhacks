import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  filterByProximity,
  frameStPnplCommand,
  isStMicroelectronicsDevice,
  manufacturerDataHex,
  parseRawStreamPacket,
  PROXIMITY_MIN_RSSI,
  ReactNativeBleClient,
  ST_FEATURE_SERVICE_UUID,
  ST_PNPL_CHARACTERISTIC_UUID,
  ST_RAW_STREAM_CHARACTERISTIC_UUID,
  startImuStreamCommands,
  StPnplResponseAssembler,
  stopImuStreamCommands,
  StreamMetrics,
  type BluetoothDeviceSummary,
  type ProximityFilter,
  type GattServiceSnapshot,
  type RawBlePacket,
} from '@/integrations/bluetooth';
import { base64ToBytes } from '@/integrations/bluetooth/base64';
import type { StreamMetricsSnapshot } from '@/integrations/bluetooth/StreamMetrics';

const EMPTY_METRICS: StreamMetricsSnapshot = {
  packetCount: 0,
  byteCount: 0,
  packetsPerSecond: 0,
  largestInterarrivalGapMs: 0,
  monitoredCharacteristicCount: 0,
};

const PNPL_LOG_LIMIT = 20;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PROXIMITY_OPTIONS: readonly { value: ProximityFilter; label: string }[] = [
  { value: 'veryClose', label: 'Very close' },
  { value: 'nearby', label: 'Nearby' },
  { value: 'all', label: 'All' },
];

export function BluetoothDiagnosticScreen() {
  const clientRef = useRef<ReactNativeBleClient | null>(null);
  const metricsRef = useRef(new StreamMetrics());
  const packetPreviewRef = useRef<RawBlePacket[]>([]);
  const pnplAssemblerRef = useRef(new StPnplResponseAssembler());
  const pnplLogRef = useRef<string[]>([]);
  const sensorPacketCountsRef = useRef<Record<number, number>>({});

  const [status, setStatus] = useState('Ready to scan');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Record<string, BluetoothDeviceSummary>>({});
  const [selectedDevice, setSelectedDevice] = useState<BluetoothDeviceSummary | null>(null);
  const [services, setServices] = useState<readonly GattServiceSnapshot[]>([]);
  const [packets, setPackets] = useState<readonly RawBlePacket[]>([]);
  const [metrics, setMetrics] = useState<StreamMetricsSnapshot>(EMPTY_METRICS);
  const [busy, setBusy] = useState(false);
  const [proximity, setProximity] = useState<ProximityFilter>('nearby');
  const [stOnly, setStOnly] = useState(false);
  const [pnplLog, setPnplLog] = useState<readonly string[]>([]);
  const [sensorPacketCounts, setSensorPacketCounts] = useState<Record<number, number>>({});

  if (!clientRef.current && Platform.OS !== 'web') {
    clientRef.current = new ReactNativeBleClient();
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setMetrics(metricsRef.current.snapshot());
      setPackets([...packetPreviewRef.current]);
      setPnplLog([...pnplLogRef.current]);
      setSensorPacketCounts({ ...sensorPacketCountsRef.current });
    }, 1_000);

    return () => {
      clearInterval(timer);
      void clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, []);

  const allDevices = useMemo(() => Object.values(devices), [devices]);
  const sortedDevices = useMemo(
    () =>
      filterByProximity(allDevices, proximity).filter(
        (device) => !stOnly || isStMicroelectronicsDevice(device),
      ),
    [allDevices, proximity, stOnly],
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

  function logPnpl(line: string) {
    pnplLogRef.current = [...pnplLogRef.current, line].slice(-PNPL_LOG_LIMIT);
  }

  async function sendPnplCommands(commands: readonly string[], label: string) {
    if (!clientRef.current) {
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(`${label}…`);

    try {
      for (const command of commands) {
        console.info('[BLE PnPL command]', command);
        logPnpl(`→ ${command}`);
        for (const packet of frameStPnplCommand(command)) {
          await clientRef.current.writeWithoutResponse(
            ST_FEATURE_SERVICE_UUID,
            ST_PNPL_CHARACTERISTIC_UUID,
            packet,
          );
          // Write-without-response has no flow control; pace the chunks.
          await delay(20);
        }
        // Give the board time to apply each setting and reply.
        await delay(300);
      }
      setStatus(`${label}: sent ${commands.length} commands`);
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : String(commandError));
      setStatus(`${label} failed`);
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
    pnplAssemblerRef.current = new StPnplResponseAssembler();
    sensorPacketCountsRef.current = {};

    try {
      metricsRef.current.reset();
      const monitoredCount = await clientRef.current.monitorNotifiableCharacteristics(
        (packet) => {
          metricsRef.current.record(packet);
          if (packet.characteristicUuid === ST_PNPL_CHARACTERISTIC_UUID) {
            const response = pnplAssemblerRef.current.push(base64ToBytes(packet.valueBase64));
            if (response) {
              console.info('[BLE PnPL response]', response);
              logPnpl(`← ${response}`);
            }
          } else if (packet.characteristicUuid === ST_RAW_STREAM_CHARACTERISTIC_UUID) {
            const parsed = parseRawStreamPacket(base64ToBytes(packet.valueBase64));
            if (parsed) {
              const counts = sensorPacketCountsRef.current;
              counts[parsed.sensorId] = (counts[parsed.sensorId] ?? 0) + 1;
            }
          }
          if (packetPreviewRef.current.length < 20) {
            packetPreviewRef.current.push(packet);
            console.info('[BLE packet]', JSON.stringify(packet));
          }
        },
        (monitorError) => {
          console.warn('[BLE monitor error]', monitorError.message);
          setError(monitorError.message);
        },
      );

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

        <Text style={styles.sectionHeading}>Range</Text>
        <View style={styles.proximityRow}>
          {PROXIMITY_OPTIONS.map((option) => {
            const selected = option.value === proximity;
            const minRssi = PROXIMITY_MIN_RSSI[option.value];
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={option.value}
                onPress={() => setProximity(option.value)}
                style={[styles.proximityOption, selected && styles.proximityOptionSelected]}
              >
                <Text style={selected ? styles.proximityLabelSelected : undefined}>
                  {option.label}
                </Text>
                <Text style={[styles.proximityHint, selected && styles.proximityLabelSelected]}>
                  {minRssi === null ? 'any signal' : `≥ ${minRssi} dBm`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.toggleRow}>
          <Text>STMicroelectronics devices only</Text>
          <Switch value={stOnly} onValueChange={setStOnly} />
        </View>

        <Text style={styles.sectionHeading}>
          Discovered devices ({sortedDevices.length} of {allDevices.length}, strongest first)
        </Text>
        {sortedDevices.map((device) => (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            key={device.id}
            onPress={() => void connect(device)}
            style={styles.device}
          >
            <View style={styles.deviceTitleRow}>
              <Text selectable style={styles.deviceName}>
                {device.localName ?? device.name ?? 'Unnamed BLE device'}
              </Text>
              {isStMicroelectronicsDevice(device) ? <Text style={styles.stBadge}>ST</Text> : null}
            </View>
            <Text selectable>ID: {device.id}</Text>
            <Text>RSSI: {device.rssi ?? 'unknown'}</Text>
            <Text selectable>Advertised services: {device.serviceUuids.join(', ') || 'none'}</Text>
            <Text selectable>Manufacturer data: {manufacturerDataHex(device) ?? 'none'}</Text>
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

            <Text style={styles.sectionHeading}>ST DATALOG2 IMU stream</Text>
            <Text>
              Start monitoring first. Start sends PnPL commands that enable the accelerometer and
              gyroscope at 120 Hz and start a log (the board needs an SD card).
            </Text>
            <Button
              title="Start IMU stream"
              onPress={() => void sendPnplCommands(startImuStreamCommands(), 'Starting IMU stream')}
              disabled={busy || metrics.monitoredCharacteristicCount === 0}
            />
            <Button
              title="Stop IMU stream"
              onPress={() => void sendPnplCommands(stopImuStreamCommands(), 'Stopping IMU stream')}
              disabled={busy || metrics.monitoredCharacteristicCount === 0}
            />
            <Text>
              Stream packets by sensor ID:{' '}
              {Object.entries(sensorPacketCounts)
                .map(([sensorId, count]) => `#${sensorId}: ${count}`)
                .join(', ') || 'none yet'}
            </Text>
            {pnplLog.map((line, index) => (
              <Text selectable key={`${index}-${line}`} style={styles.packet}>
                {line}
              </Text>
            ))}

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
  proximityRow: { flexDirection: 'row', gap: 8 },
  proximityOption: { alignItems: 'center', borderColor: '#999', borderRadius: 6, borderWidth: 1, flex: 1, padding: 8 },
  proximityOptionSelected: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
  proximityLabelSelected: { color: '#fff', fontWeight: '700' },
  proximityHint: { fontSize: 12, opacity: 0.7 },
  error: { color: '#b00020' },
  device: { borderColor: '#999', borderRadius: 6, borderWidth: 1, gap: 4, padding: 12 },
  deviceName: { flexShrink: 1, fontWeight: '700' },
  deviceTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  stBadge: { backgroundColor: '#03234b', borderRadius: 4, color: '#fff', fontSize: 12, fontWeight: '700', overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 2 },
  toggleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  service: { borderColor: '#bbb', borderWidth: 1, gap: 8, padding: 10 },
  serviceUuid: { fontWeight: '700' },
  characteristic: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  packet: { backgroundColor: '#eee', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), padding: 8 },
});
