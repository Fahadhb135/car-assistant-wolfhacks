import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Surface, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CoachMessage } from '@/features/driving-session/coachMessage';
import { CoachChatBar } from '@/features/driving-session/CoachChatBar';
import { DriveContext } from '@/features/driving-session/DriveContext';
import { getDriverId } from '@/features/driving-session/driverId';
import type { LiveCoach } from '@/features/driving-session/LiveCoach';
import { createTripId, saveTrip, uploadStoredTrip } from '@/features/driving-session/tripStore';
import { historyLine, scoreSummary, useDriverStats, useLiveCoach } from '@/features/driving-session/useDriveCoaching';
import { useCoachChat, type CoachChatApi } from '@/features/driving-session/useCoachChat';
import { useDriveVoice } from '@/features/driving-session/useDriveVoice';
import { useLiveImuDrive } from '@/features/driving-session/useLiveImuDrive';
import { SpeedBadge } from '@/features/driving-session/SpeedBadge';
import { TuningPanel } from '@/features/driving-session/TuningPanel';
import { useLiveLocation, type LiveLocationStatus } from '@/features/driving-session/useLiveLocation';
import { useReplayDrive } from '@/features/driving-session/useReplayDrive';
import { POLICIES } from '@/features/voice/phrases';
import { buildCloudTrip, smoothnessScore } from '@/integrations/backend/tripUpload';
import { colors } from '@/theme';

/** Card tint per coaching tone (calm keeps the original cream). */
const TONE_BACKGROUND: Record<CoachMessage['tone'], string> = {
  calm: colors.cream,
  info: colors.mint,
  warn: colors.amberSoft,
  urgent: '#F6D5D5',
};

