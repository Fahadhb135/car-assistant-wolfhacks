import type { DriveEvent } from '../../core/events/types';

export type CoachMessage = { title: string; detail: string; tone: 'calm' | 'info' | 'warn' | 'urgent' };

export const CLEAR_ROAD: CoachMessage = { title: 'Road is clear ahead', detail: 'Keep your current pace.', tone: 'calm' };

const mph = (mps: number) => Math.round(mps / 0.44704);

/** Text for the drive screen's coach card; mirrors what the voice says, with the numbers. */
export function coachMessage(e: DriveEvent): CoachMessage {
  switch (e.kind) {
    case 'crash':
      return { title: 'Possible crash', detail: 'Are you okay?', tone: 'urgent' };
    case 'stop_sign_ahead':
      return { title: 'Stop sign ahead', detail: `${Math.round(e.distanceM)} m. Start slowing down.`, tone: 'info' };
    case 'traffic_light_ahead':
      return { title: 'Traffic light ahead', detail: `${Math.round(e.distanceM)} m.`, tone: 'info' };
    case 'hotspot_ahead':
      return {
        title: 'Tricky spot ahead',
        detail:
          e.topKind === 'ran_stop'
            ? 'Other new drivers often run the stop here.'
            : e.topKind === 'rolling_stop'
              ? 'Other new drivers often roll through the stop here.'
              : 'Other new drivers often struggle here.',
        tone: 'warn',
      };
    case 'highway_entering':
      return e.advice === 'speed_up'
        ? { title: 'Merging onto the highway', detail: `Speed up to about ${mph(e.targetSpeedMps)} mph.`, tone: 'warn' }
        : { title: 'Merging onto the highway', detail: 'Good speed. Match traffic.', tone: 'info' };
    case 'highway_exiting':
      return e.advice === 'slow_down'
        ? { title: 'Exit ahead', detail: `Slow down to about ${mph(e.targetSpeedMps)} mph for the ramp.`, tone: 'warn' }
        : { title: 'Taking the exit', detail: 'Good speed for the ramp.', tone: 'info' };
    case 'rolling_stop':
      return { title: 'Rolling stop', detail: 'Come to a full stop next time.', tone: 'warn' };
    case 'ran_stop':
      return { title: 'Missed the stop', detail: 'Start slowing down earlier.', tone: 'urgent' };
    case 'stop_ok':
      return { title: 'Nice stop', detail: 'Full stop. Well done.', tone: 'info' };
    case 'speeding':
      return {
        title: 'Slow down',
        detail: `You're going ${mph(e.speedMps)} mph. The limit${e.road ? ` on ${e.road}` : ''} is ${mph(e.limitMps)} mph.`,
        tone: 'warn',
      };
    case 'erratic_driving':
      return { title: 'Unsteady driving', detail: 'Ease off and stay in your lane.', tone: 'warn' };
  }
}
