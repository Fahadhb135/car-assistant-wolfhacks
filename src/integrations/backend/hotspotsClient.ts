import type { Hotspot, HotspotSnapshot } from '../../core/coaching/hotspots';

const KINDS = new Set(['rolling_stop', 'ran_stop', 'erratic_driving']);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseHotspot(v: unknown): Hotspot | null {
  const h = v as Partial<Hotspot> | null;
  if (!h || typeof h.cell !== 'string' || !isNum(h.lat) || !isNum(h.lon)) return null;
  if (!isNum(h.bad) || !isNum(h.trips) || !isNum(h.drivers) || !KINDS.has(h.topKind as string)) return null;
  return { ...(h as Hotspot), demo: h.demo === true };
}

/** Never trusts the network: anything malformed is dropped rather than spoken. */
export function parseSnapshot(json: unknown): HotspotSnapshot | null {
  const s = json as Partial<HotspotSnapshot> | null;
  if (!s || !Array.isArray(s.hotspots) || !isNum(s.generatedAt)) return null;
  return {
    source: typeof s.source === 'string' ? s.source : 'unknown',
    generatedAt: s.generatedAt,
    demo: s.demo === true,
    hotspots: s.hotspots.map(parseHotspot).filter((h): h is Hotspot => h !== null),
  };
}

export type FetchHotspotsOptions = {
  baseUrl: string;
  lat: number;
  lon: number;
  radiusM?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** Fetch crowd hotspots near a point, once at trip start. Returns null on any failure: the
 *  drive simply goes ahead without hotspot warnings. */
export async function fetchHotspots(o: FetchHotspotsOptions): Promise<HotspotSnapshot | null> {
  const { baseUrl, lat, lon, radiusM = 5000, timeoutMs = 5000 } = o;
  try {
    const res = await (o.fetchImpl ?? fetch)(
      `${baseUrl}/hotspots?lat=${lat}&lon=${lon}&radiusM=${radiusM}`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    return res.ok ? parseSnapshot(await res.json()) : null;
  } catch {
    return null;
  }
}
