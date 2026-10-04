import type { DriveEvent } from '../../core/events/types';

export type CloudTripEvent = Readonly<{
  eventId: string;
  t: number;
  kind:
    | 'crash'
    | 'erratic_driving'
    | 'hard_braking'
    | 'rapid_acceleration'
    | 'harsh_cornering'
    | 'stop_sign_ahead'
    | 'stop_ok'
    | 'rolling_stop'
    | 'ran_stop';
  score?: number;
  confirmed?: boolean;
  evidence?: Readonly<Record<string, number>>;
}>;

export type CloudTrip = Readonly<{
  tripId: string;
  driverId: string;
  start: number;
  end: number;
  scores: Readonly<Record<string, number>>;
  events: readonly CloudTripEvent[];
  features: readonly (readonly number[])[];
  transcript: readonly Readonly<{ t: number; role: 'driver' | 'assistant'; text: string }>[];
}>;

const CLOUD_EVENT_KINDS = new Set<CloudTripEvent['kind']>([
  'crash',
  'erratic_driving',
  'hard_braking',
  'rapid_acceleration',
  'harsh_cornering',
  'stop_sign_ahead',
  'stop_ok',
  'rolling_stop',
  'ran_stop',
]);

export function cloudEvents(events: readonly DriveEvent[]): CloudTripEvent[] {
  return events.flatMap((event) => {
    if (!CLOUD_EVENT_KINDS.has(event.kind as CloudTripEvent['kind'])) return [];
    return [
      {
        eventId: event.eventId,
        t: event.t,
        kind: event.kind as CloudTripEvent['kind'],
        ...(event.kind === 'erratic_driving'
          || event.kind === 'hard_braking'
          || event.kind === 'rapid_acceleration'
          || event.kind === 'harsh_cornering'
          ? { score: event.score }
          : {}),
        ...(event.kind === 'hard_braking'
          || event.kind === 'rapid_acceleration'
          || event.kind === 'harsh_cornering'
          ? { evidence: event.evidence }
          : {}),
        ...(event.kind === 'crash' ? { confirmed: event.confirmed } : {}),
      },
    ];
  });
}

export function buildCloudTrip(options: Readonly<{
  tripId: string;
  driverId: string;
  start: number;
  end: number;
  events: readonly DriveEvent[];
}>): CloudTrip {
  const events = cloudEvents(options.events);
  const crashes = events.filter((event) => event.kind === 'crash').length;
  const erratic = events.filter((event) => event.kind === 'erratic_driving').length;
  const maneuvers = events.filter((event) =>
    ['hard_braking', 'rapid_acceleration', 'harsh_cornering'].includes(event.kind)).length;
  return {
    ...options,
    scores: { smoothness: Math.max(0, 100 - crashes * 40 - erratic * 8 - maneuvers * 5) },
    events,
    features: [],
    transcript: [],
  };
}

export async function submitTrip(options: Readonly<{
  baseUrl: string;
  trip: CloudTrip;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}>): Promise<void> {
  const response = await (options.fetchImpl ?? fetch)(
    `${options.baseUrl.replace(/\/$/, '')}/trips`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options.trip),
      signal: AbortSignal.timeout(options.timeoutMs ?? 6_000),
    },
  );
  if (!response.ok) throw new Error(`Trip upload failed with HTTP ${response.status}.`);
}
