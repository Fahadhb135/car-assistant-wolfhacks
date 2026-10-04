import { describe, expect, it } from 'vitest';
import { AlertQueue } from './AlertQueue';
import { alertFromEvent, coachingTipAlert } from './phrases';
import { ev } from './testing';
import type { Alert, SpokenStream } from './types';

const stopAhead = (t: number) => alertFromEvent(ev({ kind: 'stop_sign_ahead', severity: 'info', distanceM: 50 }, t))!;

describe('AlertQueue', () => {
  it('returns highest priority first', () => {
    const q = new AlertQueue();
    q.enqueue(coachingTipAlert('t', 'hi', 0), 0);
    q.enqueue(alertFromEvent(ev({ kind: 'erratic_driving', severity: 'warn', score: 1 }, 0))!, 0);
    q.enqueue(alertFromEvent(ev({ kind: 'crash', severity: 'critical', confirmed: false }, 0))!, 0);
    expect(q.next(0, { allowTips: true })?.kind).toBe('crash');
    expect(q.next(0, { allowTips: true })?.kind).toBe('erratic_driving');
    expect(q.next(0, { allowTips: true })?.kind).toBe('coaching_tip');
  });

  it('rate-limits repeats of the same kind within the cooldown', () => {
    const q = new AlertQueue();
    expect(q.enqueue(stopAhead(0), 0)).toBe('queued');
    expect(q.enqueue(stopAhead(1000), 1000)).toBe('rate_limited');
    expect(q.enqueue(stopAhead(9000), 9000)).toBe('queued');
  });

  it('announces a different stop sign even inside the cooldown', () => {
    const q = new AlertQueue();
    const sign = (featureId: number, t: number) =>
      alertFromEvent(ev({ kind: 'stop_sign_ahead', severity: 'info', distanceM: 120, featureId }, t))!;
    expect(q.enqueue(sign(1, 0), 0)).toBe('queued');
    expect(q.enqueue(sign(2, 0), 0)).toBe('queued');
    expect(q.enqueue(sign(1, 1000), 1000)).toBe('rate_limited');
  });

  it('announces a different hotspot even inside the cooldown', () => {
    const q = new AlertQueue();
    const spot = (cell: string, t: number) =>
      alertFromEvent(ev({ kind: 'hotspot_ahead', severity: 'info', distanceM: 240, cell, topKind: 'ran_stop', drivers: 3, demo: false }, t))!;
    expect(q.enqueue(spot('a', 0), 0)).toBe('queued');
    expect(q.enqueue(spot('b', 2000), 2000)).toBe('queued');
  });

  it('keeps an alert waiting behind one clip, but drops it once stale', () => {
    const q = new AlertQueue();
    q.enqueue(stopAhead(0), 0);
    expect(q.next(3500, { allowTips: true })?.kind).toBe('stop_sign_ahead');
    q.enqueue(stopAhead(10_000), 10_000);
    expect(q.next(16_500, { allowTips: true })).toBeUndefined();
  });

  it('releases queued streamed work removed below a crash priority', () => {
    const q = new AlertQueue();
    let cancelled = false;
    const stream: SpokenStream = {
      segments: (async function* () { yield { text: 'later' }; })(),
      cancel: () => { cancelled = true; },
    };
    const chat: Alert = {
      id: 'chat',
      kind: 'chat_reply',
      priority: 30,
      utterance: { text: 'fallback', stream },
      createdAt: 0,
      ttlMs: 1_000,
    };
    q.enqueue(chat, 0);
    q.removeBelowPriority(100);
    expect(q.size()).toBe(0);
    expect(cancelled).toBe(true);
  });

  it('withholds tips when not allowed but keeps them queued', () => {
    const q = new AlertQueue();
    q.enqueue(coachingTipAlert('t', 'hi', 0), 0);
    expect(q.next(0, { allowTips: false })).toBeUndefined();
    expect(q.size()).toBe(1);
    expect(q.next(0, { allowTips: true })?.kind).toBe('coaching_tip');
  });
});
