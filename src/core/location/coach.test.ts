import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LocationCoach } from './coach';
import type { HighwayEvent, LocationEvent } from './events';
import { featuresAhead } from './featureFilter';
import { bearingDeg, destination, distanceM, type LatLon } from './geo';
import { distanceToSegmentM, matchRoad } from './roads';
import type { GpsFix, RoadFeature, RoadWay } from './types';

// Synthetic interchange: a northbound motorway from O, an on-ramp joining it
// 1 km north (coming in from the south-east) and an off-ramp leaving it 2 km
// north (heading off to the north-east).
const O = { lat: 35.8, lon: -78.7 };
const MPH = 0.44704;
const motorway: RoadWay = {
  id: 1,
  kind: 'motorway',
  geometry: [O, destination(O, 0, 3000)],
  oneway: 1,
  maxspeedMps: 65 * MPH,
  ref: 'I 440',
};
const ON_START = destination(destination(O, 0, 400), 90, 250);
const MERGE = destination(O, 0, 1000);
const onRamp: RoadWay = { id: 2, kind: 'motorway_link', geometry: [ON_START, MERGE], oneway: 1, maxspeedMps: null };
const DIVERGE = destination(O, 0, 2000);
const OFF_END = destination(destination(O, 0, 2400), 90, 250);
const offRamp: RoadWay = { id: 3, kind: 'motorway_link', geometry: [DIVERGE, OFF_END], oneway: 1, maxspeedMps: 40 * MPH };
const ROADS = [motorway, onRamp, offRamp];

/** Fixes every `step` metres along a polyline, at a constant speed, 1 s apart. */
function drive(points: LatLon[], speed: number, step = 20, t0 = 0): GpsFix[] {
  const fixes: GpsFix[] = [];
  let t = t0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const heading = bearingDeg(a, b);
    for (let d = 0; d < distanceM(a, b); d += step) {
      fixes.push({ ...destination(a, heading, d), heading, speed, t: (t += 1000) });
    }
  }
  return fixes;
}

function run(coach: LocationCoach, fixes: GpsFix[], features: RoadFeature[] = []): LocationEvent[] {
  return fixes.flatMap((fix) => coach.update(fix, featuresAhead(fix, features), ROADS));
}

describe('roads', () => {
  it('measures distance to a segment', () => {
    const a = O;
    const b = destination(O, 0, 1000);
    assert.ok(Math.abs(distanceToSegmentM(destination(O, 90, 30), a, b) - 30) < 0.1);
    assert.ok(Math.abs(distanceToSegmentM(destination(O, 180, 50), a, b) - 50) < 0.1); // past the end
  });

  it('matches by distance and direction of travel', () => {
    const onMotorway = { ...destination(O, 0, 500), heading: 2 };
    assert.equal(matchRoad(onMotorway, ROADS)?.road.id, 1);
    // Same spot heading south: that's the other carriageway, not this one-way road.
    assert.equal(matchRoad({ ...onMotorway, heading: 182 }, ROADS), null);
    // 60 m off to the side: a parallel local road.
    assert.equal(matchRoad({ ...destination(onMotorway, 90, 60), heading: 0 }, ROADS), null);
    // Unknown heading: no match.
    assert.equal(matchRoad({ ...onMotorway, heading: -1 }, ROADS), null);
  });

  it('prefers the ramp once the car turns onto it', () => {
    const justPastDiverge = { ...destination(DIVERGE, bearingDeg(DIVERGE, OFF_END), 60), heading: bearingDeg(DIVERGE, OFF_END) };
    assert.equal(matchRoad(justPastDiverge, ROADS)?.road.id, 3);
  });
});

