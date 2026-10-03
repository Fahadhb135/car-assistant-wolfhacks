import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bearingDeg, bearingDelta, destination, distanceM, METERS_PER_MILE } from './geo.ts';
import { buildStopSignQuery, parseDirectionTag, parseStopSigns, type StopSign } from './overpass.ts';
import { signsAhead } from './signFilter.ts';
import { nextTileToPrefetch, tileBounds, tileKeyFor, tilesForFix } from './tiles.ts';

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
  it('builds a bbox query in south,west,north,east order', () => {
    const q = buildStopSignQuery({ south: 1, west: 2, north: 3, east: 4 });
    assert.match(q, /\[out:json\]/);
    assert.match(q, /node\["highway"="stop"\]\(1\.000000,2\.000000,3\.000000,4\.000000\)/);
  });

  it('parses direction tags', () => {
    assert.equal(parseDirectionTag('N'), 0);
    assert.equal(parseDirectionTag('sw'), 225);
    assert.equal(parseDirectionTag('90'), 90);
    assert.equal(parseDirectionTag('-90'), 270);
    assert.equal(parseDirectionTag('forward'), null);
    assert.equal(parseDirectionTag(undefined), null);
  });

  it('keeps only stop-sign nodes with coordinates', () => {
    const signs = parseStopSigns({
      elements: [
        { type: 'node', id: 1, lat: 35, lon: -78, tags: { highway: 'stop', direction: 'S' } },
        { type: 'node', id: 2, lat: 35, lon: -78, tags: { highway: 'traffic_signals' } },
        { type: 'way', id: 3, tags: { highway: 'stop' } },
        { type: 'node', id: 4, lat: 35.1, lon: -78.1, tags: { highway: 'stop' } },
      ],
    });
    assert.deepEqual(signs, [
      { id: 1, lat: 35, lon: -78, facingDeg: 180, directionTag: 'S' },
      { id: 4, lat: 35.1, lon: -78.1, facingDeg: null },
    ]);
    assert.deepEqual(parseStopSigns({}), []);
  });
});

describe('signsAhead', () => {
  const sign = (id: number, bearing: number, meters: number, facingDeg: number | null = null): StopSign => ({
    id,
    ...destination(RALEIGH, bearing, meters),
    facingDeg,
  });
  const car = { ...RALEIGH, heading: 0 };

  it('keeps signs inside the cone and range, nearest first', () => {
    const signs = [sign(1, 0, 150), sign(2, 20, 80), sign(3, 60, 50), sign(4, 180, 50), sign(5, 0, 400)];
    const ahead = signsAhead(car, signs);
    assert.deepEqual(ahead.map((s) => s.sign.id), [2, 1]);
    near(ahead[0].distanceM, 80, 0.01);
  });

  it('drops signs that face a cross street', () => {
    const facingUs = sign(1, 0, 100, 180); // northbound car reads a south-facing sign
    const facingEast = sign(2, 5, 100, 90);
    const facingAway = sign(3, -5, 100, 0);
    assert.deepEqual(signsAhead(car, [facingUs, facingEast, facingAway]).map((s) => s.sign.id), [1]);
  });

  it('returns nothing without a heading', () => {
    assert.deepEqual(signsAhead({ ...RALEIGH, heading: -1 }, [sign(1, 0, 100)]), []);
  });
});
