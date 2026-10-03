import { normalizeBearing } from './geo.ts';
import type { BBox } from './tiles.ts';

// Pure Overpass helpers: build the query for a tile and parse the JSON reply.
// The network call itself lives in src/integrations/location/overpassClient.ts.

export type StopSign = {
  /** OSM node id. */
  id: number;
  lat: number;
  lon: number;
  /**
   * Compass bearing the sign face points toward, when OSM gives one as degrees
   * or a cardinal (`direction=N`, `direction=225`). A sign facing north is read
   * by traffic heading south. null when untagged or tagged `forward`/`backward`,
   * which are relative to the way and need way geometry we don't fetch yet.
   */
  facingDeg: number | null;
  /** Raw `direction` tag, kept for debugging and later forward/backward support. */
  directionTag?: string;
};

export type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
};

export type OverpassResponse = { elements?: OverpassElement[] };

export function buildStopSignQuery(b: BBox, timeoutS = 25): string {
  const bbox = [b.south, b.west, b.north, b.east].map((n) => n.toFixed(6)).join(',');
  return `[out:json][timeout:${timeoutS}];node["highway"="stop"](${bbox});out body;`;
}

const CARDINALS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

/** Parse an OSM `direction` value into degrees, or null if it isn't absolute. */
export function parseDirectionTag(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  if (v in CARDINALS) return CARDINALS[v];
  if (/^-?\d+(\.\d+)?$/.test(v)) return normalizeBearing(Number(v));
  return null;
}

export function parseStopSigns(res: OverpassResponse): StopSign[] {
  const signs: StopSign[] = [];
  for (const el of res.elements ?? []) {
    if (el.type !== 'node' || typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
    if (el.tags?.highway !== 'stop') continue;
    const directionTag = el.tags.direction;
    signs.push({
      id: el.id,
      lat: el.lat,
      lon: el.lon,
      facingDeg: parseDirectionTag(directionTag),
      ...(directionTag ? { directionTag } : {}),
    });
  }
  return signs;
}