const LOCATION_LABEL: Record<LiveLocationStatus, string> = {
  idle: 'Off',
  requesting: 'Starting…',
  denied: 'No permission',
  waiting: 'Finding GPS…',
  tracking: 'Tracking',
  error: 'Error',
};

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function DriveRoute() {
  const { mode, deviceId, deviceName } = useLocalSearchParams<{
    mode?: string;
    deviceId?: string;
    deviceName?: string;
  }>();
  const replayMode = mode === 'replay';
  // GPS coaching and spoken alerts stop if the phone locks mid-drive, so keep the screen on.
  useKeepAwake();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const startedAtRef = useRef(Date.now());
  const [driverId] = useState(getDriverId);
  // Where the car is and was: stamps every event for the upload and feeds live coaching.
  const [driveContext] = useState(() => new DriveContext());
  const liveCoachRef = useRef<LiveCoach | null>(null);
  // A safety alert (anything outranking a chat reply) stops the passenger's listening, so the alert is heard cleanly.
  const chatRef = useRef<CoachChatApi | null>(null);
  const voice = useDriveVoice(
    (alert) => alert.priority > POLICIES.chat_reply.priority && chatRef.current?.cancel(),
    (event) => {
      driveContext.stamp(event);
      liveCoachRef.current?.onEvent(event);
    },
  );
  const replay = useReplayDrive(replayMode, voice, (fix) => driveContext.updateFix(fix));
  const live = useLiveImuDrive(!replayMode, deviceId, voice);
  const [tuneOpen, setTuneOpen] = useState(false);
  const location = useLiveLocation(!replayMode, live.eventSink, (fix, limitMps, road) =>
    driveContext.updateFix(fix, limitMps, road));
  const getEvents = useCallback(
    () => (replayMode ? replay.eventsRef.current : live.eventsRef.current),
    [live.eventsRef, replay.eventsRef, replayMode],
  );
  const chat = useCoachChat(voice, getEvents);
  chatRef.current = chat;
  liveCoachRef.current = useLiveCoach(voice, driveContext, getEvents, driverId, startedAtRef.current);
  const driverStats = useDriverStats(driverId);
  // Re-read every second (the timer re-renders), so the score follows the drive live.
  const tripScore = smoothnessScore(getEvents());
  const summary = scoreSummary(tripScore);
  const history = historyLine(driverStats);
  const coach = replayMode ? replay.coach : live.coach;
  const sensorValue = replayMode
    ? 'Replay'
    : live.status === 'running'
      ? live.calibrationStatus === 'ready'
        ? deviceName ?? 'Connected'
        : 'Calibrating…'
      : live.status === 'error'
        ? 'Error'
        : live.status === 'connecting' || live.status === 'starting'
          ? 'Connecting…'
          : 'Stopped';

  async function endDrive(): Promise<void> {
    if (ending) return;
    setEnding(true);
    if (!replayMode) await live.stop();

    const endedAt = Date.now();
    const tripId = createTripId(endedAt);
    const trip = buildCloudTrip({
      tripId,
      driverId,
      start: startedAtRef.current,
      end: endedAt,
      events: getEvents(),
      stampFor: driveContext.stampFor,
      transcript: driveContext.transcript(),
    });
    saveTrip(trip);
    const upload = uploadStoredTrip(tripId, process.env.EXPO_PUBLIC_API_URL);
    router.replace({ pathname: '/trips/[id]', params: { id: tripId } });
    void upload;
  }

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
              {replayMode ? 'REPLAY ACTIVE' : 'DRIVE ACTIVE'}
            </Text>
          </View>
          <View style={styles.topRight}>
            <Text variant="titleMedium" style={styles.timer}>{formatTime(elapsedSeconds)}</Text>
            {!replayMode ? (
              <SpeedBadge speedMps={location.speedMps} limitMps={location.limitMps} toleranceMps={location.toleranceMps} />
            ) : null}
          </View>
        </View>

        <View style={styles.scoreSection} accessibilityLabel={`Smoothness score ${tripScore} out of 100`}>
          <Text variant="labelLarge" style={styles.overline}>DRIVING SMOOTHNESS</Text>
          <View style={styles.scoreRing}>
            <View style={styles.scoreRingInner}>
              <Text style={styles.score}>{tripScore}</Text>
              <Text variant="labelLarge" style={styles.outOf}>OUT OF 100</Text>
            </View>
          </View>
          <Text variant="headlineSmall" style={styles.state}>{summary.label}</Text>
          <Text variant="bodyLarge" style={styles.stateDetail}>{summary.detail}</Text>
          {history ? <Text variant="bodySmall" style={styles.history}>{history}</Text> : null}
        </View>

        <Surface style={[styles.coachCard, { backgroundColor: TONE_BACKGROUND[coach.tone] }]} elevation={0}>
          <View style={styles.coachIcon}>
            <Text style={styles.coachIconText}>↗</Text>
          </View>
          <View style={styles.coachCopy}>
            <Text variant="labelLarge" style={styles.coachLabel}>COACH</Text>
            <Text variant="titleLarge" style={styles.coachMessage}>{coach.title}</Text>
            <Text variant="bodyMedium" style={styles.coachDetail}>{coach.detail}</Text>
          </View>
        </Surface>

        {live.error && !replayMode ? (
          <Text variant="bodySmall" style={styles.sensorError}>{live.error}</Text>
        ) : null}
        {location.status === 'denied' && !replayMode ? (
          <Text variant="bodySmall" style={styles.sensorError}>
            Location is off, so stop sign, traffic light and highway coaching is unavailable. Allow location for Car Assistant in Settings.
          </Text>
        ) : null}

        {!replayMode && live.status === 'running' ? (
          <Surface style={styles.calibrationCard} elevation={0}>
            <View style={styles.calibrationCopy}>
              <Text variant="labelLarge" style={styles.calibrationLabel}>
                {live.calibrationStatus === 'ready' ? 'SENSOR CALIBRATED' : 'SENSOR CALIBRATION'}
              </Text>
              <Text variant="bodySmall" style={styles.calibrationDetail}>{live.calibrationMessage}</Text>
            </View>
            <Button compact mode="text" onPress={() => void live.recalibrate()}>Recalibrate</Button>
            <Button compact mode="contained-tonal" onPress={() => setTuneOpen(true)}>Tune</Button>
          </Surface>
        ) : null}
        {!replayMode ? (
          <TuningPanel visible={tuneOpen} onDismiss={() => setTuneOpen(false)} motion={live.motion} />
        ) : null}

        <CoachChatBar chat={chat} />

        <View style={styles.signalRow}>
          <View style={styles.signalItem}>
            <View style={styles.okDot} />
            <View>
              <Text variant="labelMedium" style={styles.signalLabel}>SENSOR</Text>
              <Text variant="bodyMedium" style={styles.signalValue}>{sensorValue}</Text>
            </View>
          </View>
          <View style={styles.signalItem}>
            <View style={styles.okDot} />
            <View>
              <Text variant="labelMedium" style={styles.signalLabel}>LOCATION</Text>
              <Text variant="bodyMedium" style={styles.signalValue}>
                {replayMode ? 'Replay' : location.mapError && location.status === 'tracking' ? 'Map offline' : LOCATION_LABEL[location.status]}
              </Text>
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
          disabled={ending}
          loading={ending}
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
            <Button disabled={ending} onPress={() => void endDrive()}>End drive</Button>
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
  topRight: { alignItems: 'center', flexDirection: 'row', gap: 12 },
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
  history: { color: '#8FA99A', marginTop: 8 },
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
  sensorError: { backgroundColor: '#F6D5D5', borderRadius: 10, color: '#7A2020', padding: 10 },
  calibrationCard: { alignItems: 'center', backgroundColor: '#173A2A', borderRadius: 14, flexDirection: 'row', gap: 10, padding: 12 },
  calibrationCopy: { flex: 1, gap: 2 },
  calibrationLabel: { color: '#A8DDBD', fontWeight: '800', letterSpacing: 0.8 },
  calibrationDetail: { color: '#D8E2DC', lineHeight: 18 },
});
