/** Client for the cloud service's parent endpoints (README section 9). Never trusts the network: a
 *  malformed response is "bad-response", never odd numbers on screen. */

export type ParentRange = '7d' | '30d' | 'all';
export const RANGES: readonly ParentRange[] = ['7d', '30d', 'all'];

export type Freshness = Readonly<{ source: 'databricks' | 'local'; generatedAt: number }>;

export type ParentSummary = Freshness & Readonly<{
  range: ParentRange;
  trips: number;
  minutes: number;
  distanceMiles: number | null;
  avgSmoothness: number | null;
  firstSmoothness: number | null;
  recentSmoothness: number | null;
  stopCompliancePct: number | null;
  problemEvents: number;
  problemEventsPerTrip: Readonly<Record<string, number>>;
  speedingCount: number;
  tripsWithSpeeding: number;
  crashCandidates: number;
  topIssue: string | null;
  lastTripAt: number | null;
}>;

export type TrendPoint = Readonly<{
  tripNumber: number;
  tripId: string;
  startedAt: number;
  smoothness: number | null;
  stopCompliance: number | null;
  nBadEvents: number;
}>;

export type TripRow = Readonly<{
  tripId: string;
  start: number;
  end: number;
  durationS: number;
  smoothness: number | null;
  stopCompliance: number | null;
  distanceM: number | null;
  nBadEvents: number;
  speedingCount: number;
  hadCrash: boolean;
}>;

export type TripEventRow = Readonly<{
  eventId: string;
  t: number;
  kind: string;
  road: string | null;
  speedMph: number | null;
  limitMph: number | null;
  lat?: number;
  lon?: number;
}>;

export type TripReport = Readonly<{
  headline: string;
  scoreExplanation: string;
  praise: string;
  nextGoal: string;
  topIssues: readonly { eventRef: string; advice: string }[];
}>;

export type TripDetail = Readonly<{
  tripId: string;
  start: number;
  end: number;
  durationS: number;
  smoothness: number | null;
  stopCompliance: number | null;
  distanceMiles: number | null;
  events: readonly TripEventRow[];
  report: TripReport | null;
}>;

export type SpeedingEvent = Readonly<{
  tripId: string;
  t: number;
  road: string | null;
  speedMph: number | null;
  limitMph: number | null;
  overByMph: number | null;
  lat?: number;
  lon?: number;
}>;

export type SpeedingReport = Freshness & Readonly<{
  range: ParentRange;
  totals: Readonly<{
    count: number;
    trips: number;
    tripsWithSpeeding: number;
    sharePctOfTrips: number;
    maxOverByMph: number | null;
    overByBuckets: Readonly<Record<string, number>>;
  }>;
  byRoad: readonly { road: string; count: number; maxOverByMph: number | null }[];
  events: readonly SpeedingEvent[];
}>;

export type ParentFailure = 'unauthorized' | 'not-found' | 'invalid-code' | 'rate-limited' | 'offline' | 'bad-response';
export type ParentResult<T> = { ok: true; data: T } | { ok: false; reason: ParentFailure };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
const range = (v: unknown): ParentRange | null => (v === '7d' || v === '30d' || v === 'all' ? v : null);
const place = (r: Rec): { lat?: number; lon?: number } =>
  num(r.lat) !== null && num(r.lon) !== null ? { lat: r.lat as number, lon: r.lon as number } : {};

function freshness(r: Rec): Freshness | null {
  const generatedAt = num(r.generatedAt);
  return (r.source === 'databricks' || r.source === 'local') && generatedAt !== null ? { source: r.source, generatedAt } : null;
}

export function parseSummary(json: unknown): ParentSummary | null {
  if (!isRec(json)) return null;
  const fresh = freshness(json);
  const r = range(json.range);
  const trips = num(json.trips);
  if (!fresh || !r || trips === null) return null;
  const perTrip = isRec(json.problemEventsPerTrip) ? json.problemEventsPerTrip : {};
  return {
    ...fresh,
    range: r,
    trips,
    minutes: num(json.minutes) ?? 0,
    distanceMiles: num(json.distanceMiles),
    avgSmoothness: num(json.avgSmoothness),
    firstSmoothness: num(json.firstSmoothness),
    recentSmoothness: num(json.recentSmoothness),
    stopCompliancePct: num(json.stopCompliancePct),
    problemEvents: num(json.problemEvents) ?? 0,
    problemEventsPerTrip: Object.fromEntries(Object.entries(perTrip).filter(([, n]) => num(n) !== null)) as Record<string, number>,
    speedingCount: num(json.speedingCount) ?? 0,
    tripsWithSpeeding: num(json.tripsWithSpeeding) ?? 0,
    crashCandidates: num(json.crashCandidates) ?? 0,
    topIssue: str(json.topIssue),
    lastTripAt: num(json.lastTripAt),
  };
}

