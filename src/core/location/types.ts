import type { LatLon } from './geo';

/**
 * One GPS reading (README section 9). `speed` is metres per second and
 * `heading` is degrees clockwise from true north; expo-location reports -1
 * for either when unknown.
 */
export type GpsFix = LatLon & { t: number; speed: number; heading: number };

/** Point features the coach announces on approach. */
export type RoadFeatureKind = 'stop' | 'traffic_signals';

export type RoadFeature = LatLon & {
  /** OSM node id. */
  id: number;
  kind: RoadFeatureKind;
  /**
   * Compass bearing the sign or signal faces, when OSM gives one as degrees or
   * a cardinal (`direction=N`, `direction=225`). A sign facing north is read by
   * traffic heading south. null when untagged or tagged `forward`/`backward`,
   * which are relative to the way and need way geometry we don't use for this.
   */
  facingDeg: number | null;
  /** Raw `direction` tag, kept for debugging. */
  directionTag?: string;
};

/**
 * Controlled-access roads used for highway entry and exit coaching. Only
 * `motorway` counts as the highway: `trunk_link` is also used for ordinary
 * turn lanes at signalized intersections and would cause false alerts.
 */
export type RoadKind = 'motorway' | 'motorway_link';

export type RoadWay = {
  /** OSM way id. */
  id: number;
  kind: RoadKind;
  /** Node coordinates in way order. */
  geometry: LatLon[];
  /** 1 = traffic flows in way order, -1 = against it, 0 = both directions. */
  oneway: 1 | -1 | 0;
  /** Posted limit from `maxspeed`, metres per second, or null if untagged. */
  maxspeedMps: number | null;
  ref?: string;
  name?: string;
};

/** Everything we keep for one map tile. */
export type TileContents = { features: RoadFeature[]; roads: RoadWay[] };
