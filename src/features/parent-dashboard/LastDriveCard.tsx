import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button, Card, Divider, Text } from 'react-native-paper';

import { fetchTrips } from '../../integrations/backend/parentClient';
import { colors } from '../../theme';
import { failureMessage } from './loadWithFallback';
import { driveVerdict, formatDistanceM, formatDurationS, formatScore, formatWhen } from './format';
import { useParentResource } from './useParentResource';

/** Home screen: the newest drive, loaded from the service (Databricks, plus any drive it has not processed yet). */
export function LastDriveCard() {
  const last = useParentResource('trips:last', (session) => fetchTrips(session, { limit: 1 }));
  const { reload } = last;

  // Coming back to the home screen after a drive should show that drive, so refresh on focus
  // (the first focus is already covered by the initial load).
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      reload();
    }, [reload]),
  );

  const state = last.state;
  const trip = state && state.status === 'ready' ? state.data.trips[0] : undefined;

  return (
    <>
      <View style={styles.sectionHeader}>
        <Text variant="titleLarge" style={styles.sectionTitle}>Last drive</Text>
        <Button compact mode="text" onPress={() => router.push('/parent')}>Dashboard</Button>
      </View>

      {state === null ? (
        <Card style={styles.card} mode="contained" accessibilityLabel="Loading your last drive">
          <Card.Content style={styles.message}><ActivityIndicator color={colors.forest} /></Card.Content>
        </Card>
      ) : state.status === 'error' ? (
        <Card style={styles.card} mode="contained">
          <Card.Content style={styles.messageCol}>
            <Text variant="titleMedium">Couldn’t load your last drive</Text>
            <Text variant="bodyMedium" style={styles.muted}>{failureMessage(state.failure)}</Text>
            <Button compact mode="outlined" onPress={reload}>Try again</Button>
          </Card.Content>
        </Card>
      ) : !trip ? (
        <Card style={styles.card} mode="contained">
          <Card.Content style={styles.messageCol}>
            <Text variant="titleMedium">No drives yet</Text>
            <Text variant="bodyMedium" style={styles.muted}>Finish a drive and it shows up here.</Text>
          </Card.Content>
        </Card>
      ) : (
        <Card
          style={styles.card}
          mode="contained"
          onPress={() => router.push({ pathname: '/parent/trips/[id]', params: { id: trip.tripId } })}
          accessibilityLabel={`Last drive ${formatWhen(trip.start, Date.now())}, smoothness ${formatScore(trip.smoothness)}. Open details.`}
        >
          <Card.Content style={styles.content}>
            <View style={styles.scoreBlock}>
              <Text variant="displaySmall" style={styles.score}>{formatScore(trip.smoothness)}</Text>
              <Text variant="labelMedium" style={styles.muted}>DRIVE SCORE</Text>
            </View>
            <Divider style={styles.divider} />
            <View style={styles.details}>
              <Text variant="titleMedium">{formatWhen(trip.start, Date.now())}</Text>
              <Text variant="bodyMedium" style={styles.muted}>
                {formatDurationS(trip.durationS)} · {formatDistanceM(trip.distanceM)}
              </Text>
              <View style={styles.verdictRow}>
                <View style={[styles.dot, !driveVerdict(trip).good && styles.dotWarn]} />
                <Text variant="labelMedium" style={[styles.verdict, !driveVerdict(trip).good && styles.verdictWarn]}>
                  {driveVerdict(trip).text}
                </Text>
              </View>
            </View>
          </Card.Content>
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { color: colors.ink, fontWeight: '800' },
  card: { backgroundColor: colors.paper, borderRadius: 22 },
  content: { alignItems: 'center', flexDirection: 'row', gap: 18, paddingVertical: 18 },
  message: { alignItems: 'center', paddingVertical: 18 },
  messageCol: { gap: 8, paddingVertical: 16 },
  scoreBlock: { alignItems: 'center', minWidth: 68 },
  score: { color: colors.forest, fontWeight: '800' },
  muted: { color: colors.muted },
  divider: { height: 64, width: 1 },
  details: { flex: 1, gap: 5 },
  verdictRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 3 },
  dot: { backgroundColor: colors.leaf, borderRadius: 4, height: 8, width: 8 },
  dotWarn: { backgroundColor: colors.amber },
  verdict: { color: colors.leaf, fontWeight: '700' },
  verdictWarn: { color: colors.muted },
});
