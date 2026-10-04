import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button, SegmentedButtons, Surface, Text } from 'react-native-paper';

import { RANGES, type ParentRange } from '../../integrations/backend/parentClient';
import { colors } from '../../theme';
import { formatAgo } from './format';
import { failureMessage, type Loaded } from './loadWithFallback';

export function ParentHeader({ title, back = '/parent' }: Readonly<{ title: string; back?: string | null }>) {
  return (
    <View style={styles.header}>
      {back ? (
        <Button compact mode="text" icon="arrow-left" onPress={() => router.replace(back as never)}>Back</Button>
      ) : (
        <Button compact mode="text" icon="home-outline" onPress={() => router.replace('/')}>Home</Button>
      )}
      <Text variant="labelLarge" style={styles.headerLabel}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const RANGE_LABELS: Record<ParentRange, string> = { '7d': '7 days', '30d': '30 days', all: 'All time' };

export function RangeTabs({ value, onChange }: Readonly<{ value: ParentRange; onChange: (r: ParentRange) => void }>) {
  return (
    <SegmentedButtons
      value={value}
      onValueChange={(v) => onChange(v as ParentRange)}
      buttons={RANGES.map((r) => ({ value: r, label: RANGE_LABELS[r] }))}
    />
  );
}

export function KpiTile({ value, label, tone = 'normal' }: Readonly<{ value: string; label: string; tone?: 'normal' | 'warn' }>) {
  return (
    <Surface style={styles.tile} elevation={0} accessibilityLabel={`${label}: ${value}`}>
      <Text variant="headlineMedium" style={[styles.tileValue, tone === 'warn' && styles.tileWarn]}>{value}</Text>
      <Text variant="labelMedium" style={styles.tileLabel}>{label}</Text>
    </Surface>
  );
}

/** Where the numbers came from and how old they are; flags a copy kept from before the connection dropped. */
export function FreshnessNote({ source, generatedAt, stale, savedAt }: Readonly<{
  source: 'databricks' | 'local' | null;
  generatedAt: number | null;
  stale: boolean;
  savedAt: number;
}>) {
  const now = Date.now();
  return (
    <View style={styles.freshness}>
      {stale ? (
        <Surface style={styles.staleBanner} elevation={0}>
          <Text variant="bodySmall" style={styles.staleText}>
            You’re offline. Showing what was loaded {formatAgo(savedAt, now)}.
          </Text>
        </Surface>
      ) : null}
      {generatedAt !== null ? (
        <Text variant="bodySmall" style={styles.muted}>
          {source === 'databricks' ? 'Analyzed in Databricks' : 'Live from the trips uploaded so far'} · updated {formatAgo(generatedAt, now)}
        </Text>
      ) : null}
    </View>
  );
}

/** Loading / error shell around a resource. `children` renders only when there is data. */
export function ResourceView<T>({ state, loading, onRetry, children }: Readonly<{
  state: Loaded<T> | null;
  loading: boolean;
  onRetry: () => void;
  children: (data: T, meta: { stale: boolean; savedAt: number }) => ReactNode;
}>) {
  if (state === null) {
    return (
      <View style={styles.center} accessibilityLabel="Loading">
        <ActivityIndicator color={colors.forest} />
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <Surface style={styles.errorCard} elevation={0}>
        <Text variant="titleMedium" style={styles.errorTitle}>Couldn’t load this</Text>
        <Text variant="bodyMedium" style={styles.muted}>{failureMessage(state.failure)}</Text>
        <Button mode="outlined" loading={loading} onPress={onRetry}>Try again</Button>
      </Surface>
    );
  }
  return <>{children(state.data, { stale: state.stale, savedAt: state.savedAt })}</>;
}

export function EmptyState({ title, body }: Readonly<{ title: string; body: string }>) {
  return (
    <Surface style={styles.empty} elevation={0}>
      <Text variant="titleMedium" style={styles.errorTitle}>{title}</Text>
      <Text variant="bodyMedium" style={styles.muted}>{body}</Text>
    </Surface>
  );
}

const BAR_AREA = 96;

/** A small bar chart, one bar per drive, drawn with plain Views so no native chart library is needed. */
export function BarChart({ title, values, max = 100, format, warnBelow }: Readonly<{
  title: string;
  values: readonly (number | null)[];
  max?: number;
  format: (v: number) => string;
  warnBelow?: number;
}>) {
  const known = values.filter((v): v is number => v !== null);
  const summary = known.length
    ? `${title}: ${values.length} drives, latest ${format(known[known.length - 1])}`
    : `${title}: no data`;
  return (
    <View accessible accessibilityLabel={summary} style={styles.chart}>
      <View style={styles.chartHead}>
        <Text variant="titleMedium" style={styles.chartTitle}>{title}</Text>
        {known.length ? <Text variant="labelLarge" style={styles.muted}>Latest {format(known[known.length - 1])}</Text> : null}
      </View>
      {known.length === 0 ? (
        <Text variant="bodySmall" style={styles.muted}>Nothing recorded for these drives yet.</Text>
      ) : (
        <View style={styles.bars}>
          {values.map((v, i) => (
            <View key={i} style={styles.barSlot}>
              <View
                style={[
                  styles.bar,
                  v === null ? styles.barMissing : { height: Math.max(3, (Math.min(v, max) / max) * BAR_AREA) },
                  v !== null && warnBelow !== undefined && v < warnBelow && styles.barWarn,
                ]}
              />
            </View>
          ))}
        </View>
      )}
      <View style={styles.axis}>
        <Text variant="labelSmall" style={styles.muted}>Oldest</Text>
        <Text variant="labelSmall" style={styles.muted}>Newest</Text>
      </View>
    </View>
  );
}

export const parentStyles = StyleSheet.create({
  safeArea: { backgroundColor: colors.cream, flex: 1 },
  container: { gap: 18, padding: 20, paddingBottom: 36 },
  tileRow: { flexDirection: 'row', gap: 10 },
  sectionTitle: { color: colors.ink, fontWeight: '800' },
  card: { backgroundColor: colors.paper, borderRadius: 22, gap: 10, padding: 18 },
  mintCard: { backgroundColor: colors.mint, borderRadius: 22, gap: 8, padding: 18 },
  muted: { color: colors.muted },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
});

const styles = StyleSheet.create({
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headerLabel: { color: colors.muted, fontWeight: '800', letterSpacing: 1.2 },
  headerSpacer: { width: 58 },
  tile: { backgroundColor: colors.paper, borderRadius: 18, flex: 1, gap: 2, paddingHorizontal: 8, paddingVertical: 16, alignItems: 'center' },
  tileValue: { color: colors.forest, fontWeight: '800' },
  tileWarn: { color: colors.red },
  tileLabel: { color: colors.muted, textAlign: 'center' },
  freshness: { gap: 8 },
  staleBanner: { backgroundColor: colors.amberSoft, borderRadius: 14, padding: 12 },
  staleText: { color: colors.ink },
  muted: { color: colors.muted },
  center: { alignItems: 'center', paddingVertical: 48 },
  errorCard: { backgroundColor: colors.paper, borderRadius: 22, gap: 12, padding: 20 },
  errorTitle: { color: colors.ink, fontWeight: '800' },
  empty: { backgroundColor: colors.paper, borderRadius: 22, gap: 6, padding: 20 },
  chart: { backgroundColor: colors.paper, borderRadius: 22, gap: 10, padding: 18 },
  chartHead: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between' },
  chartTitle: { color: colors.ink, fontWeight: '800' },
  bars: { alignItems: 'flex-end', flexDirection: 'row', gap: 3, height: BAR_AREA },
  barSlot: { flex: 1, justifyContent: 'flex-end' },
  bar: { backgroundColor: colors.leaf, borderRadius: 3, minWidth: 3 },
  barWarn: { backgroundColor: colors.amber },
  barMissing: { backgroundColor: colors.line, height: 3 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});
