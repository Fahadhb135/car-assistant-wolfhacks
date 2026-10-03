import { describe, expect, it, vi } from 'vitest';
import { getReport, parseReport } from './reports';

const remote = { headline: 'Remote', scoreExplanation: 's', topIssues: [{ eventRef: 'e1', advice: 'a' }], praise: 'p', nextGoal: 'g' };
const ok = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, json: async () => body });

describe('getReport', () => {
  it('uses the cloud report when available', async () => {
    const r = await getReport({ baseUrl: 'http://x', tripId: 'demo-maya-12', fetchImpl: ok(remote) as never });
    expect(r).toMatchObject({ source: 'cloud', report: { headline: 'Remote' } });
  });

  it('falls back to the bundled report when offline, for known demo trips', async () => {
    const r = await getReport({ baseUrl: 'http://x', tripId: 'demo-maya-12', fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) as never });
    expect(r?.source).toBe('bundled');
    expect(r?.report.headline.length).toBeGreaterThan(0);
    const first = await getReport({ baseUrl: 'http://x', tripId: 'demo-maya-01', fetchImpl: vi.fn().mockResolvedValue({ ok: false }) as never });
    expect(first?.source).toBe('bundled');
  });

  it('falls back when the cloud sends a malformed report', async () => {
    const r = await getReport({ baseUrl: 'http://x', tripId: 'demo-maya-01', fetchImpl: ok({ headline: '' }) as never });
    expect(r?.source).toBe('bundled');
  });

  it('returns null for an unknown trip when offline', async () => {
    expect(await getReport({ baseUrl: 'http://x', tripId: 'someone-else', fetchImpl: vi.fn().mockRejectedValue(new Error('x')) as never })).toBeNull();
  });

  it('url-encodes the trip id', async () => {
    const f = ok(remote);
    await getReport({ baseUrl: 'http://x', tripId: 'a/b', fetchImpl: f as never });
    expect(f.mock.calls[0]![0]).toBe('http://x/trips/a%2Fb/report');
  });
});

describe('parseReport', () => {
  it('drops malformed issues but keeps a valid report', () => {
    const r = parseReport({ ...remote, topIssues: [{ eventRef: 'e1', advice: 'a' }, { eventRef: 1 }, null] });
    expect(r?.topIssues).toHaveLength(1);
  });
  it('rejects non-reports', () => {
    expect(parseReport(null)).toBeNull();
    expect(parseReport({ ...remote, topIssues: 'x' })).toBeNull();
  });
});
