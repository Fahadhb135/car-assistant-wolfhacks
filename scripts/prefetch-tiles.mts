// Pre-downloads map tiles around a point so the app works when Overpass is busy or offline.
//
//   npx tsx scripts/prefetch-tiles.mts <lat> <lon> [radiusMiles=2] [--out fixtures/tiles/prefetched.json] [--refresh]
//
// Fetches every ~1-mile tile that comes within radiusMiles of the point (stop signs, traffic
// lights, highways, ramps and every drivable road's speed limit: the same query the app runs) and saves each one to .cache/tiles/
// for the dev scripts. It also writes all of them to --out, which the app pre-loads at the start
// of a live drive (createLiveLocationSession), so those tiles are available with no network.
//
// Tiles already in .cache/tiles/ are reused unless --refresh is given. Public Overpass mirrors
// are often overloaded, so each tile is retried across every mirror a few times.

import { writeFile } from 'node:fs/promises';

import { tileBounds, tilesWithinRadius, type TileKey } from '../src/core/location/tiles';
import { DEFAULT_ENDPOINTS, OverpassClient } from '../src/integrations/location/overpassClient';
import { TILE_SCHEMA, type TileData } from '../src/integrations/location/tileCache';
import { FileTileStore } from './lib/fileTileStore';

const MILE_M = 1609.344;
const ROUNDS = 3;
const ROUND_PAUSE_MS = 10_000;
// VK's public mirror often answers when the others time out.
const ENDPOINTS = [...DEFAULT_ENDPOINTS, 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const refresh = args.includes('--refresh');
const out = flag('--out') ?? 'fixtures/tiles/prefetched.json';
const [lat, lon, radiusMiles = 2] = args.filter((a) => !a.startsWith('--')).map(Number);
if (![lat, lon, radiusMiles].every(Number.isFinite)) {
  console.error('usage: npx tsx scripts/prefetch-tiles.mts <lat> <lon> [radiusMiles=2] [--out file] [--refresh]');
  process.exit(1);
}

const center = { lat: lat!, lon: lon! };
const radiusM = radiusMiles! * MILE_M;

const store = new FileTileStore();
const client = new OverpassClient({ endpoints: ENDPOINTS, timeoutMs: 60_000 });
const keys = tilesWithinRadius(center, radiusM);
const tiles: Record<TileKey, TileData> = {};
let pending = [...keys];

console.log(`${keys.length} tiles within ${radiusMiles} mi of ${lat},${lon}`);
for (const key of pending.slice()) {
  const cached = refresh ? null : await store.get(key);
  if (cached?.schema === TILE_SCHEMA && cached.source === 'network') {
    tiles[key] = cached;
    pending = pending.filter((k) => k !== key);
  }
}
if (keys.length - pending.length) console.log(`  ${keys.length - pending.length} already cached`);

for (let round = 1; round <= ROUNDS && pending.length; round++) {
  if (round > 1) {
    console.log(`  retrying ${pending.length} tiles in ${ROUND_PAUSE_MS / 1000} s`);
    await new Promise((resolve) => setTimeout(resolve, ROUND_PAUSE_MS));
  }
  for (const key of pending.slice()) {
    try {
      const contents = await client.fetchTile(tileBounds(key));
      const data: TileData = { key, schema: TILE_SCHEMA, fetchedAt: Date.now(), source: 'network', ...contents };
      await store.set(data);
      tiles[key] = data;
      pending = pending.filter((k) => k !== key);
      const stops = contents.features.filter((f) => f.kind === 'stop').length;
      const limits = contents.speedLimits ?? [];
      const tagged = limits.filter((w) => w.maxspeedMps !== null).length;
      console.log(
        `  ${key}: ${stops} stop signs, ${contents.features.length - stops} traffic lights, ` +
          `${contents.roads.length} highway/ramp ways, ${limits.length} roads (${tagged} with a speed limit)`,
      );
    } catch (err) {
      console.log(`  ${key}: failed (${(err as { failures?: string[] }).failures?.join('; ') ?? String(err)})`);
    }
  }
}

await writeFile(out, JSON.stringify(tiles));
const all = Object.values(tiles);
const stops = all.reduce((n, t) => n + t.features.filter((f) => f.kind === 'stop').length, 0);
const lights = all.reduce((n, t) => n + t.features.filter((f) => f.kind === 'traffic_signals').length, 0);
const roads = all.reduce((n, t) => n + t.roads.length, 0);
const limits = all.reduce((n, t) => n + (t.speedLimits?.length ?? 0), 0);
console.log(
  `wrote ${all.length}/${keys.length} tiles to ${out}: ${stops} stop signs, ${lights} traffic lights, ` +
    `${roads} highway/ramp ways, ${limits} roads with speed-limit data`,
);
if (pending.length) {
  console.log(`missing: ${pending.join(', ')} (rerun to fill in; cached tiles are kept)`);
  process.exitCode = 1;
}
