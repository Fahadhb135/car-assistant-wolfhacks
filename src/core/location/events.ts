// Events emitted by the location coach. They are members of the app-wide
// DriveEvent union (README section 9) and go on the same event bus.
// Speeds are metres per second; the voice layer converts for speech.

type Base = { t: number };

export type FeatureAheadEvent = Base & {
  kind: 'stop_sign_ahead' | 'traffic_light_ahead';
  severity: 'info';
  distanceM: number;
  /** OSM node id, so the stop-sign state machine can follow the same sign. */
  featureId: number;
};

export type HighwayEvent = Base & {
  /** Car moved from local roads onto an on-ramp, or from the highway onto an off-ramp. */
  kind: 'highway_entering' | 'highway_exiting';
  /** 'warn' when the driver should change speed, otherwise 'info'. */
  severity: 'info' | 'warn';
  speedMps: number;
  /** Highway limit when entering, ramp limit when exiting. */
  targetSpeedMps: number;
  /** True when OSM had no maxspeed and the coach used its default. */
  targetIsDefault: boolean;
  advice: 'speed_up' | 'slow_down' | 'ok';
  /** Highway ref or name if OSM has one, e.g. "I 440". */
  road?: string;
};

export type LocationEvent = FeatureAheadEvent | HighwayEvent;
