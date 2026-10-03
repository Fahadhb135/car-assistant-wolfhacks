import { bearingDeg, bearingDelta, distanceM, normalizeBearing, type LatLon } from './geo.ts';
import type { StopSign } from './overpass.ts';
import { hasHeading } from './tiles.ts';

// Picks the stop signs that apply to the car right now: in front of it (within
// a cone around its heading), close enough to matter, and, when OSM tells us
// which way the sign faces, facing the car rather than a cross street.

export type SignFilterOptions = {
  /** Ignore signs further than this. Default 200 m (coach starts at ~150 m). */
  maxDistanceM?: number;
  /** Half-width of the cone ahead of the car. Default ±35°. */
  maxBearingDeltaDeg?: number;
  /** How far a sign's facing may be from directly toward the car. Default ±45°. */
  maxFacingDeltaDeg?: number;
};

export type SignAhead = { sign: StopSign; distanceM: number; bearingDeg: number };

export function signsAhead(
  car: LatLon & { heading?: number | null },
  signs: readonly StopSign[],
  opts: SignFilterOptions = {},
): SignAhead[] {
  const { maxDistanceM = 200, maxBearingDeltaDeg = 35, maxFacingDeltaDeg = 45 } = opts;
  if (!hasHeading(car.heading)) return [];
  const heading = car.heading;

  const out: SignAhead[] = [];
  for (const sign of signs) {
    const d = distanceM(car, sign);
    if (d > maxDistanceM) continue;
    const b = bearingDeg(car, sign);
    if (bearingDelta(b, heading) > maxBearingDeltaDeg) continue;
    // A sign that applies to us faces back toward us, i.e. opposite our heading.
    if (sign.facingDeg !== null && bearingDelta(sign.facingDeg, normalizeBearing(heading + 180)) > maxFacingDeltaDeg) {
      continue;
    }
    out.push({ sign, distanceM: d, bearingDeg: b });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}
