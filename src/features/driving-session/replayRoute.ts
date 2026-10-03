import { destination } from '../../core/location/geo';
import type { GpsFix } from '../../core/location/types';

const MPH = 0.44704;

export type ReplayRoute = {
  lat: number;
  lon: number;
  /** Degrees clockwise from north. */
  heading: number;
  distanceM: number;
  speedMph: number;
};

/** Straight drive north through four real stop signs in downtown Raleigh, two of them crowd hotspots. */
export const DEMO_ROUTE: ReplayRoute = { lat: 35.7812, lon: -78.632953, heading: 0, distanceM: 520, speedMph: 25 };

/** One GPS fix per second along the route, as the phone's location service would report them. */
export function replayFixes(route: ReplayRoute = DEMO_ROUTE, startMs = 0): GpsFix[] {
  const speed = route.speedMph * MPH;
  const fixes: GpsFix[] = [];
  for (let t = 0; t * speed <= route.distanceM; t++) {
    fixes.push({
      ...destination(route, route.heading, t * speed),
      heading: route.heading,
      speed,
      t: startMs + t * 1000,
    });
  }
  return fixes;
}