export function parseTrends(json: unknown): { points: TrendPoint[] } & Freshness | null {
  if (!isRec(json)) return null;
  const fresh = freshness(json);
  if (!fresh || !Array.isArray(json.points)) return null;
  const points = list(json.points).flatMap((p): TrendPoint[] => {
    const tripNumber = num(p.tripNumber);
    const startedAt = num(p.startedAt);
    const tripId = str(p.tripId);
    if (tripNumber === null || startedAt === null || !tripId) return [];
    return [{ tripNumber, tripId, startedAt, smoothness: num(p.smoothness), stopCompliance: num(p.stopCompliance), nBadEvents: num(p.nBadEvents) ?? 0 }];
  });
  return { ...fresh, points };
}

function parseTripRow(t: Rec): TripRow | null {
  const tripId = str(t.tripId);
  const start = num(t.start);
  const end = num(t.end);
  if (!tripId || start === null || end === null) return null;
  return {
    tripId, start, end,
    durationS: num(t.durationS) ?? Math.max(0, Math.round((end - start) / 1000)),
    smoothness: num(t.smoothness),
    stopCompliance: num(t.stopCompliance),
    distanceM: num(t.distanceM),
    nBadEvents: num(t.nBadEvents) ?? 0,
    speedingCount: num(t.speedingCount) ?? 0,
    hadCrash: t.hadCrash === true,
  };
}

export function parseTripPage(json: unknown): { trips: TripRow[]; nextBefore: number | null } & Freshness | null {
  if (!isRec(json)) return null;
  const fresh = freshness(json);
  if (!fresh || !Array.isArray(json.trips)) return null;
  const trips = list(json.trips).flatMap((t) => parseTripRow(t) ?? []);
  return { ...fresh, trips, nextBefore: num(json.nextBefore) };
}

function parseReport(v: unknown): TripReport | null {
  if (!isRec(v)) return null;
  const headline = str(v.headline);
  const scoreExplanation = str(v.scoreExplanation);
  const praise = str(v.praise);
  const nextGoal = str(v.nextGoal);
  if (!headline || !scoreExplanation || !praise || !nextGoal) return null;
  const topIssues = list(v.topIssues).flatMap((i) => {
    const eventRef = str(i.eventRef);
    const advice = str(i.advice);
    return eventRef && advice ? [{ eventRef, advice }] : [];
  });
  return { headline, scoreExplanation, praise, nextGoal, topIssues };
}

export function parseTripDetail(json: unknown): TripDetail | null {
  if (!isRec(json)) return null;
  const tripId = str(json.tripId);
  const start = num(json.start);
  const end = num(json.end);
  if (!tripId || start === null || end === null) return null;
  const scores = isRec(json.scores) ? json.scores : {};
  const events = list(json.events).flatMap((e): TripEventRow[] => {
    const eventId = str(e.eventId);
    const t = num(e.t);
    const kind = str(e.kind);
    if (!eventId || t === null || !kind) return [];
    return [{ eventId, t, kind, road: str(e.road), speedMph: num(e.speedMph), limitMph: num(e.limitMph), ...place(e) }];
  });
  return {
    tripId, start, end,
    durationS: num(json.durationS) ?? Math.max(0, Math.round((end - start) / 1000)),
    smoothness: num(scores.smoothness),
    stopCompliance: num(scores.stopCompliance),
    distanceMiles: num(json.distanceMiles),
    events,
    report: parseReport(json.report),
  };
}

