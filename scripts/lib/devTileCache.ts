import { OverpassClient } from '../../src/integrations/location/overpassClient';
import { TileCache } from '../../src/integrations/location/tileCache';
import { FileTileStore } from './fileTileStore';

/** Tile cache for dev scripts: disk-backed, never expires, logs failures. */
export function devTileCache(): TileCache {
  return new TileCache({
    client: new OverpassClient({ timeoutMs: 20_000 }),
    store: new FileTileStore(),
    maxAgeMs: Infinity,
    onError: (key, err) => console.error(`  ! tile ${key} failed:`, (err as { failures?: string[] }).failures ?? err),
  });
}
