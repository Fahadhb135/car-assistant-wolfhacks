// Checks OSM stop signs and traffic lights against the real world.
//
//   npx tsx --env-file=.env scripts/verify-signs.mts <lat> <lon> <heading> [--all] [--lights]
//
// By default it checks the stop signs ahead of the car (what the coach would
// act on). --lights checks traffic lights instead; --all checks every one in
// the car's tile.
//
// With MAPILLARY_TOKEN set (free: https://www.mapillary.com/dashboard/developers),
// each OSM feature is matched against what Mapillary's computer vision detected
// in street-level photos:
//   confirmed    a Mapillary detection within the match radius
//   unconfirmed  no detection nearby. Often just no imagery there; check Street View.
// With --all it also lists Mapillary detections OSM is missing.
//
// Without a token it prints a Street View link per feature, aimed at it, for a
// quick manual check. Keep the token in .env (gitignored).

import { bearingDeg, destination, distanceM, type LatLon } from '../src/core/location/geo';
import { tileBounds, tileKeyFor, type BBox } from '../src/core/location/tiles';
import type { RoadFeature, RoadFeatureKind } from '../src/core/location/types';
import { devTileCache } from './lib/devTileCache';

type Check = { label: string; mapillaryValues: string[]; matchRadiusM: number };

const CHECKS: Record<RoadFeatureKind, Check> = {
  stop: { label: 'stop sign', mapillaryValues: ['regulatory--stop--g1', 'regulatory--stop--g2'], matchRadiusM: 25 },
  // OSM usually puts the signal node at the intersection centre while the lights
  // hang on the far side or on mast arms, so allow a whole intersection's width.
  // Vehicle signals only: pedestrian and cyclist signals are left out.
  traffic_signals: {
    label: 'traffic light',
    mapillaryValues: ['upright', 'horizontal', 'single'].flatMap((shape) =>
      ['', '-front', '-side', '-back'].map((view) => `object--traffic-light--general-${shape}${view}`),
    ),
    matchRadiusM: 40,
  },
};

type Detection = LatLon & { id: string };

const args = process.argv.slice(2);
const checkAll = args.includes('--all');
const kind: RoadFeatureKind = args.includes('--lights') ? 'traffic_signals' : 'stop';
const check = CHECKS[kind];
const [lat, lon, heading] = args.filter((a) => !a.startsWith('--')).map(Number);
if ([lat, lon, heading].some((n) => !Number.isFinite(n))) {
  console.error('usage: npx tsx --env-file=.env scripts/verify-signs.mts <lat> <lon> <heading> [--all] [--lights]');
  process.exit(1);
}

const car = { lat, lon, heading };
const key = tileKeyFor(car);
const cache = devTileCache();
await cache.update(car);

const features: RoadFeature[] = checkAll
  ? (cache.peek(key)?.features ?? []).filter((f) => f.kind === kind)
  : cache.featuresAhead(car, { kinds: [kind] }).map((a) => a.feature);
if (features.length === 0) {
  console.log(checkAll ? `No ${check.label}s loaded for tile ${key}.` : `No ${check.label}s ahead of the car.`);
  process.exit(0);
}

/** Street View link from 25 m before the feature (on the car's side), looking at it. */
function streetViewUrl(f: RoadFeature): string {
  const from = distanceM(car, f) > 25 ? bearingDeg(f, car) : (heading + 180) % 360;
  const view = destination(f, from, 25);
  const look = bearingDeg(view, f).toFixed(0);
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${view.lat.toFixed(6)},${view.lon.toFixed(6)}&heading=${look}`;
}

async function fetchMapillary(token: string, b: BBox): Promise<Detection[]> {
  const params = new URLSearchParams({
    access_token: token,
    fields: 'id,object_value,geometry',
    bbox: [b.west, b.south, b.east, b.north].join(','),
    object_values: check.mapillaryValues.join(','),
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
console.log(`Checking ${features.length} OSM ${check.label}(s) ${checkAll ? `in tile ${key}` : 'ahead of the car'}\n`);

if (!token) {
  console.log('No MAPILLARY_TOKEN set, so here are Street View links to check by eye:\n');
  for (const f of features) {
    console.log(`  node ${f.id}  ${distanceM(car, f).toFixed(0).padStart(4)} m from car`);
    console.log(`    ${streetViewUrl(f)}`);
  }
  process.exit(0);
}

let detections: Detection[];
try {
  detections = await fetchMapillary(token, tileBounds(key));
} catch (err) {
  console.error(`Could not query Mapillary (${(err as Error).message}). Check MAPILLARY_TOKEN.`);
  process.exit(1);
}
console.log(`Mapillary has ${detections.length} ${check.label} detection(s) in the tile.\n`);

let confirmed = 0;
for (const f of features) {
  let best: number | undefined;
  for (const det of detections) best = Math.min(best ?? Infinity, distanceM(f, det));
  const ok = best !== undefined && best <= check.matchRadiusM;
  if (ok) confirmed++;
  const detail = best !== undefined ? `nearest detection ${best.toFixed(0)} m` : 'no detections';
  console.log(`  ${ok ? 'confirmed  ' : 'UNCONFIRMED'}  node ${f.id}  (${detail})`);
  if (!ok) console.log(`               ${streetViewUrl(f)}`);
}

// Detections OSM doesn't have. Only meaningful when checking the whole tile.
// Mapillary often has several detections of one real sign or light (different
// photos, front and back), so treat this list as an upper bound.
if (checkAll) {
  const missing = detections.filter((det) => features.every((f) => distanceM(f, det) > check.matchRadiusM));
  if (missing.length) {
    console.log(`\nMapillary ${check.label}s with no OSM one within ${check.matchRadiusM} m (possibly missing from OSM):`);
    for (const det of missing) {
      console.log(`  ${det.lat.toFixed(6)},${det.lon.toFixed(6)}  https://www.mapillary.com/app/?focus=map&mapFeatureKey=${det.id}`);
    }
  }
}

console.log(`\n${confirmed}/${features.length} confirmed by Mapillary.`);
