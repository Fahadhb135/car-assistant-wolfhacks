import { destination, EARTH_RADIUS_M, METERS_PER_MILE, type LatLon } from './geo.ts';

// Map data is fetched in ~1-mile square tiles (README section 7) so we query
// Overpass once per tile instead of once per GPS fix.
//
// Rows are fixed bands of latitude. Each row picks its own longitude step so
// that tiles stay roughly square (a degree of longitude shrinks with cos(lat)).
// Keys are stable strings, safe to use for both the memory and disk caches.
// Not handled: the antimeridian and the poles. Neither matters for driving demos.

export const TILE_SIZE_M = METERS_PER_MILE;

/** Fraction of a tile left ahead of the car at which we prefetch the next one. */
export const PREFETCH_FRACTION = 0.25;

export type TileKey = string;
export type BBox = { south: number; west: number; north: number; east: number };

const METERS_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_M) / 180;
const LAT_STEP = TILE_SIZE_M / METERS_PER_DEG_LAT;

function lonStepForRow(row: number): number {
  const centerLat = (row + 0.5) * LAT_STEP;
  const cos = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  return LAT_STEP / cos;
}

export function tileKeyFor(p: LatLon): TileKey {
  const row = Math.floor(p.lat / LAT_STEP);
  const col = Math.floor(p.lon / lonStepForRow(row));
  return `${row}:${col}`;
}

export function tileBounds(key: TileKey): BBox {
  const [row, col] = key.split(':').map(Number);
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    throw new Error(`Invalid tile key: ${key}`);
  }
  const lonStep = lonStepForRow(row);
  return {
    south: row * LAT_STEP,
    north: (row + 1) * LAT_STEP,
    west: col * lonStep,
    east: (col + 1) * lonStep,
  };
}

/** True when the heading is usable (expo-location reports -1 / NaN when unknown). */
export function hasHeading(heading: number | null | undefined): heading is number {
  return typeof heading === 'number' && Number.isFinite(heading) && heading >= 0;
}

/**
 * Every tile the coach needs loaded for this fix: the car's own tile, the
 * tiles under the edges and middle of its look-ahead cone (a sign 150 m ahead
 * can sit across a tile border), and the next tile to prefetch.
 */
export function tilesForFix(
  p: LatLon & { heading?: number | null },
  coneRadiusM = 200,
  coneHalfAngleDeg = 35,
): TileKey[] {
  const keys = new Set<TileKey>([tileKeyFor(p)]);
  if (hasHeading(p.heading)) {
    for (const offset of [-coneHalfAngleDeg, 0, coneHalfAngleDeg]) {
      keys.add(tileKeyFor(destination(p, p.heading + offset, coneRadiusM)));
    }
    const next = nextTileToPrefetch(p);
    if (next) keys.add(next);
  }
  return [...keys];
}

/**
 * The tile the car will enter next, if it is within PREFETCH_FRACTION of a tile
 * along its heading. Looking ahead along the heading (rather than checking the
 * distance to each edge) also handles diagonal exits through a corner.
 */
export function nextTileToPrefetch(
  p: LatLon & { heading?: number | null },
  lookaheadM = TILE_SIZE_M * PREFETCH_FRACTION,
): TileKey | null {
  if (!hasHeading(p.heading)) return null;
  const ahead = tileKeyFor(destination(p, p.heading, lookaheadM));
  return ahead === tileKeyFor(p) ? null : ahead;
}
