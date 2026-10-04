import type { CloudTrip } from '../../integrations/backend/tripUpload';
import type { TripEventRow, TripRow, TripSummary } from '../../integrations/backend/dashboardClient';

export type Tone = 'good' | 'warn' | 'info';
export type EventView = Readonly<{ key: string; time: string; title: string; detail: string; tone: Tone }>;

const mph = (mps: unknown) => (typeof mps === 'number' ? Math.round(mps / 0.44704) : null);

/** Approach warnings are noise in a summary; the verdict at the sign is what matters. */
export const APPROACH_KINDS = new Set(['stop_sign_ahead', 'traffic_light_ahead']);

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/** Title, detail and tone for one event, worded for the driver. */
export function describeTripEvent(e: TripEventRow): Omit<EventView, 'key' | 'time'> {
  const d = e.detail ?? {};
  const speed = mph(d.speedMps ?? e.speedMps);
  const on = e.road ? ` on ${e.road}` : '';
  switch (e.kind) {
    case 'crash':
      return { title: e.confirmed ? 'Crash confirmed' : 'Possible crash', detail: 'Safety check requested', tone: 'warn' };
    case 'hard_braking':
      return { title: 'Firm braking', detail: `Brake earlier and more gently${on}`, tone: 'warn' };
    case 'rapid_acceleration':
      return { title: 'Quick acceleration', detail: `Ease onto the accelerator${on}`, tone: 'warn' };
    case 'harsh_cornering':
      return { title: 'Sharp corner', detail: `Slow down before the turn${on}`, tone: 'warn' };
    case 'erratic_driving':
      return { title: 'Unsteady driving', detail: `Stay smooth in your lane${on}`, tone: 'warn' };
    case 'stop_ok':
      return { title: 'Full stop', detail: `Complete stop at the sign${on}`, tone: 'good' };
    case 'rolling_stop': {
      const slowest = mph(d.minSpeedMps);
      return { title: 'Rolling stop', detail: `${slowest !== null ? `Slowest ${slowest} mph` : 'Did not fully stop'}${on}`, tone: 'warn' };
    }
    case 'ran_stop':
      return { title: 'Ran a stop sign', detail: `Never slowed to a stop${on}`, tone: 'warn' };
    case 'highway_entering': {
      const target = mph(d.targetSpeedMps);
      return d.advice === 'speed_up'
        ? { title: 'Slow highway merge', detail: `Merged at ${speed} mph, traffic about ${target}${d.road ? ` (${d.road})` : ''}`, tone: 'warn' }
        : { title: 'Good highway merge', detail: `Matched traffic speed${d.road ? ` on ${d.road}` : ''}`, tone: 'good' };
    }
    case 'highway_exiting': {
      const target = mph(d.targetSpeedMps);
      return d.advice === 'slow_down'
        ? { title: 'Fast off-ramp', detail: `${speed} mph on a ${target} mph ramp`, tone: 'warn' }
        : { title: 'Smooth highway exit', detail: 'Slowed well for the ramp', tone: 'good' };
    }
    case 'speeding':
      return { title: 'Speeding', detail: `${speed} mph in a ${mph(d.limitMps ?? e.limitMps)} mph zone${on}`, tone: 'warn' };
    case 'hotspot_ahead': {
      const habit = d.topKind === 'ran_stop' ? 'run the stop' : d.topKind === 'rolling_stop' ? 'roll the stop' : 'struggle';
      return { title: 'Known trouble spot', detail: `${d.drivers ?? 'Other'} drivers often ${habit} here`, tone: 'info' };
    }
    case 'stop_sign_ahead':
      return { title: 'Stop sign ahead', detail: `Warned ${Math.round(Number(d.distanceM) || 0)} m out`, tone: 'info' };
    case 'traffic_light_ahead':
      return { title: 'Traffic light ahead', detail: `Warned ${Math.round(Number(d.distanceM) || 0)} m out`, tone: 'info' };
    default:
      return { title: e.kind.replace(/_/g, ' '), detail: on.trim(), tone: 'info' };
  }
}

export function eventViews(summary: TripSummary): EventView[] {
  return summary.events
    .filter((e) => !APPROACH_KINDS.has(e.kind))
    .map((e) => ({ key: e.eventId, time: formatElapsed(e.t - summary.trip.start), ...describeTripEvent(e) }));
}

/** A trip still in the phone's memory, shaped like the server's summary (shown until that loads). */
export function summaryFromCloudTrip(trip: CloudTrip): TripSummary {
  return {
    source: 'phone',
    trip: {
      tripId: trip.tripId,
      start: trip.start,
      end: trip.end,
      smoothness: trip.scores.smoothness ?? null,
      stopCompliance: trip.scores.stopCompliance ?? null,
      nEvents: trip.events.length,
      nBadEvents: trip.events.filter((e) =>
        ['crash', 'ran_stop', 'rolling_stop', 'erratic_driving', 'hard_braking', 'rapid_acceleration', 'harsh_cornering'].includes(e.kind)).length,
      pending: true,
    },
    events: trip.events.map((e) => ({
      eventId: e.eventId, t: e.t, kind: e.kind,
      ...(e.road ? { road: e.road } : {}),
      ...(e.speedMps !== undefined ? { speedMps: e.speedMps } : {}),
      ...(e.limitMps !== undefined ? { limitMps: e.limitMps } : {}),
      ...(e.score !== undefined ? { score: e.score } : {}),
      ...(e.confirmed !== undefined ? { confirmed: e.confirmed } : {}),
      ...(e.detail ? { detail: e.detail } : {}),
    })),
    transcript: trip.transcript,
  };
}

export const minutes = (t: TripRow) => Math.max(1, Math.round((t.end - t.start) / 60_000));

export const stopsLabel = (t: TripRow) => (t.stopCompliance === null ? '—' : `${Math.round(t.stopCompliance * 100)}%`);

export function scoreLabel(score: number | null): string {
  if (score === null) return 'Trip captured';
  if (score >= 85) return 'A confident drive';
  if (score >= 70) return 'A solid drive';
  return 'Room to improve';
}

export function tripDateLabel(start: number, now = Date.now()): string {
  const d = new Date(start);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Yesterday · ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

/** Where the numbers on screen came from. */
export function sourceLabel(source: string, pending: boolean): string {
  if (source === 'databricks' && !pending) return 'Loaded from Databricks';
  if (source === 'databricks' || source === 'local') return 'Saved; Databricks is still ingesting this trip';
  return 'On this phone only';
}
