// Checks OSM stop signs against the real world.
//
//   node --experimental-strip-types scripts/verify-signs.ts <lat> <lon> <heading> [--all]
//
// By default it checks the signs ahead of the car (what the coach would act on);
// --all checks every stop sign in the car's tile.
//
// With MAPILLARY_TOKEN set (free: https://www.mapillary.com/dashboard/developers),
// each OSM sign is matched against stop signs that Mapillary's computer vision
// detected in street-level photos:
//   confirmed    a Mapillary detection within MATCH_RADIUS_M
//   unconfirmed  no detection nearby. Often just no imagery there; check Street View.
// It also lists Mapillary stop signs that OSM is missing.
//
// Without a token it prints a Street View link per sign, aimed at the sign,
// for a quick manual check.
//
// Put the token in .env (gitignored) and run with --env-file=.env:
//   node --env-file=.env --experimental-strip-types scripts/verify-signs.ts 35.7832 -78.632953 0

import { bearingDeg, destination, distanceM, type LatLon } from '../src/core/location/geo.ts';
import type { StopSign } from '../src/core/location/overpass.ts';
import { tileBounds, tileKeyFor, type BBox } from '../src/core/location/tiles.ts';
import { OverpassClient } from '../src/integrations/location/overpassClient.ts';
import { TileCache } from '../src/integrations/location/tileCache.ts';
import { FileTileStore } from './lib/fileTileStore.ts';

const MATCH_RADIUS_M = 25;
const MAPILLARY_STOP_VALUES = ['regulatory--stop--g1', 'regulatory--stop--g2'];

type Detection = LatLon & { id: string };

const args = process.argv.slice(2);
const checkAll = args.includes('--all');
const [lat, lon, heading] = args.filter((a) => a !== '--all').map(Number);
if ([lat, lon, heading].some((n) => !Number.isFinite(n))) {
  console.error('usage: node --experimental-strip-types scripts/verify-signs.ts <lat> <lon> <heading> [--all]');
  process.exit(1);
}

const car = { lat, lon, heading };
const key = tileKeyFor(car);
const cache = new TileCache({
  client: new OverpassClient({ timeoutMs: 20_000 }),
  store: new FileTileStore(),
  maxAgeMs: Infinity,
  onError: (k, err) => console.error(`  ! tile ${k} failed:`, (err as { failures?: string[] }).failures ?? err),
});
await cache.update(car);

const signs: StopSign[] = checkAll
  ? (cache.peek(key)?.signs ?? [])
  : cache.signsAhead(car).map((s) => s.sign);
if (signs.length === 0) {
  console.log(checkAll ? `No stop signs loaded for tile ${key}.` : 'No stop signs ahead of the car.');
  process.exit(0);
}

/** Street View link from MATCH_RADIUS_M before the sign (on the car's side), looking at it. */
function streetViewUrl(sign: StopSign): string {
  const from = distanceM(car, sign) > MATCH_RADIUS_M ? bearingDeg(sign, car) : (heading + 180) % 360;
  const view = destination(sign, from, MATCH_RADIUS_M);
  const look = bearingDeg(view, sign).toFixed(0);
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${view.lat.toFixed(6)},${view.lon.toFixed(6)}&heading=${look}`;
}

async function fetchMapillaryStops(token: string, b: BBox): Promise<Detection[]> {
  const params = new URLSearchParams({
    access_token: token,
    fields: 'id,object_value,geometry',
    bbox: [b.west, b.south, b.east, b.north].join(','),
    object_values: MAPILLARY_STOP_VALUES.join(','),
    limit: '2000',
  });
  const out: Detection[] = [];
  let url: string | undefined = `https://graph.mapillary.com/map_features?${params}`;
  while (url) {
    const res = await fetch(url);
    const body = (await res.json()) as {
      data?: { id: string; geometry: { coordinates: [number, number] } }[];
      paging?: { next?: string };
      error?: { message: string };
    };
    if (!res.ok || body.error) throw new Error(`Mapillary: ${body.error?.message ?? `HTTP ${res.status}`}`);
    for (const f of body.data ?? []) {
      out.push({ id: f.id, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
    }
    url = body.paging?.next;
  }
  return out;
}

const token = process.env.MAPILLARY_TOKEN;
console.log(`Checking ${signs.length} OSM stop sign(s) ${checkAll ? `in tile ${key}` : 'ahead of the car'}\n`);

if (!token) {
  console.log('No MAPILLARY_TOKEN set, so here are Street View links to check by eye:\n');
  for (const s of signs) {
    console.log(`  node ${s.id}  ${distanceM(car, s).toFixed(0).padStart(4)} m from car`);
    console.log(`    ${streetViewUrl(s)}`);
  }
  process.exit(0);
}

let detections: Detection[];
try {
  detections = await fetchMapillaryStops(token, tileBounds(key));
} catch (err) {
  console.error(`Could not query Mapillary (${(err as Error).message}). Check MAPILLARY_TOKEN.`);
  process.exit(1);
}
console.log(`Mapillary has ${detections.length} detected stop sign(s) in the tile.\n`);

let confirmed = 0;
const matched = new Set<string>();
for (const s of signs) {
  let best: { d: number; det: Detection } | undefined;
  for (const det of detections) {
    const d = distanceM(s, det);
    if (!best || d < best.d) best = { d, det };
  }
  const ok = best !== undefined && best.d <= MATCH_RADIUS_M;
  if (ok) {
    confirmed++;
    matched.add(best!.det.id);
  }
  const detail = best ? `nearest detection ${best.d.toFixed(0)} m` : 'no detections';
  console.log(`  ${ok ? 'confirmed  ' : 'UNCONFIRMED'}  node ${s.id}  (${detail})`);
  if (!ok) console.log(`               ${streetViewUrl(s)}`);
}

// Detections OSM doesn't have. Only meaningful when checking the whole tile.
if (checkAll) {
  const missing = detections.filter(
    (det) => !matched.has(det.id) && signs.every((s) => distanceM(s, det) > MATCH_RADIUS_M),
  );
  if (missing.length) {
    console.log(`\nMapillary stop signs with no OSM sign within ${MATCH_RADIUS_M} m (possibly missing from OSM):`);
    for (const det of missing) {
      console.log(`  ${det.lat.toFixed(6)},${det.lon.toFixed(6)}  https://www.mapillary.com/app/?focus=map&mapFeatureKey=${det.id}`);
    }
  }
}

console.log(`\n${confirmed}/${signs.length} confirmed by Mapillary.`);
