export type SpeedLevel = 'unknown' | 'ok' | 'over' | 'speeding';

/** ok: at or under the limit; over: above it; speeding: past the warning tolerance. */
export function speedLevel(speedMps: number | null, limitMps: number | null, toleranceMps: number): SpeedLevel {
  if (speedMps === null) return 'unknown';
  if (limitMps === null || speedMps <= limitMps) return 'ok';
  return speedMps > limitMps + toleranceMps ? 'speeding' : 'over';
}
