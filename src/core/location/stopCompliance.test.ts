import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LocationCoach } from './coach';
import { featuresAhead } from './featureFilter';
import { destination } from './geo';
import { StopComplianceTracker } from './stopCompliance';
import type { GpsFix, RoadFeature } from './types';

const START = { lat: 35.78, lon: -78.63 };
const SIGN: RoadFeature = { id: 42, kind: 'stop', facingDeg: null, ...destination(START, 0, 200) };

/** Drive north 300 m past the sign; `speedAt(distanceToSignM)` gives the speed for each fix. */
function driveNorth(speedAt: (toSignM: number) => number, step = 5): GpsFix[] {
  const fixes: GpsFix[] = [];
  let t = 0;
  for (let d = 0; d <= 300; d += step) {
    // Dwell a few seconds where the car is stopped, like a real 1 Hz GPS would report.
    const speed = speedAt(200 - d);
    const repeats = speed < 0.3 ? 3 : 1;
    for (let r = 0; r < repeats; r++) fixes.push({ ...destination(START, 0, d), heading: 0, speed, t: (t += 1000) });
  }
  return fixes;
}

function judged(speedAt: (toSignM: number) => number) {
  const coach = new LocationCoach();
  return driveNorth(speedAt)
    .flatMap((fix) => coach.update(fix, featuresAhead(fix, [SIGN]), []))
    .filter((e) => e.kind === 'stop_ok' || e.kind === 'rolling_stop' || e.kind === 'ran_stop');
}

describe('stop compliance', () => {
  it('a full stop at the sign is stop_ok, judged once, after passing it', () => {
    const events = judged((to) => (Math.abs(to) < 4 ? 0 : 9));
    assert.equal(events.length, 1);
    assert.deepEqual({ kind: events[0]!.kind, featureId: (events[0] as { featureId: number }).featureId }, { kind: 'stop_ok', featureId: 42 });
  });

  it('slowing to walking pace without stopping is a rolling stop', () => {
    const events = judged((to) => (Math.abs(to) < 10 ? 2.2 : 9));
    assert.deepEqual(events.map((e) => e.kind), ['rolling_stop']);
    assert.equal((events[0] as { minSpeedMps: number }).minSpeedMps, 2.2);
  });

  it('driving straight through is a ran stop', () => {
    assert.deepEqual(judged(() => 11).map((e) => e.kind), ['ran_stop']);
  });

  it('a sign the car never reaches is not judged', () => {
    const t = new StopComplianceTracker();
    t.follow(1, SIGN, 0);
    // Car turns east 80 m before the sign and drives away.
    const turn = destination(START, 0, 120);
    const events = [0, 20, 40, 60, 80, 100].flatMap((d, i) =>
      t.update({ ...destination(turn, 90, d), heading: 90, speed: 10, t: 1000 * (i + 1) }));
    assert.deepEqual(events, []);
  });

  it('no speed readings near the sign means no verdict', () => {
    assert.deepEqual(judged(() => -1), []);
  });
});