describe('LocationCoach highway coaching', () => {
  it('tells a slow driver on an on-ramp to speed up to the highway limit', () => {
    const approach = destination(ON_START, bearingDeg(MERGE, ON_START), 300);
    const coach = new LocationCoach();
    const events = run(coach, drive([approach, ON_START, MERGE, destination(O, 0, 1500)], 12));
    assert.equal(events.length, 1);
    const e = events[0] as HighwayEvent;
    assert.equal(e.kind, 'highway_entering');
    assert.equal(e.advice, 'speed_up');
    assert.equal(e.severity, 'warn');
    assert.equal(e.targetIsDefault, false);
    assert.ok(Math.abs(e.targetSpeedMps - 65 * MPH) < 0.01);
    assert.equal(e.road, 'I 440');
    assert.equal(coach.roadClass, 'highway');
  });

  it('tells a fast driver taking an exit to slow down to the ramp limit', () => {
    const coach = new LocationCoach();
    const events = run(coach, drive([destination(O, 0, 1200), DIVERGE, OFF_END], 30));
    assert.deepEqual(
      events.map((e) => [e.kind, (e as HighwayEvent).advice]),
      [['highway_exiting', 'slow_down']],
    );
    assert.ok(Math.abs((events[0] as HighwayEvent).targetSpeedMps - 40 * MPH) < 0.01);
    assert.equal(coach.roadClass, 'ramp');
  });

  it('uses default limits and says ok when the speed is already right', () => {
    const untagged = ROADS.map((r) => ({ ...r, maxspeedMps: null }));
    const coach = new LocationCoach();
    const events = drive([destination(O, 0, 1200), DIVERGE, OFF_END], 35 * MPH).flatMap((f) =>
      coach.update(f, [], untagged),
    );
    const e = events[0] as HighwayEvent;
    assert.equal(e.kind, 'highway_exiting');
    assert.equal(e.advice, 'ok');
    assert.equal(e.severity, 'info');
    assert.equal(e.targetIsDefault, true);
  });

  it('ignores a single jittery fix', () => {
    const coach = new LocationCoach();
    const fixes = drive([destination(O, 0, 500), destination(O, 0, 900)], 30);
    // Highway for a while, then one fix that lands on nothing.
    fixes.splice(10, 0, { ...fixes[10], heading: 180 });
    run(coach, fixes);
    assert.equal(coach.roadClass, 'highway');
    assert.deepEqual(run(coach, fixes), []);
  });
});

describe('LocationCoach feature announcements', () => {
  const light: RoadFeature = { id: 50, kind: 'traffic_signals', ...destination(O, 270, 1000), facingDeg: null };
  const stop: RoadFeature = { id: 51, kind: 'stop', ...destination(O, 270, 1300), facingDeg: null };
  const west = (from: number, to: number) => drive([destination(O, 270, from), destination(O, 270, to)], 10, 10);

  it('announces each stop sign and traffic light once, at ~150 m', () => {
    const coach = new LocationCoach();
    const all = run(coach, west(600, 1350), [light, stop]);
    const events = all.filter((e) => e.kind.endsWith('_ahead'));
    assert.deepEqual(
      events.map((e) => [e.kind, (e as { featureId: number }).featureId]),
      [
        ['traffic_light_ahead', 50],
        ['stop_sign_ahead', 51],
      ],
    );
    for (const e of events) assert.ok((e as { distanceM: number }).distanceM <= 150);
    // The synthetic car drives through the stop sign without slowing down.
    assert.deepEqual(all.filter((e) => !e.kind.endsWith('_ahead')).map((e) => e.kind), ['ran_stop']);
  });

  it('announces an intersection with several stop-sign nodes once', () => {
    const allWay: RoadFeature[] = [0, 15, 30].map((offset, i) => ({
      id: 60 + i,
      kind: 'stop',
      ...destination(destination(O, 270, 1000 + offset), 0, i === 1 ? 8 : -8),
      facingDeg: null,
    }));
    const coach = new LocationCoach();
    const events = run(coach, west(700, 1050), allWay).filter((e) => e.kind === 'stop_sign_ahead');
    assert.deepEqual(events.map((e) => (e as { featureId: number }).featureId), [60]);
  });

  it('announces again after the feature has been out of view for a while', () => {
    const coach = new LocationCoach();
    assert.equal(run(coach, west(800, 900), [light]).length, 1);
    // Back on the same approach a minute later (e.g. a demo loop).
    const later = west(800, 900).map((f) => ({ ...f, t: f.t + 60_000 }));
    assert.equal(run(coach, later, [light]).length, 1);
  });
});
