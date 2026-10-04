/** What the phone sends with a notable moment; the cloud adds the driver's Databricks history. */
export type CoachRequestBody = Readonly<{
  driverId: string;
  trigger: string;
  spokenAlert?: string;
  lat?: number;
  lon?: number;
  speedKmh?: number;
  limitKmh?: number;
  road?: string;
  recentEvents: readonly string[];
  elapsedMin?: number;
  smoothness?: number;
}>;

type FetchOptions = Readonly<{ baseUrl: string; timeoutMs?: number; fetchImpl?: typeof fetch }>;

const url = (base: string, path: string) => `${base.replace(/\/$/, '')}${path}`;

/** One live coaching line from Gemini, or null on any failure (the drive just stays quiet). */
export async function requestCoachLine(o: FetchOptions & { body: CoachRequestBody }): Promise<string | null> {
  try {
    const res = await (o.fetchImpl ?? fetch)(url(o.baseUrl, '/coach'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o.body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 4_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { text?: unknown };
    return typeof json.text === 'string' && json.text.trim() ? json.text.trim() : null;
  } catch {
    return null;
  }
}

/** The driver's history as Databricks computed it (local trips fill gaps on the server). */
export type DriverStats = Readonly<{
  trips: number;
  avgSmoothness: number | null;
  firstSmoothness: number | null;
  recentSmoothness: number | null;
  perTripFirst: Readonly<Record<string, number>>;
  perTripRecent: Readonly<Record<string, number>>;
  topIssue: string | null;
}>;

export type DriverStatsResult = Readonly<{ source: string; stats: DriverStats | null }>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rates = (v: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).filter(([, n]) => num(n) !== null)) as Record<string, number>;

/** Never trusts the network: malformed stats become null rather than odd numbers on screen. */
export function parseDriverStats(json: unknown): DriverStatsResult | null {
  const body = json as { source?: unknown; stats?: Record<string, unknown> | null } | null;
  if (!body || typeof body.source !== 'string') return null;
  const s = body.stats;
  if (!s || num(s.trips) === null) return { source: body.source, stats: null };
  return {
    source: body.source,
    stats: {
      trips: s.trips as number,
      avgSmoothness: num(s.avgSmoothness),
      firstSmoothness: num(s.firstSmoothness),
      recentSmoothness: num(s.recentSmoothness),
      perTripFirst: rates(s.perTripFirst),
      perTripRecent: rates(s.perTripRecent),
      topIssue: typeof s.topIssue === 'string' ? s.topIssue : null,
    },
  };
}

export async function fetchDriverStats(o: FetchOptions & { driverId: string }): Promise<DriverStatsResult | null> {
  try {
    const res = await (o.fetchImpl ?? fetch)(url(o.baseUrl, `/drivers/${encodeURIComponent(o.driverId)}/stats`), {
      signal: AbortSignal.timeout(o.timeoutMs ?? 5_000),
    });
    return res.ok ? parseDriverStats(await res.json()) : null;
  } catch {
    return null;
  }
}
