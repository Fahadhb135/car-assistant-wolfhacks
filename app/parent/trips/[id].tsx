import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Divider, Surface, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  formatDurationS, formatEventClock, formatMiles, formatOverBy, formatPercent, formatScore, formatWhen, issueLabel,
} from '@/features/parent-dashboard/format';
import {
  EmptyState, KpiTile, ParentHeader, ResourceView, parentStyles as s,
} from '@/features/parent-dashboard/ParentUi';
import { useParentResource } from '@/features/parent-dashboard/useParentResource';
import { fetchTrip, type TripEventRow } from '@/integrations/backend/parentClient';
import { colors } from '@/theme';

function eventDetail(e: TripEventRow): string {
  const bits: string[] = [];
  if (e.road) bits.push(e.road);
  if (e.kind === 'speeding' && e.speedMph !== null && e.limitMph !== null) {
    bits.push(`${Math.round(e.speedMph)} in a ${Math.round(e.limitMph)} (${formatOverBy(e.speedMph - e.limitMph)})`);
  }
  if (e.kind === 'crash') bits.push('Motion candidate, not a confirmed crash unless marked');
  return bits.join(' · ');
}

export default function ParentTripRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useParentResource(`trip:${id}`, (session) => fetchTrip(session, id));
  const now = Date.now();

  return (
    <SafeAreaView style={s.safeArea}>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        <ParentHeader title="DRIVE" />
        <ResourceView state={trip.state} loading={trip.loading} onRetry={trip.reload}>
          {(d) => (
            <View style={{ gap: 18 }}>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Text variant="labelLarge" style={styles.when}>{formatWhen(d.start, now).toUpperCase()}</Text>
                <Text style={styles.score} accessibilityLabel={`Smoothness ${formatScore(d.smoothness)} out of 100`}>{formatScore(d.smoothness)}</Text>
                <Text variant="bodyLarge" style={s.muted}>{formatDurationS(d.durationS)} · {formatMiles(d.distanceMiles)}</Text>
              </View>

              <View style={s.tileRow}>
                <KpiTile value={formatPercent(d.stopCompliance === null ? null : d.stopCompliance * 100)} label="Full stops" />
                <KpiTile value={String(d.events.filter((e) => e.kind !== 'stop_ok').length)} label="Moments to review" />
              </View>

              {d.report ? (
                <Surface style={s.mintCard} elevation={0}>
                  <Text variant="titleMedium" style={s.sectionTitle}>Coach’s summary</Text>
                  <Text variant="bodyLarge">{d.report.headline}</Text>
                  <Text variant="bodyMedium" style={s.muted}>{d.report.scoreExplanation}</Text>
                  {d.report.topIssues.map((i) => (
                    <Text key={i.eventRef} variant="bodyMedium">• {i.advice}</Text>
                  ))}
                  <Text variant="bodyMedium" style={s.muted}>{d.report.praise}</Text>
                  <Text variant="bodyMedium" style={{ fontWeight: '700' }}>Next goal: {d.report.nextGoal}</Text>
                </Surface>
              ) : null}

              <Text variant="titleLarge" style={s.sectionTitle}>Moments</Text>
              {d.events.length === 0 ? (
                <EmptyState title="Nothing to review" body="No stop-sign, braking, speeding or steadiness issues were recorded on this drive." />
              ) : (
                <Surface style={s.card} elevation={0}>
                  {d.events.map((e, i) => (
                    <View key={e.eventId}>
                      <View style={[s.row, { paddingVertical: 10 }]}>
                        <Text variant="labelLarge" style={styles.clock}>{formatEventClock(e.t - d.start)}</Text>
                        <View style={[styles.dot, e.kind === 'stop_ok' && styles.dotGood]} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text variant="titleMedium">{issueLabel(e.kind)}</Text>
                          {eventDetail(e) ? <Text variant="bodySmall" style={s.muted}>{eventDetail(e)}</Text> : null}
                          {e.lat !== undefined && e.lon !== undefined ? (
                            <Text variant="bodySmall" style={s.muted}>{e.lat.toFixed(4)}, {e.lon.toFixed(4)}</Text>
                          ) : null}
                        </View>
                      </View>
                      {i < d.events.length - 1 ? <Divider /> : null}
                    </View>
                  ))}
                </Surface>
              )}
            </View>
          )}
        </ResourceView>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  when: { color: colors.leaf, fontWeight: '800', letterSpacing: 1.2 },
  score: { color: colors.forest, fontSize: 72, fontWeight: '800', letterSpacing: -4, lineHeight: 80 },
  clock: { color: colors.muted, width: 44 },
  dot: { backgroundColor: colors.amber, borderRadius: 6, height: 12, width: 12 },
  dotGood: { backgroundColor: colors.leaf },
});
