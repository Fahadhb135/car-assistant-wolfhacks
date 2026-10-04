import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { featuresAhead } from './featureFilter';
import { bearingDeg, bearingDelta, destination, distanceM, METERS_PER_MILE } from './geo';
import { buildTileQuery, parseDirectionTag, parseMaxspeed, parseTile } from './overpass';
import { nextTileToPrefetch, tileBounds, tileKeyFor, tilesForFix } from './tiles';
import type { RoadFeature } from './types';

const RALEIGH = { lat: 35.7796, lon: -78.6382 };
const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

describe('geo', () => {
  it('measures distance and bearing', () => {
    // One degree of latitude is ~111.2 km due north.
    const north = { lat: RALEIGH.lat + 1, lon: RALEIGH.lon };
    near(distanceM(RALEIGH, north), 111_195, 50);
    near(bearingDeg(RALEIGH, north), 0, 1e-6);
    near(bearingDeg(north, RALEIGH), 180, 1e-6);
  });

  it('round-trips destination with distance and bearing', () => {
    for (const b of [0, 45, 135, 270, 359]) {
      const p = destination(RALEIGH, b, 500);
      near(distanceM(RALEIGH, p), 500, 0.01);
      near(bearingDelta(bearingDeg(RALEIGH, p), b), 0, 0.01);
    }
  });

  it('takes the short way round for bearing deltas', () => {
    assert.equal(bearingDelta(350, 10), 20);
    assert.equal(bearingDelta(-90, 270), 0);
    assert.equal(bearingDelta(0, 180), 180);
  });
});

