import { HotspotIndex, type HotspotSnapshot } from '../../core/coaching/hotspots';
import type { DriveEvent } from '../../core/events/types';
import { LocationCoach } from '../../core/location/coach';
import type { TileKey } from '../../core/location/tiles';
import type { TileContents } from '../../core/location/types';
import { TileCache } from '../../integrations/location/tileCache';
import hotspotFixture from '../../../fixtures/hotspots/raleigh-demo.json';
import tileFixture from '../../../fixtures/tiles/demo-route.json';
import type { VoiceCoordinator } from '../voice/VoiceCoordinator';
import { DriveSession } from './DriveSession';
import { DriveEventGate, DriveEventRouter } from './DriveEventGate';

/** Replay never touches the network: the real OpenStreetMap tile is bundled and Overpass is "down". */
const OFFLINE = {
  fetchTile: async (): Promise<TileContents> => {
    throw new Error('replay is offline');
  },
};

export function createReplaySession(
  voice: Pick<VoiceCoordinator, 'handleEvent'>,
  onEvent?: (event: DriveEvent) => void,
): DriveSession {
  const tiles = new TileCache({ client: OFFLINE, bundled: tileFixture as unknown as Record<TileKey, TileContents> });
  const eventSink = new DriveEventRouter({ gate: new DriveEventGate(), voice, onEvent });
  return new DriveSession({
    coach: new LocationCoach(),
    tiles,
    hotspots: new HotspotIndex(hotspotFixture as unknown as HotspotSnapshot),
    eventSink,
  });
}
