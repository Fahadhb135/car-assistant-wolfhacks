import { bearingDeg, bearingDelta, distanceM, normalizeBearing, type LatLon } from './geo';
import { hasHeading } from './tiles';
import type { RoadFeature, RoadFeatureKind } from './types';

// Picks the stop signs and traffic lights that apply to the car right now: in
// front of it (within a cone around its heading), close enough to matter, and,
// when OSM tells us which way they face, facing the car rather than a cross street.

export type FeatureFilterOptions = {
  /** Ignore features further than this. Default 200 m (coach announces at ~150 m). */
  maxDistanceM?: number;
  /** Half-width of the cone ahead of the car. Default ±35°. */
  maxBearingDeltaDeg?: number;
  /** How far a feature's facing may be from directly toward the car. Default ±45°. */
  maxFacingDeltaDeg?: number;
  /** Only these kinds. Default: all. */
  kinds?: readonly RoadFeatureKind[];
};

export type FeatureAhead = { feature: RoadFeature; distanceM: number; bearingDeg: number };

export function featuresAhead(
  car: LatLon & { heading?: number | null },
  features: readonly RoadFeature[],
  opts: FeatureFilterOptions = {},
): FeatureAhead[] {
  const { maxDistanceM = 200, maxBearingDeltaDeg = 35, maxFacingDeltaDeg = 45, kinds } = opts;
  if (!hasHeading(car.heading)) return [];
  const heading = car.heading;

  const out: FeatureAhead[] = [];
  for (const feature of features) {
    if (kinds && !kinds.includes(feature.kind)) continue;
    const d = distanceM(car, feature);
    if (d > maxDistanceM) continue;
    const b = bearingDeg(car, feature);
    if (bearingDelta(b, heading) > maxBearingDeltaDeg) continue;
    // A sign that applies to us faces back toward us, i.e. opposite our heading.
    if (
      feature.facingDeg !== null &&
      bearingDelta(feature.facingDeg, normalizeBearing(heading + 180)) > maxFacingDeltaDeg
    ) {
      continue;
    }
    out.push({ feature, distanceM: d, bearingDeg: b });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}
