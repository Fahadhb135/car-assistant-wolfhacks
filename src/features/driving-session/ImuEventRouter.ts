import { imuEventToDriveEventInput } from '../../core/events/fromImu';
import {
  createIdGenerator,
  toDriveEvent,
  type DriveEvent,
  type ImuEvent,
} from '../../core/events/types';
import type { DriveEventSink } from './DriveEventGate';

export type ImuEventRouterOptions = Readonly<{
  eventSink: DriveEventSink;
  nextId?: () => string;
  wallClockNow?: () => number;
}>;

/** Converts detector candidates and sends them through the drive's single shared event gate. */
export class ImuEventRouter {
  private readonly nextId: () => string;
  private readonly wallClockNow: () => number;
  private epochOffsetMs: number | undefined;

  constructor(private readonly options: ImuEventRouterOptions) {
    this.nextId = options.nextId ?? createIdGenerator('imu-');
    this.wallClockNow = options.wallClockNow ?? Date.now;
  }

  route(candidate: ImuEvent): DriveEvent | undefined {
    // Freeze the monotonic-to-epoch relationship on the first event in this drive. Computing it for
    // every event would introduce wall-clock jumps into otherwise monotonic sensor timestamps.
    this.epochOffsetMs ??= this.wallClockNow() - candidate.occurredAtMs;
    const event = toDriveEvent(
      imuEventToDriveEventInput(candidate, this.epochOffsetMs),
      this.nextId,
    );
    return this.options.eventSink.route(event) ? event : undefined;
  }
}
