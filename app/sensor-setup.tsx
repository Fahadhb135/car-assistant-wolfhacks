import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ReactNativeBleClient,
  STEVAL_MKBOXPRO_DATALOG2_V34_PROFILE,
  type BluetoothDeviceSummary,
} from '@/integrations/bluetooth';
import { colors } from '@/theme';

function displayName(device: BluetoothDeviceSummary): string {
  return device.localName ?? device.name ?? 'SensorTile';
}

function isSupported(device: BluetoothDeviceSummary): boolean {
  const expected = STEVAL_MKBOXPRO_DATALOG2_V34_PROFILE.advertisedName.toLowerCase();
  return [device.localName, device.name].some((name) => name?.toLowerCase().includes(expected));
}

export default function SensorSetupRoute() {
  const clientRef = useRef<ReactNativeBleClient | null>(null);
  const [devices, setDevices] = useState<Record<string, BluetoothDeviceSummary>>({});
  const [status, setStatus] = useState('Looking for your SensorTile…');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sortedDevices = useMemo(
    () => Object.values(devices).sort((a, b) => (b.rssi ?? -Infinity) - (a.rssi ?? -Infinity)),
    [devices],
  );

  async function scan(): Promise<void> {
    if (Platform.OS === 'web') {
      setError('Bluetooth setup requires the iOS or Android development build.');
      return;
    }
    const client = clientRef.current ?? new ReactNativeBleClient();
    clientRef.current = client;
    setDevices({});
    setError(null);
    setStatus('Looking for HSD2v34…');
    try {
      if (!(await client.requestPermissions())) throw new Error('Bluetooth permission was denied.');
      await client.startScan(
        (device) => {
          if (!isSupported(device)) return;
          setDevices((current) => ({ ...current, [device.id]: device }));
          setStatus('Select your SensorTile');
        },
        (scanError) => setError(scanError.message),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('Could not scan');
    }
  }

  useEffect(() => {
    void scan();
    return () => {
      const client = clientRef.current;
      clientRef.current = null;
      void client?.destroy();
    };
  }, []);

  async function choose(device: BluetoothDeviceSummary): Promise<void> {
    setBusy(true);
    try {
      await clientRef.current?.stopScan();
      await clientRef.current?.destroy();
      clientRef.current = null;
      router.replace({
        pathname: '/drive',
        params: { deviceId: device.id, deviceName: displayName(device) },
      });
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text variant="headlineMedium" style={styles.title}>Choose your motion sensor</Text>
        <Text variant="bodyLarge" style={styles.copy}>
          Keep the STEVAL-MKBOXPRO nearby and disconnect it from ST BLE Sensor first.
        </Text>
        <Text variant="labelLarge" style={styles.status}>{status}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {sortedDevices.map((device) => (
          <Card key={device.id} mode="contained" style={styles.device}>
            <Card.Content style={styles.deviceContent}>
              <View style={styles.deviceCopy}>
                <Text variant="titleMedium">{displayName(device)}</Text>
                <Text variant="bodySmall" style={styles.muted}>
                  Signal {device.rssi ?? 'unknown'} dBm
                </Text>
              </View>
              <Button mode="contained" disabled={busy} onPress={() => void choose(device)}>
                Use sensor
              </Button>
            </Card.Content>
          </Card>
        ))}

        <Button mode="outlined" icon="refresh" disabled={busy} onPress={() => void scan()}>
          Scan again
        </Button>
        <Button mode="text" disabled={busy} onPress={() => router.back()}>Cancel</Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.cream, flex: 1 },
  container: { gap: 16, padding: 22 },
  title: { color: colors.ink, fontWeight: '800', marginTop: 18 },
  copy: { color: colors.muted, lineHeight: 24 },
  status: { color: colors.leaf, letterSpacing: 0.8, marginTop: 8 },
  error: { backgroundColor: '#F6D5D5', borderRadius: 12, color: '#7A2020', padding: 12 },
  device: { backgroundColor: colors.paper, borderRadius: 18 },
  deviceContent: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  deviceCopy: { flex: 1, gap: 4 },
  muted: { color: colors.muted },
});
