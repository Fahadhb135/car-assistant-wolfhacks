import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Divider, Surface, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme';

const metrics = [
  { value: '94', label: 'Smoothness' },
  { value: '100%', label: 'Safe stops' },
  { value: '0', label: 'Harsh brakes' },
];

const events = [
  { time: '2:14', title: 'Smooth start', detail: 'Gentle acceleration', tone: 'good' },
  { time: '11:08', title: 'Sharp corner', detail: 'A little quick on the turn', tone: 'warn' },
  { time: '18:42', title: 'Complete stop', detail: 'Nice approach and full stop', tone: 'good' },
];

export default function TripSummaryRoute() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Button compact mode="text" icon="arrow-left" onPress={() => router.replace('/')}>Home</Button>
          <Text variant="labelLarge" style={styles.headerLabel}>TRIP SUMMARY</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.scoreSection}>
          <Text variant="labelLarge" style={styles.eyebrow}>TODAY’S DRIVE</Text>
          <Text style={styles.score}>88</Text>
          <Text variant="headlineSmall" style={styles.scoreTitle}>A confident drive</Text>
          <Text variant="bodyLarge" style={styles.scoreSubtitle}>24 min · 8.4 miles · Campus loop</Text>
        </View>

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
          <Text variant="bodyLarge" style={styles.coachText}>
            Your speed stayed steady and every stop was complete. Ease into sharper turns a little earlier to make the ride even smoother.
          </Text>
        </Surface>

        <View style={styles.sectionHeader}>
          <Text variant="titleLarge" style={styles.sectionTitle}>Drive moments</Text>
          <Text variant="labelLarge" style={styles.eventCount}>3 EVENTS</Text>
        </View>

        <Card style={styles.timelineCard} mode="contained">
          <Card.Content style={styles.timelineContent}>
            {events.map((event, index) => (
              <View key={event.time}>
                <View style={styles.eventRow}>
                  <Text variant="labelLarge" style={styles.eventTime}>{event.time}</Text>
                  <View style={[styles.eventDot, event.tone === 'warn' && styles.eventDotWarn]} />
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
        <Text variant="bodySmall" style={styles.localNote}>Trip data is stored locally on this phone.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.cream, flex: 1 },
  container: { gap: 20, padding: 20, paddingBottom: 34 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headerLabel: { color: colors.muted, fontWeight: '800', letterSpacing: 1.2 },
  headerSpacer: { width: 58 },
  scoreSection: { alignItems: 'center', paddingVertical: 6 },
  eyebrow: { color: colors.leaf, fontWeight: '800', letterSpacing: 1.4 },
  score: { color: colors.forest, fontSize: 86, fontWeight: '800', letterSpacing: -5, lineHeight: 94, marginTop: 2 },
  scoreTitle: { color: colors.ink, fontWeight: '800' },
  scoreSubtitle: { color: colors.muted, marginTop: 6 },
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
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  eventCount: { color: colors.muted, fontWeight: '700', letterSpacing: 1 },
  timelineCard: { backgroundColor: colors.paper, borderRadius: 22 },
  timelineContent: { paddingVertical: 6 },
  eventRow: { alignItems: 'center', flexDirection: 'row', minHeight: 72 },
  eventTime: { color: colors.muted, width: 50 },
  eventDot: { backgroundColor: colors.leaf, borderRadius: 6, height: 12, marginHorizontal: 8, width: 12 },
  eventDotWarn: { backgroundColor: colors.amber },
  eventCopy: { flex: 1, gap: 2, paddingLeft: 6 },
  eventTitle: { color: colors.ink, fontWeight: '700' },
  eventDetail: { color: colors.muted },
  eventDivider: { marginLeft: 84 },
  doneButtonContent: { height: 54 },
  doneButtonLabel: { fontSize: 16, fontWeight: '800' },
  localNote: { color: colors.muted, textAlign: 'center' },
});
