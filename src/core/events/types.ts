// Event contract from README section 9, extended with the location coach's events
// (src/core/location/events.ts) and crowd hotspots. `eventId` and `t` let reports and the
// cloud reference individual events; use `toDriveEvent` to stamp an id on a raw event.
export type HotspotKind = 'rolling_stop' | 'ran_stop' | 'erratic_driving';

export type DriveEventBody =
  | { kind: 'crash'; severity: 'critical'; confirmed: boolean }
  | { kind: 'erratic_driving'; severity: 'warn'; score: number }
  | { kind: 'stop_sign_ahead'; severity: 'info'; distanceM: number; featureId?: number }
  | { kind: 'traffic_light_ahead'; severity: 'info'; distanceM: number; featureId?: number }
  | {
      kind: 'highway_entering' | 'highway_exiting';
      severity: 'info' | 'warn';
      /** Speeds are metres per second; the voice layer converts them for speech. */
      speedMps: number;
      targetSpeedMps: number;
      targetIsDefault: boolean;
      advice: 'speed_up' | 'slow_down' | 'ok';
      road?: string;
    }
  | { kind: 'stop_ok' | 'rolling_stop' | 'ran_stop'; severity: 'info' | 'warn' }
  | {
      /** A place where several other drivers had trouble (from the cloud's hotspot list). */
      kind: 'hotspot_ahead';
      severity: 'info';
      distanceM: number;
      cell: string;
      topKind: HotspotKind;
      drivers: number;
      /** True when the cloud's data came only from seeded demo drivers. */
      demo: boolean;
    };

export type DriveEvent = DriveEventBody & {
  eventId: string;
  /** Epoch milliseconds when the event was detected. */
  t: number;
};

export type DriveEventKind = DriveEvent['kind'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A detected event before the bus has given it an id. */
export type DriveEventInput = DistributiveOmit<DriveEvent, 'eventId'>;

export function createIdGenerator(prefix = 'e'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

export function toDriveEvent(input: DriveEventInput, nextId: () => string): DriveEvent {
  return { ...input, eventId: nextId() } as DriveEvent;
}

/**
 * Raw candidate events from the heuristic IMU pipeline (src/core/imu). They carry a confidence and the
 * numbers behind it, and use the monotonic sample clock. `fromImu.ts` turns them into `DriveEvent`s
 * for the rest of the app (voice, trip record).
 */
export type ImuEvent = Readonly<{
  kind: 'crash_candidate' | 'swerve_candidate';
  occurredAtMs: number;
  severity: 'warning' | 'critical';
  confidence: number;
  evidence: Readonly<Record<string, number>>;
}>;
