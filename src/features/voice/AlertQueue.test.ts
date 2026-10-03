import { describe, expect, it } from 'vitest';
import { AlertQueue } from './AlertQueue';
import { alertFromEvent, coachingTipAlert } from './phrases';
import { ev } from './testing';

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

  it('drops stale alerts instead of speaking them late', () => {
    const q = new AlertQueue();
    q.enqueue(stopAhead(0), 0);
    expect(q.next(3500, { allowTips: true })).toBeUndefined();
  });

  it('withholds tips when not allowed but keeps them queued', () => {
    const q = new AlertQueue();
    q.enqueue(coachingTipAlert('t', 'hi', 0), 0);
    expect(q.next(0, { allowTips: false })).toBeUndefined();
    expect(q.size()).toBe(1);
    expect(q.next(0, { allowTips: true })?.kind).toBe('coaching_tip');
  });
});
