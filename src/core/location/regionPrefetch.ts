import { distanceM, METERS_PER_MILE, type LatLon } from './geo';
import { tilesWithinRadius, type TileKey } from './tiles';

// Keeps map data loaded for a whole area around the car, not just the tiles under it:
//   - on the first fix, the region is every tile within `radiusM` of the car;
//   - once the car is within `refreshMarginM` of the region's edge, the region moves to be
//     centered on the car again.
// Each (re)centering returns the new region's tiles: the caller fetches the ones it lacks and drops
// the ones outside it. Tiles that stay inside the region are kept, not refetched.

export type RegionPrefetchOptions = {
  /** Region radius. Default 2 miles. */
  radiusM?: number;
  /** Re-center when the car is this close to the region's edge. Default 0.5 mile. */
  refreshMarginM?: number;
};

export type Region = Readonly<{ center: LatLon; keys: readonly TileKey[] }>;

export class RegionPrefetcher {
  private readonly radiusM: number;
  private readonly refreshMarginM: number;
  private center: LatLon | null = null;

  constructor(opts: RegionPrefetchOptions = {}) {
    this.radiusM = opts.radiusM ?? 2 * METERS_PER_MILE;
    this.refreshMarginM = opts.refreshMarginM ?? 0.5 * METERS_PER_MILE;
    if (this.refreshMarginM >= this.radiusM) {
      throw new Error('refreshMarginM must be smaller than radiusM');
    }
  }

  /** The new region when the car starts or nears the edge, otherwise null. */
  update(p: LatLon): Region | null {
    if (this.center && distanceM(this.center, p) < this.radiusM - this.refreshMarginM) return null;
    this.center = { lat: p.lat, lon: p.lon };
    return { center: this.center, keys: tilesWithinRadius(this.center, this.radiusM) };
  }
}