describe('tiles', () => {
  it('produces roughly 1-mile square tiles that contain their points', () => {
    const key = tileKeyFor(RALEIGH);
    const b = tileBounds(key);
    assert.ok(RALEIGH.lat >= b.south && RALEIGH.lat < b.north);
    assert.ok(RALEIGH.lon >= b.west && RALEIGH.lon < b.east);
    const midLat = (b.south + b.north) / 2;
    near(distanceM({ lat: b.south, lon: b.west }, { lat: b.north, lon: b.west }), METERS_PER_MILE, 1);
    near(distanceM({ lat: midLat, lon: b.west }, { lat: midLat, lon: b.east }), METERS_PER_MILE, 5);
  });

  it('gives neighbouring points the same key and distant points different keys', () => {
    const b = tileBounds(tileKeyFor(RALEIGH));
    const center = { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
    assert.equal(tileKeyFor(destination(center, 90, 100)), tileKeyFor(center));
    assert.notEqual(tileKeyFor(destination(center, 90, 2000)), tileKeyFor(center));
  });

  it('prefetches only near the edge along the heading', () => {
    const b = tileBounds(tileKeyFor(RALEIGH));
    const center = { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
    assert.equal(nextTileToPrefetch({ ...center, heading: 0 }), null);

    const nearNorthEdge = { lat: b.north - 0.001, lon: center.lon, heading: 0 };
    const next = nextTileToPrefetch(nearNorthEdge);
    assert.ok(next);
    assert.equal(tileBounds(next).south.toFixed(9), b.north.toFixed(9));

    // Heading away from the edge, or no heading at all: nothing to prefetch.
    assert.equal(nextTileToPrefetch({ ...nearNorthEdge, heading: 180 }), null);
    assert.equal(nextTileToPrefetch({ ...nearNorthEdge, heading: -1 }), null);
  });

  it('covers the look-ahead cone across tile borders', () => {
    const b = tileBounds(tileKeyFor(RALEIGH));
    const car = { lat: b.north - 0.0005, lon: (b.west + b.east) / 2, heading: 0 }; // ~55 m from the edge
    const keys = tilesForFix(car);
    assert.ok(keys.includes(tileKeyFor(car)));
    assert.ok(keys.includes(tileKeyFor({ lat: b.north + 0.0005, lon: car.lon })));
  });

  it('rejects malformed keys', () => {
    assert.throws(() => tileBounds('nope'));
  });
});

describe('overpass parsing', () => {
  it('builds one bbox query for signs, lights and every drivable road', () => {
    const q = buildTileQuery({ south: 1, west: 2, north: 3, east: 4 });
    const bbox = '(1.000000,2.000000,3.000000,4.000000)';
    assert.match(q, /^\[out:json\]/);
    assert.ok(q.includes(`node["highway"~"^(stop|traffic_signals)$"]${bbox}`));
    const roads = q.match(/way\["highway"~"\^\(([^)]*)\)\$"\]/)?.[1]?.split('|') ?? [];
    for (const cls of ['motorway', 'motorway_link', 'primary', 'residential', 'tertiary_link']) {
      assert.ok(roads.includes(cls), `query is missing ${cls}`);
    }
    assert.ok(!roads.includes('footway') && !roads.includes('service'));
    assert.ok(q.includes(`)$"]${bbox}`));
    assert.match(q, /out geom;$/);
  });

  it('parses direction tags', () => {
    assert.equal(parseDirectionTag('N'), 0);
    assert.equal(parseDirectionTag('sw'), 225);
    assert.equal(parseDirectionTag('90'), 90);
    assert.equal(parseDirectionTag('-90'), 270);
    assert.equal(parseDirectionTag('forward'), null);
    assert.equal(parseDirectionTag(undefined), null);
  });

  it('parses maxspeed in mph and km/h', () => {
    near(parseMaxspeed('65 mph')!, 29.06, 0.01);
    near(parseMaxspeed('100')!, 27.78, 0.01);
    near(parseMaxspeed('50 km/h')!, 13.89, 0.01);
    assert.equal(parseMaxspeed('none'), null);
    assert.equal(parseMaxspeed('signals'), null);
    assert.equal(parseMaxspeed(undefined), null);
  });

  it('keeps stop signs, traffic lights, highway/ramp ways and speed limits', () => {
    const geometry = [
      { lat: 35, lon: -78 },
      { lat: 35.01, lon: -78 },
    ];
    const tile = parseTile({
      elements: [
        { type: 'node', id: 1, lat: 35, lon: -78, tags: { highway: 'stop', direction: 'S' } },
        { type: 'node', id: 2, lat: 35, lon: -78, tags: { highway: 'traffic_signals' } },
        { type: 'node', id: 3, lat: 35, lon: -78, tags: { highway: 'crossing' } },
        { type: 'way', id: 10, geometry, tags: { highway: 'motorway', maxspeed: '65 mph', ref: 'I 440' } },
        { type: 'way', id: 11, geometry, tags: { highway: 'motorway_link', oneway: '-1' } },
        { type: 'way', id: 12, geometry, tags: { highway: 'primary' } },
        { type: 'way', id: 13, geometry: [geometry[0]], tags: { highway: 'motorway' } },
      ],
    });
    assert.deepEqual(tile.features, [
      { id: 1, kind: 'stop', lat: 35, lon: -78, facingDeg: 180, directionTag: 'S' },
      { id: 2, kind: 'traffic_signals', lat: 35, lon: -78, facingDeg: null },
    ]);
    assert.deepEqual(
      tile.roads.map((r) => [r.id, r.kind, r.oneway, r.ref]),
      [
        [10, 'motorway', 1, 'I 440'],
        [11, 'motorway_link', -1, undefined],
      ],
    );
    near(tile.roads[0].maxspeedMps!, 29.06, 0.01);
    assert.equal(tile.roads[1].maxspeedMps, null);
    // Every drivable way (with enough geometry) is kept for speed limits, highways included.
    assert.deepEqual(
      tile.speedLimits?.map((w) => [w.id, w.highway, w.oneway, w.maxspeedMps === null]),
      [
        [10, 'motorway', 1, false],
        [11, 'motorway_link', -1, true],
        [12, 'primary', 0, true],
      ],
    );
    assert.deepEqual(parseTile({}), { features: [], roads: [], speedLimits: [] });
  });
});

describe('featuresAhead', () => {
  const feature = (
    id: number,
    bearing: number,
    meters: number,
    facingDeg: number | null = null,
    kind: RoadFeature['kind'] = 'stop',
  ): RoadFeature => ({ id, kind, ...destination(RALEIGH, bearing, meters), facingDeg });
  const car = { ...RALEIGH, heading: 0 };

  it('keeps features inside the cone and range, nearest first', () => {
    const fs = [feature(1, 0, 150), feature(2, 20, 80), feature(3, 60, 50), feature(4, 180, 50), feature(5, 0, 400)];
    const ahead = featuresAhead(car, fs);
    assert.deepEqual(ahead.map((s) => s.feature.id), [2, 1]);
    near(ahead[0].distanceM, 80, 0.01);
  });

  it('drops features that face a cross street', () => {
    const facingUs = feature(1, 0, 100, 180); // northbound car reads a south-facing sign
    const facingEast = feature(2, 5, 100, 90);
    const facingAway = feature(3, -5, 100, 0);
    assert.deepEqual(featuresAhead(car, [facingUs, facingEast, facingAway]).map((s) => s.feature.id), [1]);
  });

  it('filters by kind', () => {
    const fs = [feature(1, 0, 100), feature(2, 0, 120, null, 'traffic_signals')];
    assert.deepEqual(featuresAhead(car, fs, { kinds: ['traffic_signals'] }).map((s) => s.feature.id), [2]);
  });

  it('returns nothing without a heading', () => {
    assert.deepEqual(featuresAhead({ ...RALEIGH, heading: -1 }, [feature(1, 0, 100)]), []);
  });
});
