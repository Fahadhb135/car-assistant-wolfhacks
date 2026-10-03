import { imuEventToDriveEventInput } from '../../core/events/fromImu';
import {
  createIdGenerator,
  toDriveEvent,
  type DriveEvent,
  type ImuEvent,
} from '../../core/events/types';
import type { VoiceCoordinator } from '../voice/VoiceCoordinator';

export type ImuEventRouterOptions = Readonly<{
  voice: Pick<VoiceCoordinator, 'handleEvent'>;
  onEvent?: (event: DriveEvent) => void;
  nextId?: () => string;
  wallClockNow?: () => number;
}>;

/** Routes detector candidates onto the same event path used by location coaching and replay. */
export class ImuEventRouter {
  private readonly nextId: () => string;
  private readonly wallClockNow: () => number;
  private epochOffsetMs: number | undefined;

  constructor(private readonly options: ImuEventRouterOptions) {
    this.nextId = options.nextId ?? createIdGenerator('imu-');
    this.wallClockNow = options.wallClockNow ?? Date.now;
  }

  route(candidate: ImuEvent): DriveEvent {
    // Freeze the monotonic-to-epoch relationship on the first event in this drive. Computing it for
    // every event would introduce wall-clock jumps into otherwise monotonic sensor timestamps.
    this.epochOffsetMs ??= this.wallClockNow() - candidate.occurredAtMs;
    const event = toDriveEvent(
      imuEventToDriveEventInput(candidate, this.epochOffsetMs),
      this.nextId,
    );
    this.options.onEvent?.(event);
    this.options.voice.handleEvent(event);
    return event;
  }
}
