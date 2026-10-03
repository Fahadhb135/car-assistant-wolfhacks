import type { LocationEvent } from '../../src/core/location/events';

// Rough spoken-style text for location events, for dev scripts only.
// The real wording belongs to the voice layer (README section 8).

const mph = (mps: number) => Math.round(mps / 0.44704);

export function describeEvent(e: LocationEvent): string {
  switch (e.kind) {
    case 'stop_sign_ahead':
      return `>> "Stop sign ahead, start slowing down." (${e.distanceM.toFixed(0)} m, node ${e.featureId})`;
    case 'traffic_light_ahead':
      return `>> "Traffic light ahead." (${e.distanceM.toFixed(0)} m, node ${e.featureId})`;
    case 'highway_entering':
    case 'highway_exiting': {
      const limit = `${mph(e.targetSpeedMps)} mph${e.targetIsDefault ? ' (default, no OSM maxspeed)' : ''}`;
      const where = e.kind === 'highway_entering' ? `Merging onto ${e.road ?? 'the highway'}` : 'Exit ramp';
      const advice =
        e.advice === 'speed_up' ? 'speed up to match traffic' : e.advice === 'slow_down' ? 'slow down' : 'speed looks good';
      return `>> "${where}: ${advice}." [${e.kind}, ${e.severity}] you ${mph(e.speedMps)} mph, target ${limit}`;
    }
  }
}
