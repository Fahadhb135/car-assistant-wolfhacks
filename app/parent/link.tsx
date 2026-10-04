import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Button, Surface, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { failureMessage } from '@/features/parent-dashboard/loadWithFallback';
import { ParentHeader, parentStyles as s } from '@/features/parent-dashboard/ParentUi';
import { saveParentSession } from '@/features/parent-dashboard/parentSession';
import { linkWithCode } from '@/integrations/backend/parentClient';
import type { ParentFailure } from '@/integrations/backend/parentClient';

export default function ParentLinkRoute() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ParentFailure | null>(null);
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  const ready = /^\d{6}$/.test(code) && !busy;

  async function submit(): Promise<void> {
    if (!ready) return;
    if (!baseUrl) {
      setFailure('offline');
      return;
    }
    setBusy(true);
    setFailure(null);
    const result = await linkWithCode({ baseUrl, code });
    setBusy(false);
    if (!result.ok) {
      setFailure(result.reason);
      return;
    }
    saveParentSession(result.data);
    router.replace('/parent');
  }

  return (
    <SafeAreaView style={s.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          <ParentHeader title="PARENT VIEW" back={null} />
          <View style={{ gap: 8 }}>
            <Text variant="headlineMedium" style={s.sectionTitle}>Link to your driver</Text>
            <Text variant="bodyLarge" style={s.muted}>
              On their phone, open Car Assistant and tap “Share with a parent”. Type the 6-digit code it shows.
            </Text>
          </View>

          <TextInput
            mode="outlined"
            label="6-digit code"
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            textContentType="oneTimeCode"
            style={{ fontSize: 28, letterSpacing: 8, textAlign: 'center' }}
            onSubmitEditing={() => void submit()}
            error={failure !== null}
          />

          {failure ? (
            <Surface style={[s.card, { backgroundColor: '#F6D5D5' }]} elevation={0} accessibilityLiveRegion="polite">
              <Text variant="bodyMedium">{failureMessage(failure)}</Text>
            </Surface>
          ) : null}

          <Button mode="contained" disabled={!ready} loading={busy} onPress={() => void submit()} contentStyle={{ height: 52 }}>
            Link
          </Button>

          <Surface style={s.mintCard} elevation={0}>
            <Text variant="titleMedium" style={s.sectionTitle}>What you’ll see</Text>
            <Text variant="bodyMedium" style={s.muted}>
              Past drives, smoothness and stop trends, and speeding alerts. The driver chooses whether locations are shared, and can end your access at any time.
            </Text>
          </Surface>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
