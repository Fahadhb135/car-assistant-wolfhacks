import { normalizeBearing, type LatLon } from './geo';
import type { BBox } from './tiles';
import type { RoadFeature, RoadKind, RoadWay, TileContents } from './types';

// Pure Overpass helpers: build the query for a tile and parse the JSON reply.
// The network call itself lives in src/integrations/location/overpassClient.ts.
//
// One query per tile fetches everything the location coach needs:
//   stop signs        node highway=stop
//   traffic lights    node highway=traffic_signals
//   highway + ramps   way  highway=motorway / motorway_link, with geometry

export type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  geometry?: LatLon[];
  tags?: Record<string, string>;
};

export type OverpassResponse = { elements?: OverpassElement[] };

const FEATURE_TAGS: Record<string, RoadFeature['kind']> = { stop: 'stop', traffic_signals: 'traffic_signals' };
const ROAD_TAGS: Record<string, RoadKind> = { motorway: 'motorway', motorway_link: 'motorway_link' };

export function buildTileQuery(b: BBox, timeoutS = 25): string {
  const bbox = [b.south, b.west, b.north, b.east].map((n) => n.toFixed(6)).join(',');
  return (
    `[out:json][timeout:${timeoutS}];(` +
    `node["highway"~"^(stop|traffic_signals)$"](${bbox});` +
    `way["highway"~"^(motorway|motorway_link)$"](${bbox});` +
    `);out geom;`
  );
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

const MPH = 0.44704;
const KMH = 1 / 3.6;

/** Parse an OSM `maxspeed` value ("65 mph", "100", "50 km/h") into m/s. */
export function parseMaxspeed(raw: string | undefined): number | null {
  const m = raw?.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?$/);
  if (!m) return null; // "none", "signals", "US:urban", ...
  return Number(m[1]) * (m[2] === 'mph' ? MPH : KMH);
}

/** Motorways and their ramps are one-way unless tagged otherwise. */
function parseOneway(tags: Record<string, string>): RoadWay['oneway'] {
  const v = tags.oneway;
  if (v === '-1') return -1;
  if (v === 'no') return 0;
  return 1;
}

export function parseTile(res: OverpassResponse): TileContents {
  const features: RoadFeature[] = [];
  const roads: RoadWay[] = [];
  for (const el of res.elements ?? []) {
    const tags = el.tags ?? {};
    if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
      const kind = FEATURE_TAGS[tags.highway];
      if (!kind) continue;
      const directionTag = tags.direction;
      features.push({
        id: el.id,
        kind,
        lat: el.lat,
        lon: el.lon,
        facingDeg: parseDirectionTag(directionTag),
        ...(directionTag ? { directionTag } : {}),
      });
    } else if (el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      const kind = ROAD_TAGS[tags.highway];
      if (!kind) continue;
      roads.push({
        id: el.id,
        kind,
        geometry: el.geometry.map(({ lat, lon }) => ({ lat, lon })),
        oneway: parseOneway(tags),
        maxspeedMps: parseMaxspeed(tags.maxspeed),
        ...(tags.ref ? { ref: tags.ref } : {}),
        ...(tags.name ? { name: tags.name } : {}),
      });
    }
  }
  return { features, roads };
}
