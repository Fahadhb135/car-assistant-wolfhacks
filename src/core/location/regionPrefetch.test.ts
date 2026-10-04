import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { destination, distanceM, METERS_PER_MILE } from './geo';
import { RegionPrefetcher } from './regionPrefetch';
import { tileBounds, tileKeyFor, tilesWithinRadius } from './tiles';

const HUNT_LIBRARY = { lat: 35.769326, lon: -78.676307 };
const MILE = METERS_PER_MILE;

describe('tilesWithinRadius', () => {
  it('starts with the center tile and covers points out to the radius', () => {
    const keys = tilesWithinRadius(HUNT_LIBRARY, 2 * MILE);
    assert.equal(keys[0], tileKeyFor(HUNT_LIBRARY));
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const edge = destination(HUNT_LIBRARY, bearing, 2 * MILE - 10);
      assert.ok(keys.includes(tileKeyFor(edge)), `missing the tile ${bearing}° out`);
    }
  });

  it('leaves out tiles entirely beyond the radius', () => {
    for (const key of tilesWithinRadius(HUNT_LIBRARY, 2 * MILE)) {
      const b = tileBounds(key);
      const nearest = {
        lat: Math.min(Math.max(HUNT_LIBRARY.lat, b.south), b.north),
        lon: Math.min(Math.max(HUNT_LIBRARY.lon, b.west), b.east),
      };
      assert.ok(distanceM(HUNT_LIBRARY, nearest) <= 2 * MILE);
    }
    // A 2-mile circle over ~1-mile tiles needs about 5x5 tiles, not the 7x7 search box.
    const count = tilesWithinRadius(HUNT_LIBRARY, 2 * MILE).length;
    assert.ok(count >= 16 && count <= 25, `unexpected tile count ${count}`);
  });
});

describe('RegionPrefetcher', () => {
  it('returns the region on the first fix', () => {
    const region = new RegionPrefetcher().update(HUNT_LIBRARY);
    assert.ok(region);
    assert.deepEqual(region.keys, tilesWithinRadius(HUNT_LIBRARY, 2 * MILE));
  });

  it('stays put until the car nears the edge, then re-centers on the car', () => {
    const prefetcher = new RegionPrefetcher();
    prefetcher.update(HUNT_LIBRARY);
    assert.equal(prefetcher.update(destination(HUNT_LIBRARY, 90, 1.4 * MILE)), null);

    const nearEdge = destination(HUNT_LIBRARY, 90, 1.6 * MILE);
    const region = prefetcher.update(nearEdge);
    assert.ok(region, 'expected a new region within half a mile of the edge');
    assert.deepEqual(region.center, { lat: nearEdge.lat, lon: nearEdge.lon });
    assert.equal(region.keys[0], tileKeyFor(nearEdge));

    // Measured from the new center now.
    assert.equal(prefetcher.update(destination(nearEdge, 90, 1 * MILE)), null);
  });

  it('rejects a margin as large as the radius', () => {
    assert.throws(() => new RegionPrefetcher({ radiusM: MILE, refreshMarginM: MILE }));
  });
});
