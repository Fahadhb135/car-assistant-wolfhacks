import { createIdGenerator, toDriveEvent, type DriveEvent, type DriveEventInput } from '../../core/events/types';
import type { FeatureAhead } from '../../core/location/featureFilter';
import type { LocationCoach } from '../../core/location/coach';
import type { GpsFix, RoadWay } from '../../core/location/types';
import type { VoiceCoordinator } from '../voice/VoiceCoordinator';

export type DriveSessionDeps = {
  coach: Pick<LocationCoach, 'update'>;
  tiles: {
    update(fix: GpsFix): Promise<void>;
    featuresAhead(fix: GpsFix): FeatureAhead[];
    roadsNear(fix: GpsFix): RoadWay[];
  };
  /** Crowd hotspots, if the cloud list was available. */
  hotspots?: { update(fix: GpsFix): DriveEventInput[] } | null;
  voice: Pick<VoiceCoordinator, 'handleEvent'>;
  nextId?: () => string;
  /** Every event, in order, for the UI feed and the trip record. */
  onEvent?: (event: DriveEvent) => void;
  /** Map-tile loading failures (the drive carries on with whatever is already loaded). */
  onError?: (err: unknown) => void;
};

/**
 * One drive, live or replayed: GPS fix in, coaching events out and spoken. Replay swaps only the
 * fix source, so everything downstream is identical (README section 9).
 */
export class DriveSession {
  private readonly nextId: () => string;

  constructor(private deps: DriveSessionDeps) {
    this.nextId = deps.nextId ?? createIdGenerator('ev-');
  }

  /**
   * Synchronous on purpose: the live path never waits on the network (README section 7). Tile
   * loading is started here and used from the next fix on, so events are never late (late alerts
   * would be dropped as stale) and fixes are always processed in order.
   */
  onFix(fix: GpsFix): DriveEvent[] {
    const { tiles, coach, hotspots, voice, onEvent, onError } = this.deps;
    void tiles.update(fix).catch((err) => onError?.(err));
    const inputs: DriveEventInput[] = [
      ...(hotspots?.update(fix) ?? []),
      ...coach.update(fix, tiles.featuresAhead(fix), tiles.roadsNear(fix)),
    ];
    const events = inputs.map((i) => toDriveEvent(i, this.nextId));
    for (const e of events) {
      onEvent?.(e);
      voice.handleEvent(e);
    }
    return events;
  }

  /** Load the map around the starting point before the drive begins (used by replay). */
  async prime(fix: GpsFix): Promise<void> {
    await this.deps.tiles.update(fix);
  }
}
