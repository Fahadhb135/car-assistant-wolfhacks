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

import type { ImuEvent } from '@/core/events/types';
import { ImuPipeline, type StreamHealthSnapshot } from '@/core/imu';
import type { ImuSample } from '@/core/sensors/types';
import {
  filterByProximity,
  isStMicroelectronicsDevice,
  manufacturerDataHex,
  parseRawStreamPacket,
  PROXIMITY_MIN_RSSI,
  ReactNativeBleClient,
  ST_PNPL_CHARACTERISTIC_UUID,
  ST_RAW_STREAM_CHARACTERISTIC_UUID,
  StevalMkboxProSensorSource,
  StPnplResponseAssembler,
  StreamMetrics,
  type BluetoothDeviceSummary,
  type ProximityFilter,
  type GattServiceSnapshot,
  type RawBlePacket,
  type StevalSourceDiagnostics,
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
const EVENT_LOG_LIMIT = 20;

const PROXIMITY_OPTIONS: readonly { value: ProximityFilter; label: string }[] = [
  { value: 'veryClose', label: 'Very close' },
  { value: 'nearby', label: 'Nearby' },
  { value: 'all', label: 'All' },
];

export function BluetoothDiagnosticScreen() {
  const clientRef = useRef<ReactNativeBleClient | null>(null);
  const sourceRef = useRef<StevalMkboxProSensorSource | null>(null);
  const pipelineRef = useRef(new ImuPipeline());
  const metricsRef = useRef(new StreamMetrics());
  const packetPreviewRef = useRef<RawBlePacket[]>([]);
  const pnplAssemblerRef = useRef(new StPnplResponseAssembler());
  const pnplLogRef = useRef<string[]>([]);
  const sensorPacketCountsRef = useRef<Record<number, number>>({});
  const latestSampleRef = useRef<ImuSample | null>(null);
  const pipelineHealthRef = useRef<StreamHealthSnapshot | null>(null);
  const eventLogRef = useRef<ImuEvent[]>([]);

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
  const [sourceDiagnostics, setSourceDiagnostics] = useState<StevalSourceDiagnostics | null>(null);
  const [latestSample, setLatestSample] = useState<ImuSample | null>(null);
  const [pipelineHealth, setPipelineHealth] = useState<StreamHealthSnapshot | null>(null);
  const [eventLog, setEventLog] = useState<readonly ImuEvent[]>([]);

  if (!clientRef.current && Platform.OS !== 'web') {
    clientRef.current = new ReactNativeBleClient();
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setMetrics(metricsRef.current.snapshot());
      setPackets([...packetPreviewRef.current]);
      setPnplLog([...pnplLogRef.current]);
      setSensorPacketCounts({ ...sensorPacketCountsRef.current });
      setSourceDiagnostics(sourceRef.current?.getDiagnostics() ?? null);
      setLatestSample(latestSampleRef.current);
      setPipelineHealth(pipelineHealthRef.current);
      setEventLog([...eventLogRef.current]);
    }, 1_000);

    return () => {
      clearInterval(timer);
      const source = sourceRef.current;
      const client = clientRef.current;
      sourceRef.current = null;
      clientRef.current = null;
      void (async () => {
        try {
          await source?.stop();
        } catch {
          // Best-effort cleanup while the screen is unmounting.
        }
        await client?.destroy();
      })();
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
      if (sourceRef.current?.getDiagnostics().state === 'running') {
        await sourceRef.current.stop();
      }
      sourceRef.current = null;
      const discoveredServices = await clientRef.current.connectAndInspect(device.id);
      sourceRef.current = new StevalMkboxProSensorSource(clientRef.current);
      setServices(discoveredServices);
      setStatus(`Connected; discovered ${discoveredServices.length} services`);
      console.info('[BLE GATT snapshot]', JSON.stringify(discoveredServices, null, 2));
    } catch (connectionError) {
      console.warn('[BLE connect error]', connectionError);
      setError(connectionError instanceof Error ? connectionError.message : String(connectionError));
      setStatus('Connection failed');
    } finally {
      setBusy(false);
    }
  }

  function logPnpl(line: string) {
    pnplLogRef.current = [...pnplLogRef.current, line].slice(-PNPL_LOG_LIMIT);
  }

  async function startLivePipeline() {
    const source = sourceRef.current;
    if (!source) return;

    setBusy(true);
    setError(null);
    setStatus('Starting normalized IMU pipeline…');
    pipelineRef.current.reset();
    latestSampleRef.current = null;
    pipelineHealthRef.current = null;
    eventLogRef.current = [];

    try {
      await source.start(
        (sample) => {
          latestSampleRef.current = sample;
          const result = pipelineRef.current.process(sample);
          pipelineHealthRef.current = result.health;
          if (result.events.length > 0) {
            eventLogRef.current = [...eventLogRef.current, ...result.events].slice(-EVENT_LOG_LIMIT);
            for (const event of result.events) {
              console.info('[IMU candidate event]', JSON.stringify(event));
            }
          }
        },
        (sourceError) => {
          console.warn('[BLE IMU source error]', sourceError.message);
          setError(sourceError.message);
        },
      );
      setSourceDiagnostics(source.getDiagnostics());
      setStatus('Live normalized IMU pipeline running');
    } catch (sourceError) {
      setError(sourceError instanceof Error ? sourceError.message : String(sourceError));
      setStatus('Could not start live IMU pipeline');
    } finally {
      setBusy(false);
    }
  }

  async function stopLivePipeline() {
    const source = sourceRef.current;
    if (!source) return;

    setBusy(true);
    setError(null);
    setStatus('Stopping normalized IMU pipeline…');
    try {
      await source.stop();
      setSourceDiagnostics(source.getDiagnostics());
      setStatus('Live normalized IMU pipeline stopped');
    } catch (sourceError) {
      setError(sourceError instanceof Error ? sourceError.message : String(sourceError));
      setStatus('IMU pipeline stopped with an error');
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
              title="Monitor all characteristics (raw diagnostic)"
              onPress={monitorNotifications}
              disabled={busy || services.length === 0 || sourceDiagnostics?.state === 'running'}
            />

            <Text style={styles.sectionHeading}>ST DATALOG2 live IMU pipeline</Text>
            <Text>
              Start subscribes only to PnPL and raw data, awaits every setup acknowledgement,
              normalizes paired samples at 120 Hz, and feeds the candidate-event pipeline. The board
              needs an SD card. Candidate events are experimental diagnostics, not confirmed safety
              detections.
            </Text>
            <Button
              title="Start live IMU pipeline"
              onPress={() => void startLivePipeline()}
              disabled={busy || services.length === 0 || sourceDiagnostics?.state === 'running'}
            />
            <Button
              title="Stop live IMU pipeline"
              onPress={() => void stopLivePipeline()}
              disabled={busy || sourceDiagnostics?.state !== 'running'}
            />
            <Text>
              Raw diagnostic packets by sensor ID:{' '}
              {Object.entries(sensorPacketCounts)
                .map(([sensorId, count]) => `#${sensorId}: ${count}`)
                .join(', ') || 'none yet'}
            </Text>
            {sourceDiagnostics ? (
              <View style={styles.liveDiagnostics}>
                <Text>Source state: {sourceDiagnostics.state}</Text>
                <Text>Setup commands accepted: {sourceDiagnostics.acceptedCommandCount}/9</Text>
                <Text>Decoded batches: {sourceDiagnostics.decodedBatchCount}</Text>
                <Text>Decoded vectors: {sourceDiagnostics.decodedVectorCount}</Text>
                <Text>Normalized samples: {sourceDiagnostics.emittedSampleCount}</Text>
                <Text>Normalized samples/second: {sourceDiagnostics.estimatedSampleRateHz.toFixed(1)}</Text>
                <Text>
                  Largest paired-batch arrival gap:{' '}
                  {sourceDiagnostics.largestPairInterarrivalGapMs.toFixed(1)} ms
                </Text>
                <Text>Rejected packets: {sourceDiagnostics.rejectedPacketCount}</Text>
                <Text>Unknown sensor IDs: {sourceDiagnostics.unknownSensorIdCount}</Text>
                <Text>
                  Queue depth: acc {sourceDiagnostics.accelerometerQueueDepth}, gyro{' '}
                  {sourceDiagnostics.gyroscopeQueueDepth}
                </Text>
                <Text>
                  Resynchronizations: {sourceDiagnostics.queueResynchronizationCount} (dropped{' '}
                  {sourceDiagnostics.droppedBatchCount} batches)
                </Text>
              </View>
            ) : null}
            {latestSample ? (
              <Text selectable style={styles.packet}>
                Latest normalized sample #{latestSample.sequence}{'\n'}
                acceleration g: {latestSample.accelerationG.x.toFixed(3)},{' '}
                {latestSample.accelerationG.y.toFixed(3)}, {latestSample.accelerationG.z.toFixed(3)}{'\n'}
                angular velocity dps: {latestSample.angularVelocityDps.x.toFixed(1)},{' '}
                {latestSample.angularVelocityDps.y.toFixed(1)},{' '}
                {latestSample.angularVelocityDps.z.toFixed(1)}
              </Text>
            ) : null}
            {pipelineHealth ? (
              <Text>
                Pipeline: {pipelineHealth.acceptedCount} accepted, {pipelineHealth.rejectedCount}{' '}
                rejected, {pipelineHealth.estimatedSampleRateHz.toFixed(1)} Hz, largest gap{' '}
                {pipelineHealth.largestInterSampleGapMs.toFixed(1)} ms
              </Text>
            ) : null}
            <Text>Candidate events ({eventLog.length}/{EVENT_LOG_LIMIT})</Text>
            {eventLog.map((event, index) => (
              <Text selectable key={`${event.kind}-${event.occurredAtMs}-${index}`} style={styles.packet}>
                {event.kind} · {event.severity} · confidence {event.confidence.toFixed(2)}
              </Text>
            ))}
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
  liveDiagnostics: { backgroundColor: '#eef5ff', gap: 4, padding: 10 },
  packet: { backgroundColor: '#eee', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), padding: 8 },
});
