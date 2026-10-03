import { describe, expect, it, vi } from 'vitest';
import { fetchHotspots, parseSnapshot } from './hotspotsClient';

const good = {
  source: 'databricks', generatedAt: 5, demo: false,
  hotspots: [{ cell: 'c', lat: 1, lon: 2, bad: 3, trips: 2, drivers: 2, byKind: { ran_stop: 3 }, topKind: 'ran_stop' }],
};

describe('hotspots client', () => {
  it('parses a good snapshot and drops malformed hotspots instead of speaking them', () => {
    const s = parseSnapshot({ ...good, hotspots: [...good.hotspots, { cell: 'bad' }, { ...good.hotspots[0], topKind: 'crash' }] });
    expect(s?.hotspots).toHaveLength(1);
    expect(s?.source).toBe('databricks');
  });

  it('rejects non-snapshots', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ hotspots: 'x', generatedAt: 1 })).toBeNull();
    expect(parseSnapshot({ hotspots: [] })).toBeNull();
  });

  it('requests the area and returns the snapshot', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => good });
    const s = await fetchHotspots({ baseUrl: 'http://x', lat: 35.78, lon: -78.63, radiusM: 3000, fetchImpl: f as never });
    expect(f.mock.calls[0]![0]).toBe('http://x/hotspots?lat=35.78&lon=-78.63&radiusM=3000');
    expect(s?.hotspots).toHaveLength(1);
  });

  it('returns null on HTTP error or network failure so the drive just goes on without hotspots', async () => {
    expect(await fetchHotspots({ baseUrl: 'http://x', lat: 0, lon: 0, fetchImpl: vi.fn().mockResolvedValue({ ok: false }) as never })).toBeNull();
    expect(await fetchHotspots({ baseUrl: 'http://x', lat: 0, lon: 0, fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) as never })).toBeNull();
  });
});
