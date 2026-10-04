/** Plain-language labels and numbers for the parent screens. Pure, so they are unit-tested. */

const ISSUE_LABELS: Record<string, string> = {
  rolling_stop: 'Rolling through stop signs',
  ran_stop: 'Running stop signs',
  hard_braking: 'Hard braking',
  rapid_acceleration: 'Quick acceleration',
  harsh_cornering: 'Sharp corners',
  erratic_driving: 'Unsteady driving',
  crash: 'Possible crash',
  speeding: 'Speeding',
  stop_ok: 'Full stop',
};

export function issueLabel(kind: string): string {
  return ISSUE_LABELS[kind] ?? kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function formatDurationS(seconds: number): string {
  return formatMinutes(Math.max(1, Math.round(seconds / 60)));
}

/** `null` means the phone never recorded a distance (older trips, no GPS): say so, never "0 mi". */
export function formatMiles(miles: number | null): string {
  return miles === null ? 'Not recorded' : `${miles.toFixed(1)} mi`;
}

export function formatDistanceM(meters: number | null): string {
  return meters === null ? 'Not recorded' : formatMiles(meters / 1609.344);
}

export function formatPercent(pct: number | null): string {
  return pct === null ? '—' : `${Math.round(pct)}%`;
}

export function formatScore(score: number | null): string {
  return score === null ? '—' : String(Math.round(score));
}

export function formatAgo(thenMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today 4:10 PM", "Yesterday 4:10 PM", or "Mon Oct 5, 4:10 PM". */
export function formatWhen(startMs: number, nowMs: number): string {
  const d = new Date(startMs);
  const h = d.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const dayStart = (ms: number) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();
  const daysAgo = Math.round((dayStart(nowMs) - dayStart(startMs)) / 86_400_000);
  if (daysAgo === 0) return `Today ${time}`;
  if (daysAgo === 1) return `Yesterday ${time}`;
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

export function formatEventClock(elapsedMs: number): string {
  const s = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type Trend = 'up' | 'down' | 'flat' | 'unknown';

/** Smoothness moved by more than 2 points between the first and the latest few trips. */
export function trendOf(first: number | null, recent: number | null, trips: number): Trend {
  if (first === null || recent === null || trips < 2) return 'unknown';
  if (recent - first > 2) return 'up';
  if (first - recent > 2) return 'down';
  return 'flat';
}

export function trendSentence(trend: Trend, first: number | null, recent: number | null): string {
  if (trend === 'unknown' || first === null || recent === null) return 'Not enough drives yet to show a trend.';
  if (trend === 'up') return `Smoother over time: ${Math.round(first)} at the start, ${Math.round(recent)} lately.`;
  if (trend === 'down') return `Rougher lately: ${Math.round(first)} at the start, ${Math.round(recent)} now.`;
  return `Steady around ${Math.round(recent)}.`;
}

/** What "over by" means for a parent: the coach alerts at 5 mph over, so that is the floor. */
export function formatOverBy(overByMph: number | null): string {
  return overByMph === null ? 'Speed not recorded' : `${Math.round(overByMph)} mph over`;
}
