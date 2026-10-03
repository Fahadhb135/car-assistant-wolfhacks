import { bearingDeg, bearingDelta, EARTH_RADIUS_M, normalizeBearing, type LatLon } from './geo';
import { hasHeading } from './tiles';
import type { RoadKind, RoadWay } from './types';

// Map-matches the car to a highway or ramp: the nearest segment within a few
// lanes' width whose direction of travel agrees with the car's heading. That
// heading check is what separates an on-ramp from the opposite carriageway.

export type RoadMatchOptions = {
  /** Max distance from the way's centreline. Default 25 m (a 4-lane carriageway plus GPS error). */
  maxDistanceM?: number;
  /** Max difference between car heading and the road's direction of travel. Default 40°. */
  maxHeadingDeltaDeg?: number;
};

export type RoadMatch = { road: RoadWay; distanceM: number; headingDeltaDeg: number };

const M_PER_DEG = (Math.PI * EARTH_RADIUS_M) / 180;

/**
 * Distance from p to segment ab in metres, using a flat projection around p.
 * Fine for segments up to a few kilometres.
 */
export function distanceToSegmentM(p: LatLon, a: LatLon, b: LatLon): number {
  const kx = Math.cos((p.lat * Math.PI) / 180) * M_PER_DEG;
  const ax = (a.lon - p.lon) * kx;
  const ay = (a.lat - p.lat) * M_PER_DEG;
  const bx = (b.lon - p.lon) * kx;
  const by = (b.lat - p.lat) * M_PER_DEG;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Closest distance from p to any segment of the way. */
export function distanceToWayM(p: LatLon, road: RoadWay): number {
  let best = Infinity;
  for (let i = 1; i < road.geometry.length; i++) {
    best = Math.min(best, distanceToSegmentM(p, road.geometry[i - 1], road.geometry[i]));
  }
  return best;
}

export function matchRoad(
  car: LatLon & { heading?: number | null },
  roads: readonly RoadWay[],
  opts: RoadMatchOptions = {},
): RoadMatch | null {
  const { maxDistanceM = 25, maxHeadingDeltaDeg = 40 } = opts;
  if (!hasHeading(car.heading)) return null;

  let best: (RoadMatch & { score: number }) | null = null;
  for (const road of roads) {
    for (let i = 1; i < road.geometry.length; i++) {
      const a = road.geometry[i - 1];
      const b = road.geometry[i];
      const d = distanceToSegmentM(car, a, b);
      if (d > maxDistanceM) continue;
      const along = bearingDeg(a, b);
      const headingDeltaDeg =
        road.oneway === 0
          ? Math.min(bearingDelta(along, car.heading), bearingDelta(along + 180, car.heading))
          : bearingDelta(road.oneway === 1 ? along : normalizeBearing(along + 180), car.heading);
      if (headingDeltaDeg > maxHeadingDeltaDeg) continue;
      // Prefer close and well-aligned; 1° of misalignment costs as much as 0.3 m.
      const score = d + 0.3 * headingDeltaDeg;
      if (!best || score < best.score) best = { road, distanceM: d, headingDeltaDeg, score };
    }
  }
  if (!best) return null;
  const { score: _score, ...match } = best;
  return match;
}

/** Nearest way of the given kind within maxDistanceM, ignoring direction. */
export function nearestRoad(
  p: LatLon,
  roads: readonly RoadWay[],
  kind: RoadKind,
  maxDistanceM: number,
): { road: RoadWay; distanceM: number } | null {
  let best: { road: RoadWay; distanceM: number } | null = null;
  for (const road of roads) {
    if (road.kind !== kind) continue;
    const d = distanceToWayM(p, road);
    if (d <= maxDistanceM && (!best || d < best.distanceM)) best = { road, distanceM: d };
  }
  return best;
}
