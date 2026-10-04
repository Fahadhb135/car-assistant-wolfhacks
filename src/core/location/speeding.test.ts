import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { destination } from './geo';
import { SpeedingCoach } from './speeding';
import type { GpsFix, SpeedLimitWay } from './types';

const MPH = 0.44704;
const START = { lat: 35.7693, lon: -78.6763 };

/** A straight east-west residential street, 25 mph unless overridden. */
function street(overrides: Partial<SpeedLimitWay> = {}): SpeedLimitWay {
  return {
    id: 1,
    highway: 'residential',
    geometry: [destination(START, 270, 500), destination(START, 90, 500)],
    oneway: 0,
    maxspeedMps: 25 * MPH,
    name: 'Partners Way',
    ...overrides,
  };
}

/** Fixes one second apart, driving east along the street at a constant speed. */
function drive(coach: SpeedingCoach, ways: SpeedLimitWay[], mph: number, seconds: number, startT = 0, heading = 90) {
  const events = [];
  for (let s = 0; s < seconds; s++) {
    const p = destination(START, 90, (s * mph * MPH) % 400);
    const fix: GpsFix = { ...p, t: startT + s * 1000, speed: mph * MPH, heading };
    events.push(...coach.update(fix, ways));
  }
  return events;
}

describe('SpeedingCoach', () => {
  it('warns after 3 seconds more than 5 mph over the limit, with the speeds and road', () => {
    const events = drive(new SpeedingCoach(), [street()], 35, 3);
    assert.equal(events.length, 1);
    const [e] = events;
    assert.equal(e!.kind, 'speeding');
    if (e!.kind !== 'speeding') return;
    assert.equal(e.severity, 'warn');
    assert.equal(Math.round(e.speedMps / MPH), 35);
    assert.equal(Math.round(e.limitMps / MPH), 25);
    assert.equal(e.road, 'Partners Way');
  });

  it('stays quiet within the tolerance or for a brief burst', () => {
    assert.equal(drive(new SpeedingCoach(), [street()], 29, 10).length, 0);
    const coach = new SpeedingCoach();
    assert.equal(drive(coach, [street()], 35, 2).length, 0);
    assert.equal(drive(coach, [street()], 20, 1, 2_000).length, 0);
    assert.equal(drive(coach, [street()], 35, 2, 3_000).length, 0, 'the count restarts after slowing down');
  });

  it('does not repeat while the car keeps speeding, then warns again after the cooldown', () => {
    const coach = new SpeedingCoach();
    const events = drive(coach, [street()], 40, 70);
    assert.deepEqual(events.map((e) => e.t), [2_000, 62_000]);
  });

  it('warns again sooner after the driver slowed to the limit in between', () => {
    const coach = new SpeedingCoach();
    assert.equal(drive(coach, [street()], 40, 3).length, 1); // warned at t = 2 s
    drive(coach, [street()], 20, 10, 3_000); // back under the limit
    const again = drive(coach, [street()], 40, 10, 13_000);
    assert.deepEqual(again.map((e) => e.t), [17_000]); // 15 s after the first warning
  });

  it('ignores untagged roads, unknown speed or heading, and roads going the other way', () => {
    assert.equal(drive(new SpeedingCoach(), [street({ maxspeedMps: null })], 50, 10).length, 0);
    assert.equal(drive(new SpeedingCoach(), [street({ oneway: -1 })], 50, 10).length, 0, 'one-way the other way');

    const coach = new SpeedingCoach();
    const unknown: GpsFix = { ...START, t: 0, speed: -1, heading: 90 };
    const noHeading: GpsFix = { ...START, t: 0, speed: 30, heading: -1 };
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(coach.update({ ...unknown, t: i * 1000 }, [street()]), []);
      assert.deepEqual(coach.update({ ...noHeading, t: i * 1000 }, [street()]), []);
    }
  });

  it('uses the limit of the road the car is on, not a parallel one', () => {
    const fast = street({ id: 2, maxspeedMps: 45 * MPH, name: 'Western Blvd' });
    const nextStreetOver = street({
      id: 3,
      geometry: [destination(destination(START, 0, 60), 270, 500), destination(destination(START, 0, 60), 90, 500)],
    });
    assert.equal(drive(new SpeedingCoach(), [fast, nextStreetOver], 40, 10).length, 0);
  });
});
