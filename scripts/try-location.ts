// Manual check for the location code against the live Overpass API.
//
//   node --experimental-strip-types scripts/try-location.ts <lat> <lon> <heading> [driveMeters]
//
// Prints the car's tile, how many stop signs it holds, and the signs ahead.
// With driveMeters, it also "drives" straight along the heading in 25 m steps,
// logging tile changes, prefetches and the nearest sign ahead at each step.
//
// Tiles are saved to .cache/tiles/, so once a tile has downloaded, later runs
// work even when the public Overpass servers are busy. Delete the folder to refetch.

import { destination } from '../src/core/location/geo.ts';
import { nextTileToPrefetch, tileBounds, tileKeyFor } from '../src/core/location/tiles.ts';
import { OverpassClient } from '../src/integrations/location/overpassClient.ts';
import { TileCache } from '../src/integrations/location/tileCache.ts';
import { FileTileStore } from './lib/fileTileStore.ts';

const [lat, lon, heading, drive = 0] = process.argv.slice(2).map(Number);
if ([lat, lon, heading].some((n) => !Number.isFinite(n))) {
  console.error('usage: node --experimental-strip-types scripts/try-location.ts <lat> <lon> <heading> [driveMeters]');
  process.exit(1);
}

const cache = new TileCache({
  client: new OverpassClient({ timeoutMs: 20_000 }),
  store: new FileTileStore(),
  maxAgeMs: Infinity,
  onError: (key, err) => console.error(`  ! tile ${key} failed:`, (err as { failures?: string[] }).failures ?? err),
});

let car = { lat, lon, heading };
const key = tileKeyFor(car);
const t0 = Date.now();
await cache.update(car);
const tile = cache.peek(key);

console.log(`Tile ${key}  bounds ${JSON.stringify(tileBounds(key))}`);
console.log(`Loaded ${tile?.signs.length ?? 0} stop signs (source: ${tile?.source ?? 'none'}) in ${Date.now() - t0} ms`);
if (tile) {
  for (const s of tile.signs.slice(0, 5)) console.log(`  sign ${s.id} at ${s.lat.toFixed(6)},${s.lon.toFixed(6)} facing ${s.facingDeg ?? '?'}`);
  if (tile.signs.length > 5) console.log(`  ... and ${tile.signs.length - 5} more`);
}
console.log();

const ahead = cache.signsAhead(car);
console.log(ahead.length ? `Signs ahead (heading ${heading}°):` : `No stop signs within 200 m ahead (heading ${heading}°).`);
for (const { sign, distanceM, bearingDeg } of ahead) {
  console.log(
    `  ${distanceM.toFixed(0).padStart(4)} m at ${bearingDeg.toFixed(0).padStart(3)}°  ` +
      `facing ${sign.facingDeg ?? '?'}  https://www.openstreetmap.org/node/${sign.id}`,
  );
}

if (drive > 0) {
  console.log(`\nDriving ${drive} m at ${heading}°...`);
  let lastTile = key;
  for (let d = 25; d <= drive; d += 25) {
    car = { ...destination({ lat, lon }, heading, d), heading };
    const next = nextTileToPrefetch(car);
    await cache.update(car);
    const here = tileKeyFor(car);
    const nearest = cache.signsAhead(car)[0];
    const notes = [
      here !== lastTile ? `entered tile ${here} (${cache.peek(here) ? 'already loaded' : 'NOT loaded'})` : '',
      next ? `prefetch ${next}` : '',
      nearest ? `stop sign ${nearest.distanceM.toFixed(0)} m ahead` : '',
    ].filter(Boolean);
    console.log(`  ${String(d).padStart(5)} m  ${car.lat.toFixed(5)},${car.lon.toFixed(5)}  ${notes.join(' | ')}`);
    lastTile = here;
  }
}
