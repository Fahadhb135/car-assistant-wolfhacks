import { describe, expect, it } from 'vitest';
import type { DriveEvent } from '../../core/events/types';
import { PHRASES } from '../voice/phrases';
import type { Speaker } from '../voice/types';
import { VoiceCoordinator } from '../voice/VoiceCoordinator';
import { CLEAR_ROAD, coachMessage } from './coachMessage';
import { createReplaySession } from './createReplaySession';
import { DriveSession } from './DriveSession';
import { DEMO_ROUTE, replayFixes } from './replayRoute';

/** Replays the whole demo drive through the real coach, hotspots and voice queue. */
async function replay() {
  const events: DriveEvent[] = [];
  const spoken: { text: string; atMeters: number }[] = [];
  let now = 0;
  let meters = 0;
  const speaker: Speaker = { speak: async (u) => void spoken.push({ text: u.text, atMeters: meters }) };
  const voice = new VoiceCoordinator({
    speaker,
    live: { isActive: () => false, pause() {}, resume() {}, end() {} },
    now: () => now,
  });
  const session = createReplaySession(voice, (e) => events.push(e));
  const speed = DEMO_ROUTE.speedMph * 0.44704;
  for (const fix of replayFixes(DEMO_ROUTE)) {
    now = fix.t;
    meters = Math.round((fix.t / 1000) * speed);
    await session.onFix(fix);
    await Promise.resolve();
    await Promise.resolve(); // let the voice queue run
  }
  return { events, spoken };
}

describe('replay of the demo route (offline, real map data, bundled hotspots)', () => {
  it('produces ordered events with unique ids', async () => {
    const { events } = await replay();
    expect(events.length).toBeGreaterThan(3);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(events.length);
    expect(events.map((e) => e.t)).toEqual([...events.map((e) => e.t)].sort((a, b) => a - b));
  });

  it('warns about both crowd hotspots exactly once each, rolling stop first then the run-through', async () => {
    const { events } = await replay();
    const hot = events.filter((e) => e.kind === 'hotspot_ahead');
    expect(hot.map((e) => (e.kind === 'hotspot_ahead' ? e.topKind : ''))).toEqual(['rolling_stop', 'ran_stop']);
    for (const h of hot) {
      expect(h.kind === 'hotspot_ahead' && h.demo).toBe(true); // demo data is labelled as such
      expect(h.kind === 'hotspot_ahead' && h.distanceM).toBeLessThanOrEqual(250);
    }
  });

  it('speaks each hotspot warning well before the stop-sign alert at that intersection', async () => {
    const { events, spoken } = await replay();
    const hotspotAt = (kind: 'rolling_stop' | 'ran_stop') =>
      events.find((e) => e.kind === 'hotspot_ahead' && e.topKind === kind)!.t;
    const signFor = (id: number) => events.find((e) => e.kind === 'stop_sign_ahead' && e.featureId === id)!.t;
    expect(hotspotAt('rolling_stop')).toBeLessThan(signFor(195438853)); // the real sign at hotspot B
    expect(hotspotAt('ran_stop')).toBeLessThan(signFor(195438854)); // the real sign at hotspot C
    // ...and they were actually spoken, in that order
    const texts = spoken.map((s) => s.text);
    const iHot = texts.indexOf(PHRASES.hotspot_rolling);
    expect(iHot).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf(PHRASES.hotspot_ran)).toBeGreaterThan(iHot);
    expect(texts.filter((t) => t === PHRASES.hotspot_rolling)).toHaveLength(1);
  });

  it('speaks stop-sign alerts and never speaks silent events', async () => {
    const { spoken } = await replay();
    expect(spoken.filter((s) => s.text === PHRASES.stop_sign_ahead).length).toBeGreaterThanOrEqual(3);
    expect(spoken.every((s) => s.text.length > 0)).toBe(true);
  });
});

describe('DriveSession', () => {
  it('works without hotspot data (cloud unreachable)', async () => {
    const events: DriveEvent[] = [];
    const base = createReplaySession({ handleEvent() {} });
    expect(base).toBeInstanceOf(DriveSession);
    const session = new DriveSession({
      coach: { update: () => [] },
      tiles: { update: async () => {}, featuresAhead: () => [], roadsNear: () => [] },
      hotspots: null,
      voice: { handleEvent: (e) => void events.push(e) },
    });
    expect(await session.onFix({ lat: 1, lon: 1, heading: 0, speed: 5, t: 0 })).toEqual([]);
    expect(events).toEqual([]);
  });
});

describe('coachMessage', () => {
  const base = { eventId: 'e', t: 0 };
  it('has a message for every event kind, with numbers where useful', () => {
    const all: DriveEvent[] = [
      { ...base, kind: 'crash', severity: 'critical', confirmed: false },
      { ...base, kind: 'erratic_driving', severity: 'warn', score: 0.8 },
      { ...base, kind: 'stop_sign_ahead', severity: 'info', distanceM: 143.6 },
      { ...base, kind: 'traffic_light_ahead', severity: 'info', distanceM: 90 },
      { ...base, kind: 'stop_ok', severity: 'info' },
      { ...base, kind: 'rolling_stop', severity: 'warn' },
      { ...base, kind: 'ran_stop', severity: 'warn' },
      { ...base, kind: 'hotspot_ahead', severity: 'info', distanceM: 240, cell: 'c', topKind: 'ran_stop', drivers: 4, demo: false },
      { ...base, kind: 'highway_entering', severity: 'warn', speedMps: 20, targetSpeedMps: 26.8, targetIsDefault: false, advice: 'speed_up' },
      { ...base, kind: 'highway_exiting', severity: 'warn', speedMps: 31, targetSpeedMps: 17.9, targetIsDefault: true, advice: 'slow_down' },
    ];
    for (const e of all) {
      const m = coachMessage(e);
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.detail.length).toBeGreaterThan(0);
    }
    expect(coachMessage(all[2]!).detail).toContain('144 m');
    expect(coachMessage(all[8]!).detail).toContain('60 mph'); // 26.8 m/s
    expect(coachMessage(all[9]!).detail).toContain('40 mph'); // 17.9 m/s
    expect(CLEAR_ROAD.tone).toBe('calm');
  });
});
