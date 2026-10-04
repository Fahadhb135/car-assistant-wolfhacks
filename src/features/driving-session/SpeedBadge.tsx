import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { colors } from '@/theme';

import { speedLevel, type SpeedLevel } from './speedLevel';

const MPH = 0.44704;

const LEVEL_STYLE: Record<SpeedLevel, { background: string; text: string }> = {
  unknown: { background: '#173A2A', text: '#8FA99A' },
  ok: { background: '#173A2A', text: colors.white },
  over: { background: colors.amber, text: colors.ink },
  speeding: { background: colors.red, text: colors.white },
};

/** Current GPS speed in mph, with the posted limit of the road the car is on when known. */
export function SpeedBadge({
  speedMps,
  limitMps,
  toleranceMps,
}: Readonly<{ speedMps: number | null; limitMps: number | null; toleranceMps: number }>) {
  const level = speedLevel(speedMps, limitMps, toleranceMps);
  const { background, text } = LEVEL_STYLE[level];
  const speed = speedMps === null ? '–' : String(Math.round(speedMps / MPH));
  const limit = limitMps === null ? null : Math.round(limitMps / MPH);
  return (
    <View
      style={[styles.badge, { backgroundColor: background }]}
      accessibilityLabel={
        speedMps === null
          ? 'Speed unknown'
          : `${speed} miles per hour${limit === null ? '' : `, limit ${limit}`}${level === 'speeding' ? ', over the limit' : ''}`
      }
    >
      <Text style={[styles.speed, { color: text }]}>{speed}</Text>
      <Text style={[styles.unit, { color: text }]}>MPH</Text>
      {limit !== null ? <Text style={[styles.limit, { color: text }]}>LIMIT {limit}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', borderRadius: 14, minWidth: 74, paddingHorizontal: 10, paddingVertical: 6 },
  speed: { fontSize: 30, fontVariant: ['tabular-nums'], fontWeight: '800', lineHeight: 34 },
  unit: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  limit: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 2, opacity: 0.9 },
});
