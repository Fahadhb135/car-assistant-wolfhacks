import { describe, expect, it, vi } from 'vitest';

import type { CoachRequestBody } from '../../integrations/backend/coachClient';
import { parseDriverStats } from '../../integrations/backend/coachClient';
import { ev, flush } from '../voice/testing';
import { DriveContext } from './DriveContext';
import { LiveCoach } from './LiveCoach';
import { historyLine, scoreSummary } from './useDriveCoaching';

const fix = (t: number, speed = 11) => ({ lat: 35.7847, lon: -78.6329, t, speed, heading: 0 });

function setup(reply: string | null = 'You stopped fully where most drivers roll it.') {
  let now = 100_000;
  const context = new DriveContext();
  const request = vi.fn(async (_body: CoachRequestBody) => reply);
  const speak = vi.fn();
  const coach = new LiveCoach({
    driverId: 'demo-maya', context, request, speak, startedAt: 0, now: () => now,
    recentEvents: () => [ev({ kind: 'hard_braking', severity: 'warn', score: 0.6, evidence: {} }, 1)],
    smoothness: () => 95,
  });
  return { coach, context, request, speak, advance: (ms: number) => { now += ms; } };
}

describe('LiveCoach', () => {
  it('sends Gemini the moment with location, speed, limit, road and trip context, then speaks the reply', async () => {
    const { coach, context, request, speak } = setup();
    context.updateFix(fix(1), 11.2, 'Wilmington St');
    coach.onEvent(ev({ kind: 'stop_ok', severity: 'info' }, 2));
    await flush();
    const body = request.mock.calls[0]![0];
    expect(body).toMatchObject({
      driverId: 'demo-maya', trigger: 'The driver stopped correctly at a stop sign.', spokenAlert: 'Nice stop.',
      lat: 35.7847, lon: -78.6329, road: 'Wilmington St', smoothness: 95,
    });
    expect(body.speedKmh).toBeCloseTo(39.6);
    expect(body.limitKmh).toBeCloseTo(40.32);
    expect(body.recentEvents).toEqual(['A firm-braking candidate was flagged (score 0.60).']);
    expect(speak).toHaveBeenCalledWith('coach-1', 'You stopped fully where most drivers roll it.');
    expect(context.transcript()).toEqual([{ t: 100_000, role: 'assistant', text: 'You stopped fully where most drivers roll it.' }]);
  });

  it('ignores approach warnings and crashes, and throttles remarks', async () => {
    const { coach, request, advance } = setup();
    coach.onEvent(ev({ kind: 'stop_sign_ahead', severity: 'info', distanceM: 150 }, 1));
    coach.onEvent(ev({ kind: 'crash', severity: 'critical', confirmed: false }, 1));
    expect(request).not.toHaveBeenCalled();
    coach.onEvent(ev({ kind: 'rolling_stop', severity: 'warn' }, 2));
    await flush();
    coach.onEvent(ev({ kind: 'ran_stop', severity: 'warn' }, 3)); // inside the 45 s window
    advance(46_000);
    coach.onEvent(ev({ kind: 'speeding', severity: 'warn', speedMps: 20, limitMps: 15 }, 4));
    await flush();
    expect(request.mock.calls.map((c) => c[0].trigger)).toEqual([
      'The driver rolled through a stop sign.',
      'The driver was speeding (45 mph in a 34 mph zone).',
    ]);
  });

  it('stays quiet when Gemini has nothing', async () => {
    const { coach, speak } = setup(null);
    coach.onEvent(ev({ kind: 'stop_ok', severity: 'info' }, 1));
    await flush();
    expect(speak).not.toHaveBeenCalled();
  });
});

describe('DriveContext', () => {
  it('stamps each event with where the car was when it happened', () => {
    const c = new DriveContext();
    const early = ev({ kind: 'hard_braking', severity: 'warn', score: 1, evidence: {} }, 1);
    c.stamp(early); // before any fix: nothing to stamp
    c.updateFix(fix(5, 13), 15.6, 'I-40');
    const e = ev({ kind: 'rolling_stop', severity: 'warn' }, 5);
    c.stamp(e);
    c.updateFix({ ...fix(6), lat: 36 });
    c.stamp(e); // first stamp wins
    expect(c.stampFor(early.eventId)).toBeUndefined();
    expect(c.stampFor(e.eventId)).toEqual({ lat: 35.7847, lon: -78.6329, speedMps: 13, limitMps: 15.6, road: 'I-40' });
  });
});

describe('driver score', () => {
  it('parses Databricks stats defensively and describes them', () => {
    const r = parseDriverStats({ source: 'databricks', stats: {
      trips: 12, avgSmoothness: 78.3, firstSmoothness: 68.6, recentSmoothness: 87.5,
      perTripFirst: { rolling_stop: 1.3, bogus: 'x' }, perTripRecent: {}, topIssue: 'rolling_stop' } });
    expect(r?.stats?.perTripFirst).toEqual({ rolling_stop: 1.3 });
    expect(historyLine(r)).toBe('12 past trips · usual 78 · last 3: 88 (Databricks)');
    expect(historyLine(parseDriverStats({ source: 'local', stats: null }))).toBe(
      'First recorded drive. Your history builds up in Databricks.');
    expect(parseDriverStats({ nope: 1 })).toBeNull();
    expect(historyLine(null)).toBeNull();
  });

  it('words the live trip score', () => {
    expect(scoreSummary(100).label).toBe('Smooth driving');
    expect(scoreSummary(75).label).toBe('Mostly smooth');
    expect(scoreSummary(40).label).toBe('Take it easy');
  });
});
