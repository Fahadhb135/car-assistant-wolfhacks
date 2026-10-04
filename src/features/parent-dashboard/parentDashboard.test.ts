import { describe, expect, it, vi } from 'vitest';

import type { ParentResult } from '../../integrations/backend/parentClient';
import {
  formatAgo, formatDistanceM, formatEventClock, formatMiles, formatMinutes, formatOverBy, formatPercent,
  formatScore, formatWhen, issueLabel, trendOf, trendSentence,
} from './format';
import { failureMessage, loadWithFallback, type ResourceCache } from './loadWithFallback';

describe('format', () => {
  it('says "not recorded" for missing distance, never 0 mi', () => {
    expect(formatMiles(null)).toBe('Not recorded');
    expect(formatDistanceM(null)).toBe('Not recorded');
    expect(formatMiles(6)).toBe('6.0 mi');
    expect(formatDistanceM(1609.344)).toBe('1.0 mi');
  });

  it('formats durations, scores and percentages', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(135)).toBe('2 h 15 min');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(74.6)).toBe('75%');
    expect(formatScore(null)).toBe('—');
    expect(formatScore(82.4)).toBe('82');
    expect(formatEventClock(125_900)).toBe('2:05');
  });

  it('labels problem kinds in plain language and survives unknown kinds', () => {
    expect(issueLabel('rolling_stop')).toBe('Rolling through stop signs');
    expect(issueLabel('traffic_light_ahead')).toBe('Traffic light ahead');
  });

  it('describes how old data is', () => {
    const now = 10 * 86_400_000;
    expect(formatAgo(now - 30_000, now)).toBe('just now');
    expect(formatAgo(now - 20 * 60_000, now)).toBe('20 min ago');
    expect(formatAgo(now - 5 * 3_600_000, now)).toBe('5 h ago');
    expect(formatAgo(now - 86_400_000, now)).toBe('yesterday');
    expect(formatAgo(now - 3 * 86_400_000, now)).toBe('3 days ago');
  });

  it('names the day relative to now', () => {
    const noon = new Date(2026, 9, 14, 16, 5).getTime();
    expect(formatWhen(noon, noon + 3_600_000)).toBe('Today 4:05 PM');
    expect(formatWhen(noon, noon + 86_400_000)).toBe('Yesterday 4:05 PM');
    expect(formatWhen(noon, noon + 5 * 86_400_000)).toBe('Wed Oct 14, 4:05 PM');
  });

  it('calls a trend only when the move is bigger than noise', () => {
    expect(trendOf(70, 90, 8)).toBe('up');
    expect(trendOf(90, 70, 8)).toBe('down');
    expect(trendOf(80, 81, 8)).toBe('flat');
    expect(trendOf(80, 90, 1)).toBe('unknown');
    expect(trendOf(null, 90, 5)).toBe('unknown');
    expect(trendSentence('up', 70, 90)).toContain('Smoother');
    expect(trendSentence('unknown', null, null)).toContain('Not enough');
  });

  it('phrases speeding with and without recorded speeds', () => {
    expect(formatOverBy(14.7)).toBe('15 mph over');
    expect(formatOverBy(null)).toBe('Speed not recorded');
  });
});

describe('loadWithFallback', () => {
  const ok = <T>(data: T): ParentResult<T> => ({ ok: true, data });
  const fail = (reason: 'offline' | 'unauthorized' | 'bad-response' | 'not-found'): ParentResult<never> => ({ ok: false, reason });

  it('returns fresh data and remembers it', async () => {
    const cache: ResourceCache = new Map();
    const r = await loadWithFallback(cache, 'summary', async () => ok({ trips: 3 }), () => 1_000);
    expect(r).toEqual({ status: 'ready', data: { trips: 3 }, savedAt: 1_000, stale: false });
    expect(cache.get('summary')?.savedAt).toBe(1_000);
  });

  it('shows the last good copy, marked stale, when the network is down', async () => {
    const cache: ResourceCache = new Map();
    await loadWithFallback(cache, 'summary', async () => ok({ trips: 3 }), () => 1_000);
    const r = await loadWithFallback(cache, 'summary', async () => fail('offline'), () => 5_000);
    expect(r).toEqual({ status: 'ready', data: { trips: 3 }, savedAt: 1_000, stale: true, failure: 'offline' });
  });

  it('is an error when there is nothing cached yet', async () => {
    expect(await loadWithFallback(new Map(), 'x', async () => fail('offline'))).toEqual({ status: 'error', failure: 'offline' });
  });

  it('never hides a revoked token behind old data, and forgets everything', async () => {
    const cache: ResourceCache = new Map();
    await loadWithFallback(cache, 'summary', async () => ok({ trips: 3 }));
    await loadWithFallback(cache, 'speeding', async () => ok({ count: 1 }));
    const r = await loadWithFallback(cache, 'summary', async () => fail('unauthorized'));
    expect(r).toEqual({ status: 'error', failure: 'unauthorized' });
    expect(cache.size).toBe(0);
  });

  it('does not show one trip as the answer for a drive that is gone', async () => {
    const cache: ResourceCache = new Map();
    await loadWithFallback(cache, 'trip:a', async () => ok({ id: 'a' }));
    const r = await loadWithFallback(cache, 'trip:a', async () => fail('not-found'));
    expect(r).toEqual({ status: 'error', failure: 'not-found' });
  });

  it('calls the fetcher once per load', async () => {
    const fetcher = vi.fn(async () => ok(1));
    await loadWithFallback(new Map(), 'k', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('has a message for every failure', () => {
    for (const f of ['unauthorized', 'offline', 'not-found', 'rate-limited', 'invalid-code', 'bad-response'] as const) {
      expect(failureMessage(f).length).toBeGreaterThan(10);
    }
  });
});
