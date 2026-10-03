// Manual check for the location code against the live Overpass API.
//
//   npx tsx scripts/try-location.mts <lat> <lon> <heading> [driveMeters] [speedMph]
//
// Prints the car's tile, the stop signs, traffic lights and highway/ramp ways
// it holds, and the features ahead. With driveMeters, it also "drives" straight
// along the heading in 25 m steps (default 25 mph), running the real coach and
// logging tile changes, prefetches and every coaching event.
//
// Tiles are saved to .cache/tiles/, so once a tile has downloaded, later runs
// work even when the public Overpass servers are busy. Delete the folder to refetch.

import { LocationCoach } from '../src/core/location/coach';
import { destination } from '../src/core/location/geo';
import { nextTileToPrefetch, tileBounds, tileKeyFor } from '../src/core/location/tiles';
import { describeEvent } from './lib/describeEvent';
import { devTileCache } from './lib/devTileCache';

const MPH = 0.44704;
const [lat, lon, heading, drive = 0, speedMph = 25] = process.argv.slice(2).map(Number);
if ([lat, lon, heading].some((n) => !Number.isFinite(n))) {
  console.error('usage: npx tsx scripts/try-location.mts <lat> <lon> <heading> [driveMeters] [speedMph]');
  process.exit(1);
}

const cache = devTileCache();
const start = { lat, lon, heading };
const key = tileKeyFor(start);
const t0 = Date.now();
await cache.update(start);
const tile = cache.peek(key);

const count = (kind: string) => tile?.features.filter((f) => f.kind === kind).length ?? 0;
const roads = (kind: string) => tile?.roads.filter((r) => r.kind === kind).length ?? 0;
console.log(`Tile ${key}  bounds ${JSON.stringify(tileBounds(key))}`);
console.log(
  `Loaded ${count('stop')} stop signs, ${count('traffic_signals')} traffic lights, ${roads('motorway')} highway ways, ` +
    `${roads('motorway_link')} ramp ways (source: ${tile?.source ?? 'none'}) in ${Date.now() - t0} ms\n`,
);

const ahead = cache.featuresAhead(start);
console.log(ahead.length ? `Ahead (heading ${heading}°):` : `No stop signs or traffic lights within 200 m ahead (heading ${heading}°).`);
for (const { feature, distanceM, bearingDeg } of ahead) {
  console.log(
    `  ${feature.kind === 'stop' ? 'stop sign    ' : 'traffic light'}  ${distanceM.toFixed(0).padStart(4)} m at ` +
      `${bearingDeg.toFixed(0).padStart(3)}°  facing ${feature.facingDeg ?? '?'}  https://www.openstreetmap.org/node/${feature.id}`,
  );
}

if (drive > 0) {
  console.log(`\nDriving ${drive} m at ${heading}°, ${speedMph} mph...`);
  const coach = new LocationCoach();
  let lastTile = key;
  for (let d = 0, t = 0; d <= drive; d += 25, t += 1000) {
    const fix = { ...destination(start, heading, d), heading, speed: speedMph * MPH, t };
    const next = nextTileToPrefetch(fix);
    await cache.update(fix);
    const here = tileKeyFor(fix);
    const events = coach.update(fix, cache.featuresAhead(fix), cache.roadsNear(fix));
    const notes = [
      here !== lastTile ? `entered tile ${here} (${cache.peek(here) ? 'already loaded' : 'NOT loaded'})` : '',
      next ? `prefetch ${next}` : '',
      ...events.map(describeEvent),
    ].filter(Boolean);
    console.log(`  ${String(d).padStart(5)} m  ${fix.lat.toFixed(5)},${fix.lon.toFixed(5)}  ${notes.join(' | ')}`);
    lastTile = here;
  }
}
