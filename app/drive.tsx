import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Surface, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme';

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function DriveRoute() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setElapsedSeconds((current) => current + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text variant="labelLarge" style={styles.liveText}>
              {mode === 'replay' ? 'REPLAY ACTIVE' : 'DRIVE ACTIVE'}
            </Text>
          </View>
          <Text variant="titleMedium" style={styles.timer}>{formatTime(elapsedSeconds)}</Text>
        </View>

        <View style={styles.scoreSection} accessibilityLabel="Smoothness score 92 out of 100">
          <Text variant="labelLarge" style={styles.overline}>DRIVING SMOOTHNESS</Text>
          <View style={styles.scoreRing}>
            <View style={styles.scoreRingInner}>
              <Text style={styles.score}>92</Text>
              <Text variant="labelLarge" style={styles.outOf}>OUT OF 100</Text>
            </View>
          </View>
          <Text variant="headlineSmall" style={styles.state}>Smooth driving</Text>
          <Text variant="bodyLarge" style={styles.stateDetail}>Steady speed and clean turns.</Text>
        </View>

        <Surface style={styles.coachCard} elevation={0}>
          <View style={styles.coachIcon}>
            <Text style={styles.coachIconText}>↗</Text>
          </View>
          <View style={styles.coachCopy}>
            <Text variant="labelLarge" style={styles.coachLabel}>COACH</Text>
            <Text variant="titleLarge" style={styles.coachMessage}>Road is clear ahead</Text>
            <Text variant="bodyMedium" style={styles.coachDetail}>Keep your current pace.</Text>
          </View>
        </Surface>

        <View style={styles.signalRow}>
          <View style={styles.signalItem}>
            <View style={styles.okDot} />
            <View>
              <Text variant="labelMedium" style={styles.signalLabel}>SENSOR</Text>
              <Text variant="bodyMedium" style={styles.signalValue}>Connected</Text>
            </View>
          </View>
          <View style={styles.signalItem}>
            <View style={styles.okDot} />
            <View>
              <Text variant="labelMedium" style={styles.signalLabel}>LOCATION</Text>
              <Text variant="bodyMedium" style={styles.signalValue}>Tracking</Text>
            </View>
          </View>
          <View style={styles.signalItem}>
            <View style={styles.okDot} />
            <View>
              <Text variant="labelMedium" style={styles.signalLabel}>VOICE</Text>
              <Text variant="bodyMedium" style={styles.signalValue}>On</Text>
            </View>
          </View>
        </View>

        <Button
          mode="outlined"
          textColor={colors.white}
          style={styles.endButton}
          contentStyle={styles.endButtonContent}
          onPress={() => setConfirmEnd(true)}
        >
          End drive
        </Button>
        <Text variant="bodySmall" style={styles.safetyNote}>
          Keep your eyes on the road. Important guidance will be spoken aloud.
        </Text>
      </ScrollView>

      <Portal>
        <Dialog visible={confirmEnd} onDismiss={() => setConfirmEnd(false)}>
          <Dialog.Title>End this drive?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">We’ll save the trip and prepare your driving summary.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmEnd(false)}>Keep driving</Button>
            <Button onPress={() => router.replace('/trips/demo')}>End drive</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.forestDeep, flex: 1 },
  container: { flexGrow: 1, justifyContent: 'space-between', padding: 20, paddingBottom: 26 },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  livePill: { alignItems: 'center', backgroundColor: '#173A2A', borderRadius: 99, flexDirection: 'row', gap: 8, paddingHorizontal: 13, paddingVertical: 8 },
  liveDot: { backgroundColor: '#79D69F', borderRadius: 5, height: 9, width: 9 },
  liveText: { color: '#A8DDBD', fontWeight: '800', letterSpacing: 1 },
  timer: { color: colors.white, fontVariant: ['tabular-nums'], fontWeight: '700' },
  scoreSection: { alignItems: 'center', marginVertical: 24 },
  overline: { color: '#8FA99A', fontWeight: '800', letterSpacing: 1.5, marginBottom: 18 },
  scoreRing: { alignItems: 'center', borderColor: '#3F8A64', borderRadius: 102, borderWidth: 8, height: 204, justifyContent: 'center', width: 204 },
  scoreRingInner: { alignItems: 'center', backgroundColor: '#123523', borderRadius: 88, height: 176, justifyContent: 'center', width: 176 },
  score: { color: colors.white, fontSize: 72, fontWeight: '800', letterSpacing: -4, lineHeight: 78 },
  outOf: { color: '#8FA99A', fontWeight: '700', letterSpacing: 1.2 },
  state: { color: colors.white, fontWeight: '800', marginTop: 20 },
  stateDetail: { color: '#AFC0B6', marginTop: 4 },
  coachCard: { alignItems: 'center', backgroundColor: colors.cream, borderRadius: 22, flexDirection: 'row', gap: 16, padding: 18 },
  coachIcon: { alignItems: 'center', backgroundColor: colors.mint, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  coachIconText: { color: colors.forest, fontSize: 25, fontWeight: '700' },
  coachCopy: { flex: 1, gap: 2 },
  coachLabel: { color: colors.leaf, fontWeight: '800', letterSpacing: 1.2 },
  coachMessage: { color: colors.ink, fontWeight: '800' },
  coachDetail: { color: colors.muted },
  signalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 18 },
  signalItem: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  okDot: { backgroundColor: '#79D69F', borderRadius: 4, height: 8, width: 8 },
  signalLabel: { color: '#789081', fontWeight: '700' },
  signalValue: { color: '#D8E2DC' },
  endButton: { borderColor: '#739080', borderRadius: 14 },
  endButtonContent: { height: 50 },
  safetyNote: { color: '#789081', lineHeight: 17, paddingHorizontal: 18, textAlign: 'center' },
});
