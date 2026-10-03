// Manual check for highway entry/exit coaching on real OSM ramps.
//
//   npx tsx scripts/try-highway.mts <lat> <lon> [--limit N]
//
// Loads the map tile around the point, finds on-ramps (ramp ends on the
// highway) and off-ramps (ramp starts on the highway), and drives each one
// through the real LocationCoach along the actual ramp geometry:
//   on-ramp:  200 m of local road, the ramp, then 300 m of highway, at 25 mph
//   off-ramp: 600 m of highway, then the ramp, at 65 mph
// For each it prints the coaching event and a map link to the ramp.

import { LocationCoach } from '../src/core/location/coach';
import { bearingDeg, destination, distanceM, type LatLon } from '../src/core/location/geo';
import { tileKeyFor } from '../src/core/location/tiles';
import type { GpsFix, RoadKind, RoadWay } from '../src/core/location/types';
import type { LocationEvent } from '../src/core/location/events';
import { describeEvent } from './lib/describeEvent';
import { devTileCache } from './lib/devTileCache';

const MPH = 0.44704;
const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : 3;
const [lat, lon] = (limitAt >= 0 ? args.filter((_, i) => i !== limitAt && i !== limitAt + 1) : args).map(Number);
if (![lat, lon].every(Number.isFinite)) {
  console.error('usage: npx tsx scripts/try-highway.mts <lat> <lon> [--limit N]');
  process.exit(1);
}

const cache = devTileCache();
const key = tileKeyFor({ lat, lon });
const tile = await cache.getTile(key);
if (!tile) process.exit(1);
const roads = tile.roads.filter((r) => r.oneway === 1);
const highways = roads.filter((r) => r.kind === 'motorway');
const ramps = roads.filter((r) => r.kind === 'motorway_link');
console.log(`Tile ${key}: ${highways.length} highway ways, ${ramps.length} ramp ways\n`);
if (!ramps.length) {
  console.log('No ramps here. Try a point next to a highway interchange.');
  process.exit(0);
}

const same = (a: LatLon, b: LatLon) => distanceM(a, b) < 0.5;
const first = (r: RoadWay) => r.geometry[0];
const last = (r: RoadWay) => r.geometry[r.geometry.length - 1];
const length = (pts: LatLon[]) => pts.slice(1).reduce((sum, p, i) => sum + distanceM(pts[i], p), 0);

/** Follow ways of `kind` forward from `start` (a node on one of them) for at least `minM`. */
function forward(start: LatLon, kind: RoadKind, minM: number): LatLon[] {
  const path: LatLon[] = [start];
  let at = start;
  while (length(path) < minM) {
    const way = roads.find((r) => r.kind === kind && r.geometry.slice(0, -1).some((p) => same(p, at)));
    if (!way) break;
    const i = way.geometry.findIndex((p) => same(p, at));
    path.push(...way.geometry.slice(i + 1));
    at = last(way);
  }
  return path;
}

/** Follow ways of `kind` backward from `end` for at least `minM`. Returned in travel order. */
function backward(end: LatLon, kind: RoadKind, minM: number): LatLon[] {
  const path: LatLon[] = [end];
  let at = end;
  while (length(path) < minM) {
    const way = roads.find((r) => r.kind === kind && r.geometry.slice(1).some((p) => same(p, at)));
    if (!way) break;
    const i = way.geometry.findIndex((p, j) => j > 0 && same(p, at));
    path.unshift(...way.geometry.slice(0, i));
    at = first(way);
  }
  return path;
}

/** Fixes every 15 m along a polyline at a constant speed, ~1 Hz-ish timestamps. */
function drive(points: LatLon[], speed: number): GpsFix[] {
  const fixes: GpsFix[] = [];
  let t = 0;
  for (let i = 1; i < points.length; i++) {
    const heading = bearingDeg(points[i - 1], points[i]);
    for (let d = 0; d < distanceM(points[i - 1], points[i]); d += 15) {
      fixes.push({ ...destination(points[i - 1], heading, d), heading, speed, t: (t += 1000) });
    }
  }
  return fixes;
}

async function run(label: string, ramp: RoadWay, path: LatLon[], speed: number): Promise<void> {
  const coach = new LocationCoach();
  const events: LocationEvent[] = [];
  for (const fix of drive(path, speed)) {
    await cache.update(fix); // the route may leave this tile
    events.push(...coach.update(fix, [], cache.roadsNear(fix)).filter((e) => e.kind.startsWith('highway')));
  }
  const mid = ramp.geometry[Math.floor(ramp.geometry.length / 2)];
  console.log(`${label} way ${ramp.id}  https://www.openstreetmap.org/way/${ramp.id}`);
  console.log(`  ${mid.lat.toFixed(5)},${mid.lon.toFixed(5)}  driven at ${Math.round(speed / MPH)} mph, ended on: ${coach.roadClass}`);
  console.log(events.length ? events.map((e) => `  ${describeEvent(e)}`).join('\n') : '  (no highway event)');
  console.log();
}

// On-ramps: the ramp chain ends on a highway node.
const onRamps = ramps.filter((r) => highways.some((h) => h.geometry.some((p) => same(p, last(r))))).slice(0, limit);
for (const ramp of onRamps) {
  const rampPath = backward(last(ramp), 'motorway_link', Infinity);
  const start = rampPath[0];
  // 200 m of "local road" leading straight into the ramp's first segment.
  const approach = destination(start, bearingDeg(rampPath[1], start), 200);
  const highwayPath = forward(last(ramp), 'motorway', 300);
  await run('ON-RAMP ', ramp, [approach, ...rampPath, ...highwayPath.slice(1)], 25 * MPH);
}

// Off-ramps: the ramp chain starts on a highway node.
const offRamps = ramps.filter((r) => highways.some((h) => h.geometry.some((p) => same(p, first(r))))).slice(0, limit);
for (const ramp of offRamps) {
  const highwayPath = backward(first(ramp), 'motorway', 600);
  const rampPath = forward(first(ramp), 'motorway_link', 400);
  await run('OFF-RAMP', ramp, [...highwayPath, ...rampPath.slice(1)], 65 * MPH);
}

if (!onRamps.length && !offRamps.length) console.log('Found ramps, but none connect to a highway inside this tile.');
