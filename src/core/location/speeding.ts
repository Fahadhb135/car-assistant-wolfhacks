import type { DriveEventInput } from '../events/types';
import { matchRoad, type RoadMatchOptions } from './roads';
import { hasHeading } from './tiles';
import type { GpsFix, SpeedLimitWay } from './types';

// Speeding check: match the car to the road it is on (position plus heading, the same matcher as
// highway coaching) and warn when it stays over that road's posted limit.
//
// - Needs a known speed and heading; roads without a maxspeed tag never warn.
// - Over the limit by more than `toleranceMps` for `sustainFixes` fixes in a row (~3 s at 1 Hz),
//   so a brief GPS speed spike or a short overtake doesn't trigger it.
// - After a warning, stays quiet for `cooldownMs` while the car keeps speeding, but warns again
//   after `rewarnAfterMs` once the car has dropped back to the limit and sped up again.

export type SpeedingCoachOptions = {
  /** How far over the limit counts as speeding. Default 5 mph. */
  toleranceMps?: number;
  /** Consecutive speeding fixes before warning. Default 3. */
  sustainFixes?: number;
  /** Quiet period after a warning while the car keeps speeding. Default 60 s. */
  cooldownMs?: number;
  /** Quiet period after a warning once the car has slowed to the limit in between. Default 15 s. */
  rewarnAfterMs?: number;
  roadMatch?: RoadMatchOptions;
};

const MPH = 0.44704;

export class SpeedingCoach {
  private readonly opts: Required<Omit<SpeedingCoachOptions, 'roadMatch'>> & { roadMatch: RoadMatchOptions };
  private overCount = 0;
  private lastWarnAt: number | null = null;
  private backUnderSinceWarn = false;
  private limitMps: number | null = null;
  private road: string | null = null;

  constructor(opts: SpeedingCoachOptions = {}) {
    this.opts = {
      toleranceMps: 5 * MPH,
      sustainFixes: 3,
      cooldownMs: 60_000,
      rewarnAfterMs: 15_000,
      ...opts,
      // Local streets are narrower than highways; 20 m keeps the car off the next street over.
      roadMatch: { maxDistanceM: 20, maxHeadingDeltaDeg: 40, ...opts.roadMatch },
    };
  }

  /** Posted limit of the road the car was last matched to, or null when unknown. For display. */
  get currentLimitMps(): number | null {
    return this.limitMps;
  }

  /** Ref or name of the road the car was last matched to (e.g. "I-40"), or null. For context. */
  get currentRoad(): string | null {
    return this.road;
  }

  /** How far over the limit counts as speeding, for display. */
  get toleranceMps(): number {
    return this.opts.toleranceMps;
  }

  update(fix: GpsFix, ways: readonly SpeedLimitWay[]): DriveEventInput[] {
    if (fix.speed < 0 || !hasHeading(fix.heading)) {
      // Keep showing the last limit: heading drops out whenever the car stops.
      this.overCount = 0;
      return [];
    }
    const limit = matchRoad(fix, ways, this.opts.roadMatch)?.road;
    this.limitMps = limit?.maxspeedMps ?? null;
    this.road = limit ? limit.ref ?? limit.name ?? null : null;
    if (!limit || limit.maxspeedMps === null) {
      this.overCount = 0;
      return [];
    }

    if (fix.speed <= limit.maxspeedMps + this.opts.toleranceMps) {
      this.overCount = 0;
      if (fix.speed <= limit.maxspeedMps) this.backUnderSinceWarn = true;
      return [];
    }

    this.overCount++;
    if (this.overCount < this.opts.sustainFixes) return [];
    if (this.lastWarnAt !== null) {
      const quietMs = this.backUnderSinceWarn ? this.opts.rewarnAfterMs : this.opts.cooldownMs;
      if (fix.t - this.lastWarnAt < quietMs) return [];
    }

    this.lastWarnAt = fix.t;
    this.backUnderSinceWarn = false;
    const road = limit.ref ?? limit.name;
    return [
      {
        t: fix.t,
        kind: 'speeding',
        severity: 'warn',
        speedMps: fix.speed,
        limitMps: limit.maxspeedMps,
        ...(road ? { road } : {}),
      },
    ];
  }
}
