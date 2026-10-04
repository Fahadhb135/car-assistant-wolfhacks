import { describe, expect, it, vi } from 'vitest';

import {
  fetchSpeeding,
  fetchSummary,
  fetchTrip,
  fetchTrips,
  parseSpeeding,
  parseSummary,
  parseTrends,
  parseTripDetail,
  parseTripPage,
} from './parentClient';

const FRESH = { source: 'local', generatedAt: 1_000 };
const SUMMARY = {
  ...FRESH, range: '30d', trips: 3, minutes: 60, distanceMiles: 6, avgSmoothness: 80, firstSmoothness: 70,
  recentSmoothness: 90, stopCompliancePct: 75, problemEvents: 3, problemEventsPerTrip: { rolling_stop: 0.7 },
  speedingCount: 2, tripsWithSpeeding: 1, crashCandidates: 0, topIssue: 'rolling_stop', lastTripAt: 5,
};

function reply(status: number, body?: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as typeof fetch;
}

const session = (fetchImpl: typeof fetch) => ({ baseUrl: 'http://cloud/', driverId: 'maya', fetchImpl });

describe('parsers never trust the network', () => {
  it('reads a good summary and rejects one with no freshness, range or trip count', () => {
    expect(parseSummary(SUMMARY)?.topIssue).toBe('rolling_stop');
    expect(parseSummary({ ...SUMMARY, source: 'cache' })).toBeNull();
    expect(parseSummary({ ...SUMMARY, range: '1y' })).toBeNull();
    expect(parseSummary({ ...SUMMARY, trips: 'three' })).toBeNull();
    expect(parseSummary(null)).toBeNull();
    expect(parseSummary([])).toBeNull();
  });

  it('turns odd numbers into null instead of showing them', () => {
    const s = parseSummary({ ...SUMMARY, avgSmoothness: 'high', distanceMiles: Infinity, topIssue: '', problemEventsPerTrip: { a: 1, b: 'x' } });
    expect(s).toMatchObject({ avgSmoothness: null, distanceMiles: null, topIssue: null, problemEventsPerTrip: { a: 1 } });
  });

  it('keeps good trend points and drops broken ones', () => {
    const t = parseTrends({ ...FRESH, points: [{ tripNumber: 1, tripId: 'a', startedAt: 5, smoothness: 80, stopCompliance: null, nBadEvents: 1 }, { tripNumber: 2 }, 'x'] });
    expect(t?.points.map((p) => p.tripId)).toEqual(['a']);
    expect(parseTrends({ ...FRESH, points: 'nope' })).toBeNull();
  });

  it('parses a trip page with its cursor', () => {
    const page = parseTripPage({ ...FRESH, nextBefore: 99, trips: [{ tripId: 'a', start: 1_000, end: 61_000, smoothness: 90, hadCrash: true }, { start: 1 }] });
    expect(page?.nextBefore).toBe(99);
    expect(page?.trips).toEqual([expect.objectContaining({ tripId: 'a', durationS: 60, hadCrash: true, speedingCount: 0, distanceM: null })]);
  });

  it('parses trip detail, keeps location only when the server sent it, and tolerates a missing report', () => {
    const detail = parseTripDetail({
      tripId: 't', start: 1, end: 2, durationS: 0, scores: { smoothness: 85 }, distanceMiles: 2,
      events: [{ eventId: 'e1', t: 5, kind: 'speeding', road: 'Main St', speedMph: 45, limitMph: 30, lat: 1, lon: 2 }, { eventId: 'e2', t: 6, kind: 'rolling_stop' }, { kind: 'x' }],
      report: { headline: 'h' },
    });
    expect(detail?.report).toBeNull();
    expect(detail?.events).toHaveLength(2);
    expect(detail?.events[0]).toMatchObject({ lat: 1, lon: 2 });
    expect(detail?.events[1]).not.toHaveProperty('lat');
  });

  it('parses the speeding report', () => {
    const r = parseSpeeding({
      ...FRESH, range: '7d',
      totals: { count: 2, trips: 4, tripsWithSpeeding: 1, sharePctOfTrips: 25, maxOverByMph: 15, overByBuckets: { '5+': 2, '10+': 1 } },
      byRoad: [{ road: 'Main St', count: 2, maxOverByMph: 15 }, { count: 1 }],
      events: [{ tripId: 'a', t: 1, road: null, speedMph: 45, limitMph: 30, overByMph: 15 }, { t: 1 }],
    });
    expect(r?.byRoad).toHaveLength(1);
    expect(r?.events).toHaveLength(1);
    expect(r?.totals.overByBuckets).toEqual({ '5+': 2, '10+': 1 });
    expect(parseSpeeding({ ...FRESH, range: '7d' })).toBeNull();
  });
});

describe('requests', () => {
  const urlOf = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;

  it('asks for this phone’s driver, with no credentials, and trims the base url', async () => {
    const f = reply(200, SUMMARY);
    const result = await fetchSummary(session(f), '7d');
    expect(result.ok).toBe(true);
    expect(urlOf(f)).toBe('http://cloud/drivers/maya/summary?range=7d');
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.headers).toBeUndefined();
  });

  it('encodes the driver id and trip id', async () => {
    const f = reply(404);
    await fetchTrip({ baseUrl: 'http://cloud', driverId: 'anon 1/x', fetchImpl: f }, 'a/b c');
    expect(urlOf(f)).toBe('http://cloud/drivers/anon%201%2Fx/trips/a%2Fb%20c');
  });

  it('pages trips with a cursor, and limit 1 is the home screen’s last drive', async () => {
    const f = reply(200, { ...FRESH, trips: [], nextBefore: null });
    await fetchTrips(session(f), { limit: 5, before: 42 });
    expect(urlOf(f)).toBe('http://cloud/drivers/maya/trips?limit=5&before=42');
    const g = reply(200, { ...FRESH, trips: [{ tripId: 'last', start: 1_000, end: 61_000, smoothness: 88 }], nextBefore: null });
    const last = await fetchTrips(session(g), { limit: 1 });
    expect(urlOf(g)).toBe('http://cloud/drivers/maya/trips?limit=1');
    expect(last.ok && last.data.trips[0]).toMatchObject({ tripId: 'last', smoothness: 88 });
  });

  it('maps failures so the screen can say the right thing', async () => {
    expect(await fetchSummary(session(reply(500)), '30d')).toEqual({ ok: false, reason: 'bad-response' });
    expect(await fetchSummary(session(reply(200, { nonsense: true })), '30d')).toEqual({ ok: false, reason: 'bad-response' });
    expect(await fetchTrip(session(reply(404)), 'x')).toEqual({ ok: false, reason: 'not-found' });
    const down = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await fetchSpeeding(session(down), 'all')).toEqual({ ok: false, reason: 'offline' });
    const badJson = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }) as unknown as typeof fetch;
    expect(await fetchSummary(session(badJson), '30d')).toEqual({ ok: false, reason: 'bad-response' });
  });
});
