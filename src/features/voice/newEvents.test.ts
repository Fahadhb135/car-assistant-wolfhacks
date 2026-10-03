import { describe, expect, it } from 'vitest';
import type { LocationEvent } from '../../core/location/events';
import { createIdGenerator, toDriveEvent, type DriveEventInput } from '../../core/events/types';
import { alertFromEvent, PHRASES, POLICIES } from './phrases';
import { ev } from './testing';

const highway = (advice: 'speed_up' | 'slow_down' | 'ok', kind: 'highway_entering' | 'highway_exiting') =>
  ev({ kind, severity: 'warn', speedMps: 20, targetSpeedMps: 27, targetIsDefault: false, advice }, 0);

describe('mapping of location and hotspot events to speech', () => {
  it('speaks traffic lights and hotspots with the right phrase', () => {
    expect(alertFromEvent(ev({ kind: 'traffic_light_ahead', severity: 'info', distanceM: 140 }, 0))?.utterance.text).toBe(PHRASES.traffic_light_ahead);
    const hot = (topKind: 'rolling_stop' | 'ran_stop' | 'erratic_driving') =>
      alertFromEvent(ev({ kind: 'hotspot_ahead', severity: 'info', distanceM: 240, cell: 'c', topKind, drivers: 3, demo: false }, 0))?.utterance.text;
    expect(hot('rolling_stop')).toBe(PHRASES.hotspot_rolling);
    expect(hot('ran_stop')).toBe(PHRASES.hotspot_ran);
    expect(hot('erratic_driving')).toBe(PHRASES.hotspot_erratic);
  });

  it('speaks highway advice only when the driver needs to change speed', () => {
    expect(alertFromEvent(highway('speed_up', 'highway_entering'))?.utterance.text).toBe(PHRASES.highway_merge);
    expect(alertFromEvent(highway('slow_down', 'highway_exiting'))?.utterance.text).toBe(PHRASES.highway_exit);
    expect(alertFromEvent(highway('ok', 'highway_entering'))).toBeNull();
    expect(alertFromEvent(highway('ok', 'highway_exiting'))).toBeNull();
  });

  it("follows the README priority order: stop sign > highway > traffic light > swerve > tips", () => {
    const p = (k: keyof typeof POLICIES) => POLICIES[k].priority;
    expect(p('crash')).toBeGreaterThan(p('stop_sign_ahead'));
    expect(p('stop_sign_ahead')).toBeGreaterThan(p('highway_entering'));
    expect(p('highway_exiting')).toBeGreaterThan(p('traffic_light_ahead'));
    expect(p('traffic_light_ahead')).toBeGreaterThan(p('erratic_driving'));
    expect(p('erratic_driving')).toBeGreaterThan(p('coaching_tip'));
    expect(p('hotspot_ahead')).toBeLessThan(p('stop_sign_ahead')); // a warning never cuts off the stop-sign alert
  });

  it("Person B's location events are accepted by the shared event type and get ids", () => {
    const fromCoach: LocationEvent = { kind: 'traffic_light_ahead', severity: 'info', t: 5, distanceM: 120, featureId: 9 };
    const input: DriveEventInput = fromCoach; // compile-time check: no adapter needed
    const stamped = toDriveEvent(input, createIdGenerator('loc-'));
    expect(stamped).toMatchObject({ eventId: 'loc-1', kind: 'traffic_light_ahead', t: 5 });
  });
});
