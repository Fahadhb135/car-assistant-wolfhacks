import { createIdGenerator, toDriveEvent, type DriveEvent, type DriveEventInput } from '../../core/events/types';
import type { FeatureAhead } from '../../core/location/featureFilter';
import type { LocationCoach } from '../../core/location/coach';
import type { SpeedingCoach } from '../../core/location/speeding';
import type { Region, RegionPrefetcher } from '../../core/location/regionPrefetch';
import { tilesForFix, type TileKey } from '../../core/location/tiles';
import type { GpsFix, RoadWay, SpeedLimitWay } from '../../core/location/types';
import type { DriveEventSink } from './DriveEventGate';

export type DriveSessionDeps = {
  coach: Pick<LocationCoach, 'update'>;
  tiles: {
    update(fix: GpsFix): Promise<void>;
    featuresAhead(fix: GpsFix): FeatureAhead[];
    roadsNear(fix: GpsFix): RoadWay[];
    /** Drivable roads with speed limits around the car (used with `speeding`). */
    speedLimitsNear?(fix: GpsFix): SpeedLimitWay[];
    /** Background-load a set of tiles (used with `region`). */
    prefetch?(keys: readonly TileKey[]): Promise<void>;
    /** Drop every tile outside `keys` (used with `region`). */
    retain?(keys: readonly TileKey[]): Promise<void>;
  };
  /**
   * Keeps a whole area of map tiles loaded around the car (live drives). When it re-centers, tiles
   * outside the new area are dropped and the new area is prefetched in the background.
   */
  region?: Pick<RegionPrefetcher, 'update'> | null;
  /** Called whenever the prefetched area moves, e.g. for logging. */
  onRegion?: (region: Region) => void;
  /** Speed-limit warnings (live drives). */
  speeding?: Pick<SpeedingCoach, 'update'> | null;
  /** Crowd hotspots, if the cloud list was available. */
  hotspots?: { update(fix: GpsFix): DriveEventInput[] } | null;
  /** The shared per-drive gate and side-effect path used by location and IMU events. */
  eventSink: DriveEventSink;
  nextId?: () => string;
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
    const { tiles, coach, speeding, hotspots, eventSink, onError } = this.deps;
    void tiles.update(fix).catch((err) => onError?.(err));
    this.moveRegion(fix);
    const inputs: DriveEventInput[] = [
      ...(hotspots?.update(fix) ?? []),
      ...coach.update(fix, tiles.featuresAhead(fix), tiles.roadsNear(fix)),
      ...(speeding && tiles.speedLimitsNear ? speeding.update(fix, tiles.speedLimitsNear(fix)) : []),
    ];
    const events = inputs.map((i) => toDriveEvent(i, this.nextId));
    return events.filter((event) => eventSink.route(event));
  }

  private moveRegion(fix: GpsFix): void {
    const { tiles, region, onRegion, onError } = this.deps;
    if (!region || !tiles.prefetch || !tiles.retain) return;
    const next = region.update(fix);
    if (!next) return;
    onRegion?.(next);
    // The tiles under the car always stay, even if they sit on the region's edge.
    const keep = [...new Set([...next.keys, ...tilesForFix(fix)])];
    void tiles
      .retain(keep)
      .then(() => tiles.prefetch!(next.keys))
      .catch((err) => onError?.(err));
  }

  /** Load the map around the starting point before the drive begins (used by replay). */
  async prime(fix: GpsFix): Promise<void> {
    await this.deps.tiles.update(fix);
  }
}
