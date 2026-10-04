import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Divider, Surface, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  fetchSummary, fetchTrends, fetchTrips, type ParentRange, type TripRow,
} from '@/integrations/backend/parentClient';
import {
  formatDurationS, formatDistanceM, formatMinutes, formatMiles, formatPercent, formatScore, formatWhen, issueLabel,
  trendOf, trendSentence,
} from '@/features/parent-dashboard/format';
import {
  BarChart, EmptyState, FreshnessNote, KpiTile, ParentHeader, RangeTabs, ResourceView, parentStyles as s,
} from '@/features/parent-dashboard/ParentUi';
import { clearParentSession, getParentSession } from '@/features/parent-dashboard/parentSession';
import { currentParentSession, useParentResource } from '@/features/parent-dashboard/useParentResource';

const PAGE = 10;

export default function ParentDashboardRoute() {
  const [range, setRange] = useState<ParentRange>('30d');
  const linked = getParentSession();

  useEffect(() => {
    if (!getParentSession()) router.replace('/parent/link');
  }, []);

  const summary = useParentResource(`summary:${range}`, (session) => fetchSummary(session, range));
  const trends = useParentResource(`trends:${range}`, (session) => fetchTrends(session, range));
  const firstPage = useParentResource('trips:first', (session) => fetchTrips(session, { limit: PAGE }));
  const [more, setMore] = useState<{ trips: TripRow[]; nextBefore: number | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const refresh = () => {
    setMore(null);
    summary.reload();
    trends.reload();
    firstPage.reload();
  };

  async function loadMore(before: number): Promise<void> {
    const session = currentParentSession();
    if (!session) return;
    setLoadingMore(true);
    const page = await fetchTrips(session, { limit: PAGE, before });
    setLoadingMore(false);
    if (page.ok) setMore((prev) => ({ trips: [...(prev?.trips ?? []), ...page.data.trips], nextBefore: page.data.nextBefore }));
  }

  if (!linked) return null;
  const now = Date.now();

  return (
    <SafeAreaView style={s.safeArea}>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        <ParentHeader title="PARENT VIEW" back={null} />
        <View style={{ gap: 4 }}>
          <Text variant="headlineMedium" style={s.sectionTitle}>How the drives are going</Text>
          <Text variant="bodyMedium" style={s.muted}>
            {linked.shareLocation ? 'Locations are shared with you.' : 'Locations stay private; you see roads and times only.'}
          </Text>
        </View>

        <RangeTabs value={range} onChange={setRange} />

        <ResourceView state={summary.state} loading={summary.loading} onRetry={refresh}>
          {(d, meta) => (
            <View style={{ gap: 18 }}>
              <FreshnessNote source={d.source} generatedAt={d.generatedAt} stale={meta.stale} savedAt={meta.savedAt} />
              {d.trips === 0 ? (
                <EmptyState
                  title="No drives in this period"
                  body={range === 'all' ? 'Once they finish a drive with the app, it shows up here.' : 'Try a longer range, or wait for their next drive.'}
                />
              ) : (
                <>
                  <View style={s.tileRow}>
                    <KpiTile value={formatScore(d.avgSmoothness)} label="Avg smoothness" />
                    <KpiTile value={String(d.trips)} label={d.trips === 1 ? 'Drive' : 'Drives'} />
                    <KpiTile value={formatMinutes(d.minutes)} label="Time driving" />
                  </View>
                  <View style={s.tileRow}>
                    <KpiTile value={formatMiles(d.distanceMiles)} label="Distance" />
                    <KpiTile value={formatPercent(d.stopCompliancePct)} label="Full stops" />
                    <KpiTile value={String(d.speedingCount)} label="Speeding alerts" tone={d.speedingCount > 0 ? 'warn' : 'normal'} />
                  </View>

                  <Surface style={s.mintCard} elevation={0}>
                    <Text variant="titleMedium" style={s.sectionTitle}>The picture</Text>
                    <Text variant="bodyLarge">
                      {trendSentence(trendOf(d.firstSmoothness, d.recentSmoothness, d.trips), d.firstSmoothness, d.recentSmoothness)}
                    </Text>
                    {d.topIssue ? (
                      <Text variant="bodyMedium" style={s.muted}>
                        Most common thing to work on: {issueLabel(d.topIssue).toLowerCase()}.
                      </Text>
                    ) : (
                      <Text variant="bodyMedium" style={s.muted}>No recurring problems in this period.</Text>
                    )}
                    {d.crashCandidates > 0 ? (
                      <Text variant="bodyMedium" style={s.muted}>
                        {d.crashCandidates} {d.crashCandidates === 1 ? 'drive' : 'drives'} had a confirmed crash. Check in with them.
                      </Text>
                    ) : null}
                  </Surface>

                  <Button mode="outlined" icon="speedometer" onPress={() => router.push({ pathname: '/parent/speeding', params: { range } })}>
                    Speeding report
                  </Button>
                </>
              )}
            </View>
          )}
        </ResourceView>

        <ResourceView state={trends.state} loading={trends.loading} onRetry={refresh}>
          {(d) =>
            d.points.length === 0 ? null : (
              <View style={{ gap: 14 }}>
                <BarChart title="Smoothness per drive" values={d.points.slice(-30).map((p) => p.smoothness)} format={(v) => String(Math.round(v))} warnBelow={70} />
                <BarChart title="Full stops per drive" values={d.points.slice(-30).map((p) => (p.stopCompliance === null ? null : p.stopCompliance * 100))} format={(v) => `${Math.round(v)}%`} warnBelow={60} />
              </View>
            )
          }
        </ResourceView>

        <Text variant="titleLarge" style={s.sectionTitle}>Recent drives</Text>
        <ResourceView state={firstPage.state} loading={firstPage.loading} onRetry={refresh}>
          {(d) => {
            const trips = [...d.trips, ...(more?.trips ?? [])];
            const next = more ? more.nextBefore : d.nextBefore;
            if (trips.length === 0) return <EmptyState title="No drives yet" body="Their finished drives will be listed here, newest first." />;
            return (
              <View style={{ gap: 10 }}>
                <Card mode="contained" style={{ backgroundColor: '#FFFDF7', borderRadius: 22 }}>
                  <Card.Content>
                    {trips.map((t, i) => (
                      <View key={t.tripId}>
                        <Card
                          mode="contained"
                          style={{ backgroundColor: 'transparent' }}
                          onPress={() => router.push({ pathname: '/parent/trips/[id]', params: { id: t.tripId } })}
                          accessibilityLabel={`Drive ${formatWhen(t.start, now)}, smoothness ${formatScore(t.smoothness)}`}
                        >
                          <View style={[s.row, { paddingVertical: 14 }]}>
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text variant="titleMedium">{formatWhen(t.start, now)}</Text>
                              <Text variant="bodyMedium" style={s.muted}>
                                {formatDurationS(t.durationS)} · {formatDistanceM(t.distanceM)}
                              </Text>
                              <Text variant="labelMedium" style={s.muted}>
                                {[
                                  t.nBadEvents ? `${t.nBadEvents} to work on` : 'Clean drive',
                                  t.speedingCount ? `${t.speedingCount} speeding` : null,
                                  t.hadCrash ? 'crash confirmed' : null,
                                ].filter(Boolean).join(' · ')}
                              </Text>
                            </View>
                            <View style={{ alignItems: 'center' }}>
                              <Text variant="headlineSmall" style={{ fontWeight: '800' }}>{formatScore(t.smoothness)}</Text>
                              <Text variant="labelSmall" style={s.muted}>SCORE</Text>
                            </View>
                          </View>
                        </Card>
                        {i < trips.length - 1 ? <Divider /> : null}
                      </View>
                    ))}
                  </Card.Content>
                </Card>
                {next !== null ? (
                  <Button mode="text" loading={loadingMore} onPress={() => void loadMore(next)}>Show older drives</Button>
                ) : null}
              </View>
            );
          }}
        </ResourceView>

        <Button
          compact
          mode="text"
          textColor="#647269"
          icon="link-off"
          onPress={() => {
            clearParentSession();
            router.replace('/');
          }}
        >
          Unlink this phone
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
