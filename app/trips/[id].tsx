import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Divider, Surface, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getStoredTrip,
  subscribeToTrips,
  uploadStoredTrip,
  type StoredTrip,
} from '@/features/driving-session/tripStore';
import {
  eventViews,
  minutes,
  scoreLabel,
  sourceLabel,
  stopsLabel,
  summaryFromCloudTrip,
  tripDateLabel,
} from '@/features/trips/tripView';
import { useTripReport, useTripSummary } from '@/features/trips/useTripData';
import { colors } from '@/theme';

/**
 * One trip: the Databricks-ingested data once the ingest job has run (the screen polls until it
 * has), the cloud service's copy before that, and the phone's own copy right after the drive.
 */
export default function TripSummaryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [stored, setStored] = useState<StoredTrip | undefined>(() => getStoredTrip(id));
  useEffect(() => {
    setStored(getStoredTrip(id));
    return subscribeToTrips(() => setStored(getStoredTrip(id)));
  }, [id]);

  const remote = useTripSummary(id);
  const report = useTripReport(id);
  const summary = remote.data ?? (stored ? summaryFromCloudTrip(stored.trip) : null);

  if (!summary) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          {remote.loading ? <ActivityIndicator /> : null}
          <Text variant="bodyLarge" style={styles.scoreSubtitle}>
            {remote.loading ? 'Loading this trip from Databricks…' : 'This trip could not be found.'}
          </Text>
          <Button mode="contained" onPress={() => router.replace('/')}>Home</Button>
        </View>
      </SafeAreaView>
    );
  }

  const { trip } = summary;
  const events = eventViews(summary);
  const coachLines = summary.transcript.filter((t) => t.role === 'assistant');
  const metrics = [
    { value: trip.smoothness === null ? '—' : String(Math.round(trip.smoothness)), label: 'Smoothness' },
    { value: stopsLabel(trip), label: 'Full stops' },
    { value: String(trip.nBadEvents), label: 'Issues' },
    { value: String(minutes(trip)), label: 'Minutes' },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Button compact mode="text" icon="arrow-left" onPress={() => router.replace('/')}>Home</Button>
          <Text variant="labelLarge" style={styles.headerLabel}>TRIP SUMMARY</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.scoreSection}>
          <Text variant="labelLarge" style={styles.eyebrow}>{tripDateLabel(trip.start).toUpperCase()}</Text>
          <Text style={styles.score}>{trip.smoothness === null ? '—' : Math.round(trip.smoothness)}</Text>
          <Text variant="headlineSmall" style={styles.scoreTitle}>{scoreLabel(trip.smoothness)}</Text>
          <Text variant="bodyLarge" style={styles.scoreSubtitle}>
            {minutes(trip)} min{trip.distanceM ? ` · ${(trip.distanceM / 1609.344).toFixed(1)} miles` : ''}
          </Text>
          <View style={styles.sourceRow}>
            <View style={[styles.sourceDot, summary.source !== 'databricks' && styles.sourceDotPending]} />
            <Text variant="labelMedium" style={styles.sourceText}>{sourceLabel(summary.source, trip.pending)}</Text>
          </View>
        </View>

        {stored && stored.uploadState !== 'uploaded' ? (
          <Surface style={styles.uploadCard} elevation={0}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              {stored.uploadState === 'uploading' ? 'Sending trip…' : 'Trip saved on this phone'}
            </Text>
            {stored.uploadError ? <Text style={styles.uploadError}>{stored.uploadError}</Text> : null}
            {stored.uploadState === 'failed' ? (
              <Button compact mode="outlined" onPress={() => void uploadStoredTrip(id, process.env.EXPO_PUBLIC_API_URL)}>
                Retry upload
              </Button>
            ) : null}
          </Surface>
        ) : null}

        <Card style={styles.metricsCard} mode="contained">
          <Card.Content style={styles.metricsRow}>
            {metrics.map((metric, index) => (
              <View key={metric.label} style={styles.metricGroup}>
                {index > 0 ? <Divider style={styles.metricDivider} /> : null}
                <View style={styles.metric}>
                  <Text variant="headlineMedium" style={styles.metricValue}>{metric.value}</Text>
                  <Text variant="labelMedium" style={styles.metricLabel}>{metric.label}</Text>
                </View>
              </View>
            ))}
          </Card.Content>
        </Card>

        <Surface style={styles.coachCard} elevation={0}>
          <View style={styles.coachHeading}>
            <View style={styles.coachMark}><Text style={styles.coachMarkText}>✓</Text></View>
            <Text variant="titleLarge" style={styles.sectionTitle}>Coach’s note</Text>
          </View>
          {report ? (
            <>
              <Text variant="titleMedium" style={styles.sectionTitle}>{report.headline}</Text>
              <Text variant="bodyLarge" style={styles.coachText}>{report.scoreExplanation}</Text>
              <Text variant="bodyLarge" style={styles.coachText}>{report.praise}</Text>
              <Text variant="bodyLarge" style={styles.coachText}>Next goal: {report.nextGoal}</Text>
            </>
          ) : (
            <Text variant="bodyLarge" style={styles.coachText}>
              {trip.nBadEvents === 0
                ? 'No problem moments this trip. Keep it up.'
                : 'Your coach is writing a report for this trip.'}
            </Text>
          )}
        </Surface>

        {coachLines.length > 0 ? (
          <Card style={styles.timelineCard} mode="contained">
            <Card.Content style={styles.timelineContent}>
              <Text variant="titleMedium" style={styles.sectionTitle}>What your coach said</Text>
              {coachLines.map((line) => (
                <Text key={`${line.t}-${line.text}`} variant="bodyMedium" style={styles.quote}>
                  “{line.text}”
                </Text>
              ))}
            </Card.Content>
          </Card>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text variant="titleLarge" style={styles.sectionTitle}>Drive moments</Text>
          <Text variant="labelLarge" style={styles.eventCount}>{events.length} EVENTS</Text>
        </View>

        <Card style={styles.timelineCard} mode="contained">
          <Card.Content style={styles.timelineContent}>
            {events.length === 0 ? (
              <Text variant="bodyMedium" style={styles.eventDetail}>Nothing notable happened on this drive.</Text>
            ) : events.map((event, index) => (
              <View key={event.key}>
                <View style={styles.eventRow}>
                  <Text variant="labelLarge" style={styles.eventTime}>{event.time}</Text>
                  <View style={[styles.eventDot, event.tone === 'warn' && styles.eventDotWarn, event.tone === 'info' && styles.eventDotInfo]} />
                  <View style={styles.eventCopy}>
                    <Text variant="titleMedium" style={styles.eventTitle}>{event.title}</Text>
                    <Text variant="bodyMedium" style={styles.eventDetail}>{event.detail}</Text>
                  </View>
                </View>
                {index < events.length - 1 ? <Divider style={styles.eventDivider} /> : null}
              </View>
            ))}
          </Card.Content>
        </Card>

        <Button
          mode="contained"
          contentStyle={styles.doneButtonContent}
          labelStyle={styles.doneButtonLabel}
          onPress={() => router.replace('/')}
        >
          Done
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.cream, flex: 1 },
  container: { gap: 20, padding: 20, paddingBottom: 34 },
  centered: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headerLabel: { color: colors.muted, fontWeight: '800', letterSpacing: 1.2 },
  headerSpacer: { width: 58 },
  scoreSection: { alignItems: 'center', paddingVertical: 6 },
  eyebrow: { color: colors.leaf, fontWeight: '800', letterSpacing: 1.4 },
  score: { color: colors.forest, fontSize: 86, fontWeight: '800', letterSpacing: -5, lineHeight: 94, marginTop: 2 },
  scoreTitle: { color: colors.ink, fontWeight: '800' },
  scoreSubtitle: { color: colors.muted, marginTop: 6, textAlign: 'center' },
  sourceRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 10 },
  sourceDot: { backgroundColor: colors.leaf, borderRadius: 4, height: 8, width: 8 },
  sourceDotPending: { backgroundColor: colors.amber },
  sourceText: { color: colors.muted, fontWeight: '700' },
  metricsCard: { backgroundColor: colors.paper, borderRadius: 22 },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 18 },
  metricGroup: { flex: 1, flexDirection: 'row' },
  metricDivider: { height: 50, width: 1 },
  metric: { alignItems: 'center', flex: 1, gap: 2 },
  metricValue: { color: colors.forest, fontWeight: '800' },
  metricLabel: { color: colors.muted, textAlign: 'center' },
  coachCard: { backgroundColor: colors.mint, borderRadius: 22, gap: 12, padding: 20 },
  coachHeading: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  coachMark: { alignItems: 'center', backgroundColor: colors.forest, borderRadius: 14, height: 28, justifyContent: 'center', width: 28 },
  coachMarkText: { color: colors.white, fontSize: 16, fontWeight: '800' },
  sectionTitle: { color: colors.ink, fontWeight: '800' },
  coachText: { color: '#41564A', lineHeight: 25 },
  quote: { color: '#41564A', fontStyle: 'italic', lineHeight: 22, marginTop: 8 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  eventCount: { color: colors.muted, fontWeight: '700', letterSpacing: 1 },
  timelineCard: { backgroundColor: colors.paper, borderRadius: 22 },
  timelineContent: { paddingVertical: 6 },
  eventRow: { alignItems: 'center', flexDirection: 'row', minHeight: 72 },
  eventTime: { color: colors.muted, width: 50 },
  eventDot: { backgroundColor: colors.leaf, borderRadius: 6, height: 12, marginHorizontal: 8, width: 12 },
  eventDotWarn: { backgroundColor: colors.amber },
  eventDotInfo: { backgroundColor: colors.muted },
  eventCopy: { flex: 1, gap: 2, paddingLeft: 6 },
  eventTitle: { color: colors.ink, fontWeight: '700' },
  eventDetail: { color: colors.muted },
  eventDivider: { marginLeft: 84 },
  doneButtonContent: { height: 54 },
  doneButtonLabel: { fontSize: 16, fontWeight: '800' },
  uploadCard: { backgroundColor: colors.paper, borderRadius: 18, gap: 8, padding: 16 },
  uploadError: { color: '#7A2020' },
});
