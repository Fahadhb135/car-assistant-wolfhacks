/** A trip as the dashboard shows it: the Databricks `trips` row (or the service's copy until ingest). */
export type TripRow = Readonly<{
  tripId: string;
  start: number;
  end: number;
  smoothness: number | null;
  /** Share of judged stop signs with a full stop, 0..1. */
  stopCompliance: number | null;
  nEvents: number;
  nBadEvents: number;
  distanceM: number | null;
  /** True until the Databricks ingest job has picked the trip up. */
  pending: boolean;
}>;

export type TripEventRow = Readonly<{
  eventId: string;
  t: number;
  kind: string;
  road?: string;
  speedMps?: number;
  limitMps?: number;
  score?: number;
  confirmed?: boolean;
  detail?: Readonly<Record<string, number | string | boolean>>;
}>;

export type TranscriptRow = Readonly<{ t: number; role: 'driver' | 'assistant'; text: string }>;

export type TripSummary = Readonly<{
  /** 'databricks' when read from the Delta tables, 'local' while waiting for ingest. */
  source: string;
  trip: TripRow;
  events: readonly TripEventRow[];
  transcript: readonly TranscriptRow[];
}>;

export type DriverTrips = Readonly<{ source: string; trips: readonly TripRow[] }>;

type FetchOptions = Readonly<{ baseUrl: string; timeoutMs?: number; fetchImpl?: typeof fetch }>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Never trusts the network: rows missing their basics are dropped rather than shown oddly. */
export function parseTripRow(v: unknown, pending?: boolean): TripRow | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r.tripId !== 'string' || num(r.start) === null || num(r.end) === null) return null;
  return {
    tripId: r.tripId,
    start: r.start as number,
    end: r.end as number,
    smoothness: num(r.smoothness),
    stopCompliance: num(r.stopCompliance),
    nEvents: num(r.nEvents) ?? 0,
    nBadEvents: num(r.nBadEvents) ?? 0,
    distanceM: num(r.distanceM),
    pending: pending ?? r.pending === true,
  };
}

function parseDetail(v: unknown): TripEventRow['detail'] {
  if (!v || typeof v !== 'object') return undefined;
  const out: Record<string, number | string | boolean> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if ((typeof x === 'number' && Number.isFinite(x)) || typeof x === 'string' || typeof x === 'boolean') out[k] = x;
  }
  return out;
}

export function parseEventRow(v: unknown): TripEventRow | null {
  const e = v as Record<string, unknown> | null;
  if (!e || typeof e.eventId !== 'string' || typeof e.kind !== 'string' || num(e.t) === null) return null;
  return {
    eventId: e.eventId,
    t: e.t as number,
    kind: e.kind,
    ...(str(e.road) ? { road: str(e.road) } : {}),
    ...(num(e.speedMps) !== null ? { speedMps: num(e.speedMps)! } : {}),
    ...(num(e.limitMps) !== null ? { limitMps: num(e.limitMps)! } : {}),
    ...(num(e.score) !== null ? { score: num(e.score)! } : {}),
    ...(typeof e.confirmed === 'boolean' ? { confirmed: e.confirmed } : {}),
    ...(parseDetail(e.detail) ? { detail: parseDetail(e.detail) } : {}),
  };
}

export function parseTripSummary(json: unknown): TripSummary | null {
  const s = json as Record<string, unknown> | null;
  if (!s || typeof s.source !== 'string') return null;
  const trip = parseTripRow(s.trip, s.pending === true);
  if (!trip) return null;
  const events = (Array.isArray(s.events) ? s.events : []).map(parseEventRow).filter((e): e is TripEventRow => !!e);
  const transcript = (Array.isArray(s.transcript) ? s.transcript : []).filter(
    (t): t is TranscriptRow => !!t && typeof t.text === 'string' && (t.role === 'driver' || t.role === 'assistant'),
  );
  return { source: s.source, trip, events, transcript };
}

export function parseDriverTrips(json: unknown): DriverTrips | null {
  const d = json as Record<string, unknown> | null;
  if (!d || typeof d.source !== 'string' || !Array.isArray(d.trips)) return null;
  return { source: d.source, trips: d.trips.map((t) => parseTripRow(t)).filter((t): t is TripRow => !!t) };
}

const base = (u: string) => u.replace(/\/$/, '');

/** Generous timeout: the first query after the SQL warehouse has been idle waits for it to start. */
export async function fetchDriverTrips(o: FetchOptions & { driverId: string; limit?: number }): Promise<DriverTrips | null> {
  try {
    const res = await (o.fetchImpl ?? fetch)(
      `${base(o.baseUrl)}/drivers/${encodeURIComponent(o.driverId)}/trips?limit=${o.limit ?? 5}`,
      { signal: AbortSignal.timeout(o.timeoutMs ?? 40_000) },
    );
    return res.ok ? parseDriverTrips(await res.json()) : null;
  } catch {
    return null;
  }
}

export async function fetchTripSummary(o: FetchOptions & { tripId: string }): Promise<TripSummary | null> {
  try {
    const res = await (o.fetchImpl ?? fetch)(`${base(o.baseUrl)}/trips/${encodeURIComponent(o.tripId)}/summary`, {
      signal: AbortSignal.timeout(o.timeoutMs ?? 40_000),
    });
    return res.ok ? parseTripSummary(await res.json()) : null;
  } catch {
    return null;
  }
}