export function parseSpeeding(json: unknown): SpeedingReport | null {
  if (!isRec(json)) return null;
  const fresh = freshness(json);
  const r = range(json.range);
  const totals = isRec(json.totals) ? json.totals : null;
  if (!fresh || !r || !totals || num(totals.count) === null) return null;
  const buckets = isRec(totals.overByBuckets) ? totals.overByBuckets : {};
  return {
    ...fresh,
    range: r,
    totals: {
      count: totals.count as number,
      trips: num(totals.trips) ?? 0,
      tripsWithSpeeding: num(totals.tripsWithSpeeding) ?? 0,
      sharePctOfTrips: num(totals.sharePctOfTrips) ?? 0,
      maxOverByMph: num(totals.maxOverByMph),
      overByBuckets: Object.fromEntries(Object.entries(buckets).filter(([, n]) => num(n) !== null)) as Record<string, number>,
    },
    byRoad: list(json.byRoad).flatMap((x) => {
      const road = str(x.road);
      return road && num(x.count) !== null ? [{ road, count: x.count as number, maxOverByMph: num(x.maxOverByMph) }] : [];
    }),
    events: list(json.events).flatMap((e): SpeedingEvent[] => {
      const tripId = str(e.tripId);
      const t = num(e.t);
      if (!tripId || t === null) return [];
      return [{ tripId, t, road: str(e.road), speedMph: num(e.speedMph), limitMph: num(e.limitMph), overByMph: num(e.overByMph), ...place(e) }];
    }),
  };
}

export type ParentSession = Readonly<{ baseUrl: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number }>;

async function call<T>(
  o: Readonly<{ baseUrl: string; token?: string; fetchImpl?: typeof fetch; timeoutMs?: number }>,
  path: string,
  parse: (json: unknown) => T | null,
  init: Readonly<{ method?: string; body?: unknown }> = {},
): Promise<ParentResult<T>> {
  let res: Response;
  try {
    res = await (o.fetchImpl ?? fetch)(`${o.baseUrl.replace(/\/$/, '')}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(o.timeoutMs ?? 8_000),
    });
  } catch {
    return { ok: false, reason: 'offline' };
  }
  if (res.status === 401) return { ok: false, reason: 'unauthorized' };
  if (res.status === 429) return { ok: false, reason: 'rate-limited' };
  if (res.status === 404) return { ok: false, reason: path === '/parent/link' ? 'invalid-code' : 'not-found' };
  if (!res.ok) return { ok: false, reason: 'bad-response' };
  try {
    const data = parse(await res.json());
    return data === null ? { ok: false, reason: 'bad-response' } : { ok: true, data };
  } catch {
    return { ok: false, reason: 'bad-response' };
  }
}

/** Trade the driver's 6-digit code for a viewer token (shown to the parent once, kept on their phone). */
export function linkWithCode(o: Readonly<{ baseUrl: string; code: string; fetchImpl?: typeof fetch }>) {
  return call(o, '/parent/link', (j) => {
    const token = isRec(j) ? str(j.viewerToken) : null;
    return token && isRec(j) ? { token, driverId: str(j.driverId) ?? '', shareLocation: j.shareLocation === true } : null;
  }, { method: 'POST', body: { code: o.code } });
}

export const fetchSummary = (s: ParentSession, r: ParentRange) => call(s, `/parent/summary?range=${r}`, parseSummary);
export const fetchTrends = (s: ParentSession, r: ParentRange) => call(s, `/parent/trends?range=${r}`, parseTrends);
export const fetchSpeeding = (s: ParentSession, r: ParentRange) => call(s, `/parent/speeding?range=${r}`, parseSpeeding);
export const fetchTrip = (s: ParentSession, tripId: string) => call(s, `/parent/trips/${encodeURIComponent(tripId)}`, parseTripDetail);
export const fetchTrips = (s: ParentSession, o: Readonly<{ limit?: number; before?: number | null }> = {}) =>
  call(s, `/parent/trips?limit=${o.limit ?? 20}${o.before ? `&before=${o.before}` : ''}`, parseTripPage);

/** Driver side: a code to show a parent. Location stays hidden from them unless `shareLocation` is true. */
export function createShareCode(o: Readonly<{ baseUrl: string; driverId: string; shareLocation: boolean; fetchImpl?: typeof fetch }>) {
  return call(o, `/drivers/${encodeURIComponent(o.driverId)}/share-code`, (j) => {
    const code = isRec(j) ? str(j.code) : null;
    const expiresAt = isRec(j) ? num(j.expiresAt) : null;
    return code && expiresAt !== null ? { code, expiresAt } : null;
  }, { method: 'POST', body: { shareLocation: o.shareLocation } });
}

/** Driver side: cut off every linked parent (and any code not yet used). */
export function revokeParents(o: Readonly<{ baseUrl: string; driverId: string; fetchImpl?: typeof fetch }>) {
  return call(o, `/drivers/${encodeURIComponent(o.driverId)}/viewers`, (j) => {
    const revoked = isRec(j) ? num(j.revoked) : null;
    return revoked === null ? null : { revoked };
  }, { method: 'DELETE' });
}
