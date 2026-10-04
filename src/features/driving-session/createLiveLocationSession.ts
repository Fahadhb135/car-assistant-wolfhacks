import { LocationCoach } from '../../core/location/coach';
import { RegionPrefetcher } from '../../core/location/regionPrefetch';
import { SpeedingCoach } from '../../core/location/speeding';
import type { TileKey } from '../../core/location/tiles';
import type { TileContents } from '../../core/location/types';
import { OverpassClient } from '../../integrations/location/overpassClient';
import { MemoryTileStore, TILE_SCHEMA, TileCache, type TileData } from '../../integrations/location/tileCache';
import prefetchedTiles from '../../../fixtures/tiles/prefetched.json';
import tileFixture from '../../../fixtures/tiles/demo-route.json';
import { DriveSession } from './DriveSession';
import type { DriveEventSink } from './DriveEventGate';

/**
 * Tiles saved by `scripts/prefetch-tiles.mts`. They go into the store as downloaded tiles, so the
 * cache uses them straight away with no network (and refetches them once they are a week old,
 * keeping the saved copy if that fails).
 */
function prefetchedStore(): MemoryTileStore {
  const store = new MemoryTileStore();
  for (const tile of Object.values(prefetchedTiles as unknown as Record<TileKey, TileData>)) {
    if (tile.schema === TILE_SCHEMA) void store.set(tile);
  }
  return store;
}

/**
 * A live drive's location coaching: real GPS fixes in, map tiles from the public Overpass API.
 * Same DriveSession as replay, plus speed-limit warnings and a 2-mile map area kept loaded around
 * the car (refetched, and tiles outside it dropped, once the car is within half a mile of its
 * edge). Prefetched tiles are used first, and the bundled demo-route tile is the fallback when
 * Overpass is unreachable. Newly downloaded tiles are kept in memory for the app session.
 */
export function createLiveLocationSession(
  eventSink: DriveEventSink,
  onError: (err: unknown) => void,
): { session: DriveSession; speeding: SpeedingCoach } {
  const speeding = new SpeedingCoach();
  const tiles = new TileCache({
    client: new OverpassClient(),
    store: prefetchedStore(),
    bundled: tileFixture as unknown as Record<TileKey, TileContents>,
    onError: (_key, err) => onError(err),
  });
  const session = new DriveSession({
    coach: new LocationCoach(),
    speeding,
    tiles,
    region: new RegionPrefetcher(),
    onRegion: (region) =>
      console.info(
        `[live location] map area: ${region.keys.length} tiles around ${region.center.lat.toFixed(5)},${region.center.lon.toFixed(5)}`,
      ),
    hotspots: null,
    eventSink,
    onError,
  });
  return { session, speeding };
}
