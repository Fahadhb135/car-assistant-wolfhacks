import type { DriveEvent } from '../../../core/events/types';

/** Trip context sent with a coach question. */
export type TripContext = {
  speedKmh?: number;
  smoothness?: number;
  elapsedMin?: number;
};

const mph = (mps: number) => Math.round(mps / 0.44704);

/** One plain-English line per event, sent to the coach as context for its answer. */
export function describeEvent(e: DriveEvent): string {
  switch (e.kind) {
    case 'crash':
      return e.confirmed ? 'A crash was confirmed.' : 'A possible crash was detected.';
    case 'erratic_driving':
      return `Erratic driving was flagged (score ${e.score.toFixed(2)}).`;
    case 'stop_sign_ahead':
      return `A stop sign was ahead (${Math.round(e.distanceM)} m).`;
    case 'stop_ok':
      return 'The driver stopped correctly at a stop sign.';
    case 'rolling_stop':
      return 'The driver rolled through a stop sign.';
    case 'ran_stop':
      return 'The driver ran a stop sign.';
    case 'traffic_light_ahead':
      return `A traffic light was ahead (${Math.round(e.distanceM)} m).`;
    case 'highway_entering':
      return e.advice === 'speed_up'
        ? `The driver merged onto the highway slowly (${mph(e.speedMps)} mph vs about ${mph(e.targetSpeedMps)}).`
        : 'The driver merged onto the highway at a good speed.';
    case 'highway_exiting':
      return e.advice === 'slow_down'
        ? `The driver took the exit ramp fast (${mph(e.speedMps)} mph vs about ${mph(e.targetSpeedMps)}).`
        : 'The driver took the exit ramp at a good speed.';
    case 'hotspot_ahead':
      return 'The driver was warned about a spot where other drivers often have trouble.';
  }
}
