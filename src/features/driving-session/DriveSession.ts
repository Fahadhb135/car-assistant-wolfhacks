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

  async onFix(fix: GpsFix): Promise<DriveEvent[]> {
    const { tiles, coach, hotspots, voice, onEvent } = this.deps;
    await tiles.update(fix);
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
}
