import type { DriveEvent } from '../../core/events/types';
import { LocationCoach } from '../../core/location/coach';
import type { TileKey } from '../../core/location/tiles';
import type { TileContents } from '../../core/location/types';
import { OverpassClient } from '../../integrations/location/overpassClient';
import { MemoryTileStore, TileCache } from '../../integrations/location/tileCache';
import tileFixture from '../../../fixtures/tiles/demo-route.json';
import type { VoiceCoordinator } from '../voice/VoiceCoordinator';
import { DriveSession } from './DriveSession';

/**
 * A live drive's location coaching: real GPS fixes in, map tiles from the public Overpass API.
 * Same DriveSession as replay; only the tile source differs. The bundled demo-route tile is the
 * fallback when Overpass is unreachable. Tiles are kept in memory for the app session.
 */
export function createLiveLocationSession(
  voice: Pick<VoiceCoordinator, 'handleEvent'>,
  onEvent: (event: DriveEvent) => void,
  onError: (err: unknown) => void,
): DriveSession {
  const tiles = new TileCache({
    client: new OverpassClient(),
    store: new MemoryTileStore(),
    bundled: tileFixture as unknown as Record<TileKey, TileContents>,
    onError: (_key, err) => onError(err),
  });
  return new DriveSession({ coach: new LocationCoach(), tiles, hotspots: null, voice, onEvent, onError });
}
