import type { DriveEvent } from '../../core/events/types';

/** Where the car was when an event happened (from the latest GPS fix). */
export type EventStamp = Readonly<{
  lat: number;
  lon: number;
  speedMps?: number;
  limitMps?: number;
  road?: string;
}>;

export type CloudTripEvent = Readonly<{
  eventId: string;
  t: number;
  kind: DriveEvent['kind'];
  lat?: number;
  lon?: number;
  speedMps?: number;
  limitMps?: number;
  road?: string;
  /** Kind-specific extras (distanceM, advice, targetSpeedMps, topKind, ...). */
  detail?: Readonly<Record<string, number | string | boolean>>;
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

/** Fields serialized on their own (or meaningless off the phone); everything else goes in `detail`. */
const OWN_FIELDS = new Set(['eventId', 't', 'kind', 'severity', 'score', 'evidence', 'confirmed']);

function detailOf(event: DriveEvent): Record<string, number | string | boolean> | undefined {
  const detail: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(event)) {
    if (OWN_FIELDS.has(key)) continue;
    if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string' || typeof value === 'boolean') {
      detail[key] = value;
    }
  }
  return Object.keys(detail).length ? detail : undefined;
}

/**
 * Every event of the drive, with where the car was when it happened, so Databricks sees the
 * whole drive (stop signs, highways, speeding, hotspots, IMU behaviors), not just a summary.
 */
export function cloudEvents(
  events: readonly DriveEvent[],
  stampFor: (eventId: string) => EventStamp | undefined = () => undefined,
): CloudTripEvent[] {
  return events.map((event) => {
    const stamp = stampFor(event.eventId);
    const detail = detailOf(event);
    return {
      eventId: event.eventId,
      t: event.t,
      kind: event.kind,
      ...(stamp ?? {}),
      ...(detail ? { detail } : {}),
      ...('score' in event ? { score: event.score } : {}),
      ...('evidence' in event ? { evidence: event.evidence } : {}),
      ...(event.kind === 'crash' ? { confirmed: event.confirmed } : {}),
    };
  });
}

/** Share of judged stop signs with a full stop (0..1), or null when no stop was judged. */
export function stopCompliance(events: readonly DriveEvent[]): number | null {
  const judged = events.filter((e) => e.kind === 'stop_ok' || e.kind === 'rolling_stop' || e.kind === 'ran_stop');
  if (judged.length === 0) return null;
  return Math.round((judged.filter((e) => e.kind === 'stop_ok').length / judged.length) * 100) / 100;
}

/** This trip's smoothness, live during the drive and in the upload (same formula for both). */
export function smoothnessScore(events: readonly DriveEvent[]): number {
  const crashes = events.filter((event) => event.kind === 'crash').length;
  const erratic = events.filter((event) => event.kind === 'erratic_driving').length;
  const maneuvers = events.filter((event) =>
    event.kind === 'hard_braking' || event.kind === 'rapid_acceleration' || event.kind === 'harsh_cornering').length;
  return Math.max(0, 100 - crashes * 40 - erratic * 8 - maneuvers * 5);
}

export function buildCloudTrip(options: Readonly<{
  tripId: string;
  driverId: string;
  start: number;
  end: number;
  events: readonly DriveEvent[];
  stampFor?: (eventId: string) => EventStamp | undefined;
  transcript?: CloudTrip['transcript'];
}>): CloudTrip {
  const { stampFor, transcript, ...trip } = options;
  const compliance = stopCompliance(options.events);
  return {
    ...trip,
    scores: { smoothness: smoothnessScore(options.events), ...(compliance !== null ? { stopCompliance: compliance } : {}) },
    events: cloudEvents(options.events, stampFor),
    features: [],
    transcript: transcript ?? [],
  };
}

/**
 * The cloud stores times as whole epoch milliseconds. IMU event times come from 120 Hz sample
 * timing (8.33 ms steps), so they carry fractions that made the whole trip fail validation (422).
 */
function wholeMilliseconds(trip: CloudTrip): CloudTrip {
  return {
    ...trip,
    start: Math.round(trip.start),
    end: Math.round(trip.end),
    events: trip.events.map((event) => ({ ...event, t: Math.round(event.t) })),
    transcript: trip.transcript.map((turn) => ({ ...turn, t: Math.round(turn.t) })),
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
      body: JSON.stringify(wholeMilliseconds(options.trip)),
      signal: AbortSignal.timeout(options.timeoutMs ?? 6_000),
    },
  );
  if (!response.ok) throw new Error(`Trip upload failed with HTTP ${response.status}.`);
}
