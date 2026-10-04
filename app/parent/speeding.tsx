import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Divider, Surface, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatOverBy, formatWhen } from '@/features/parent-dashboard/format';
import {
  EmptyState, FreshnessNote, KpiTile, ParentHeader, RangeTabs, ResourceView, parentStyles as s,
} from '@/features/parent-dashboard/ParentUi';
import { useParentResource } from '@/features/parent-dashboard/useParentResource';
import { fetchSpeeding, RANGES, type ParentRange } from '@/integrations/backend/parentClient';

const asRange = (v: string | undefined): ParentRange => RANGES.find((r) => r === v) ?? '30d';

export default function SpeedingReportRoute() {
  const params = useLocalSearchParams<{ range?: string }>();
  const [range, setRange] = useState<ParentRange>(asRange(params.range));
  const report = useParentResource(`speeding:${range}`, (session) => fetchSpeeding(session, range));
  const now = Date.now();

  return (
    <SafeAreaView style={s.safeArea}>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        <ParentHeader title="SPEEDING REPORT" />
        <RangeTabs value={range} onChange={setRange} />

        <ResourceView state={report.state} loading={report.loading} onRetry={report.reload}>
          {(d, meta) => (
            <View style={{ gap: 18 }}>
              <FreshnessNote source={d.source} generatedAt={d.generatedAt} stale={meta.stale} savedAt={meta.savedAt} />
              {d.totals.count === 0 ? (
                <EmptyState
                  title={d.totals.trips === 0 ? 'No drives in this period' : 'No speeding alerts'}
                  body={d.totals.trips === 0 ? 'Try a longer range.' : `Across ${d.totals.trips} ${d.totals.trips === 1 ? 'drive' : 'drives'}, they stayed within 5 mph of the limit.`}
                />
              ) : (
                <>
                  <View style={s.tileRow}>
                    <KpiTile value={String(d.totals.count)} label="Alerts" tone="warn" />
                    <KpiTile value={`${d.totals.sharePctOfTrips}%`} label="Drives with speeding" />
                    <KpiTile value={d.totals.maxOverByMph === null ? '—' : `${Math.round(d.totals.maxOverByMph)} mph`} label="Worst, over limit" />
                  </View>

                  <Surface style={s.mintCard} elevation={0}>
                    <Text variant="titleMedium" style={s.sectionTitle}>How far over</Text>
                    <Text variant="bodyMedium">
                      {Object.entries(d.totals.overByBuckets).map(([k, n]) => `${n} at ${k.replace('+', '')}+ mph over`).join(' · ')}
                    </Text>
                    <Text variant="bodySmall" style={s.muted}>
                      An alert means the car stayed 5+ mph over the posted limit; it repeats at most once a minute, so it counts warnings rather than minutes.
                    </Text>
                  </Surface>

                  <Text variant="titleLarge" style={s.sectionTitle}>By road</Text>
                  <Surface style={s.card} elevation={0}>
                    {d.byRoad.map((r, i) => (
                      <View key={r.road}>
                        <View style={[s.row, { paddingVertical: 10 }]}>
                          <Text variant="titleMedium" style={{ flex: 1 }}>{r.road}</Text>
                          <Text variant="bodyMedium" style={s.muted}>
                            {r.count} {r.count === 1 ? 'alert' : 'alerts'}{r.maxOverByMph === null ? '' : ` · up to ${Math.round(r.maxOverByMph)} over`}
                          </Text>
                        </View>
                        {i < d.byRoad.length - 1 ? <Divider /> : null}
                      </View>
                    ))}
                  </Surface>

                  <Text variant="titleLarge" style={s.sectionTitle}>Each alert</Text>
                  <Surface style={s.card} elevation={0}>
                    {d.events.map((e, i) => (
                      <View key={`${e.tripId}-${e.t}-${i}`}>
                        <View style={[s.row, { paddingVertical: 10 }]}>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text variant="titleMedium">{e.road ?? 'Unknown road'}</Text>
                            <Text variant="bodySmall" style={s.muted}>{formatWhen(e.t, now)}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text variant="titleMedium" style={{ color: '#B83A3A', fontWeight: '800' }}>{formatOverBy(e.overByMph)}</Text>
                            {e.speedMph !== null && e.limitMph !== null ? (
                              <Text variant="bodySmall" style={s.muted}>{Math.round(e.speedMph)} in a {Math.round(e.limitMph)}</Text>
                            ) : null}
                          </View>
                        </View>
                        {i < d.events.length - 1 ? <Divider /> : null}
                      </View>
                    ))}
                  </Surface>
                </>
              )}
            </View>
          )}
        </ResourceView>
      </ScrollView>
    </SafeAreaView>
  );
}
