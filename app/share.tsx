import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Surface, Switch, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDriverId } from '@/features/driving-session/driverId';
import { failureMessage } from '@/features/parent-dashboard/loadWithFallback';
import { ParentHeader, parentStyles as s } from '@/features/parent-dashboard/ParentUi';
import { createShareCode, revokeParents, type ParentFailure } from '@/integrations/backend/parentClient';
import { colors } from '@/theme';

/** Driver side: show a one-time code to a parent, choose whether they see locations, or end their access. */
export default function ShareWithParentRoute() {
  const [shareLocation, setShareLocation] = useState(false);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [failure, setFailure] = useState<ParentFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoked, setRevoked] = useState<number | null>(null);
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;

  async function makeCode(): Promise<void> {
    if (!baseUrl) return setFailure('offline');
    setBusy(true);
    setFailure(null);
    setRevoked(null);
    const r = await createShareCode({ baseUrl, driverId: getDriverId(), shareLocation });
    setBusy(false);
    if (r.ok) setCode(r.data);
    else setFailure(r.reason);
  }

  async function endAccess(): Promise<void> {
    if (!baseUrl) return setFailure('offline');
    setBusy(true);
    setFailure(null);
    const r = await revokeParents({ baseUrl, driverId: getDriverId() });
    setBusy(false);
    if (r.ok) {
      setCode(null);
      setRevoked(r.data.revoked);
    } else setFailure(r.reason);
  }

  const minutesLeft = code ? Math.max(0, Math.round((code.expiresAt - Date.now()) / 60_000)) : 0;

  return (
    <SafeAreaView style={s.safeArea}>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        <ParentHeader title="SHARE WITH A PARENT" back={null} />
        <View style={{ gap: 8 }}>
          <Text variant="headlineMedium" style={s.sectionTitle}>Let a parent follow along</Text>
          <Text variant="bodyLarge" style={s.muted}>
            They’ll see your drive scores, stop and speeding trends, and past drives. You decide whether they also see where you drove.
          </Text>
        </View>

        <Surface style={s.card} elevation={0}>
          <View style={s.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="titleMedium">Share locations</Text>
              <Text variant="bodySmall" style={s.muted}>Off: they see roads and times only. On: they also see GPS positions of events.</Text>
            </View>
            <Switch value={shareLocation} onValueChange={setShareLocation} accessibilityLabel="Share locations with the parent" />
          </View>
        </Surface>

        <Button mode="contained" loading={busy} disabled={busy} onPress={() => void makeCode()} contentStyle={{ height: 52 }}>
          {code ? 'Make a new code' : 'Show a code'}
        </Button>

        {code ? (
          <Surface style={s.mintCard} elevation={0} accessibilityLiveRegion="polite">
            <Text variant="labelLarge" style={styles.codeLabel}>TELL YOUR PARENT THIS CODE</Text>
            <Text style={styles.code} accessibilityLabel={`Code ${code.code.split('').join(' ')}`}>{code.code}</Text>
            <Text variant="bodySmall" style={s.muted}>
              Works once, for about {Math.max(1, minutesLeft)} more minutes. They enter it under “Parent view” on their phone.
            </Text>
          </Surface>
        ) : null}

        {failure ? (
          <Surface style={[s.card, { backgroundColor: '#F6D5D5' }]} elevation={0}>
            <Text variant="bodyMedium">{failureMessage(failure)}</Text>
          </Surface>
        ) : null}
        {revoked !== null ? (
          <Surface style={s.card} elevation={0}>
            <Text variant="bodyMedium">
              {revoked === 0 ? 'No parent was linked. Any unused code was cancelled.' : `Access ended for ${revoked} ${revoked === 1 ? 'parent' : 'parents'}.`}
            </Text>
          </Surface>
        ) : null}

        <Button mode="outlined" textColor={colors.red} icon="account-remove-outline" disabled={busy} onPress={() => void endAccess()}>
          End all parent access
        </Button>
        <Button compact mode="text" onPress={() => router.replace('/')}>Done</Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  codeLabel: { color: colors.leaf, fontWeight: '800', letterSpacing: 1.2 },
  code: { color: colors.forest, fontSize: 52, fontWeight: '800', letterSpacing: 10 },
});
