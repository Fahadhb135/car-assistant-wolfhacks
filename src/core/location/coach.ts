import type { HighwayEvent, LocationEvent } from './events';
import type { FeatureAhead } from './featureFilter';
import { distanceM as dist } from './geo';
import { matchRoad, nearestRoad, type RoadMatchOptions } from './roads';
import type { GpsFix, RoadWay } from './types';

// Turns GPS fixes plus nearby map data into coaching events:
//   stop_sign_ahead / traffic_light_ahead   once per intersection, at ~150 m
//   highway_entering                        local road -> on-ramp: speed up to merge
//   highway_exiting                         highway -> off-ramp: slow down for the ramp
//
// Road class changes must hold for a few consecutive fixes before they count,
// so GPS jitter near a ramp's gore point doesn't flip-flop. Stop compliance
// (rolling_stop / ran_stop) is a separate state machine, not built yet.

export type RoadClass = 'local' | 'ramp' | 'highway';

export type LocationCoachOptions = {
  /** Announce stop signs and traffic lights at this distance. Default 150 m. */
  announceDistanceM?: number;
  /**
   * Features of the same kind this close to an announced one are treated as the
   * same intersection (e.g. an all-way stop mapped as one node per approach)
   * and not announced again. Default 40 m.
   */
  clusterRadiusM?: number;
  /** Forget an announced feature after it has been out of view this long. Default 30 s. */
  forgetAfterMs?: number;
  /** Consecutive fixes needed to accept a road-class change. Default 3 (~3 s at 1 Hz). */
  confirmFixes?: number;
  /** Highway limit to use when OSM has no maxspeed. Default 55 mph. */
  defaultHighwaySpeedMps?: number;
  /** Ramp limit to use when OSM has no maxspeed. Default 35 mph. */
  defaultRampSpeedMps?: number;
  /** How far off the target speed counts as "change speed". Default 10 mph. */
  speedToleranceMps?: number;
  roadMatch?: RoadMatchOptions;
};

const MPH = 0.44704;

export class LocationCoach {
  private readonly opts: Required<Omit<LocationCoachOptions, 'roadMatch'>> & { roadMatch?: RoadMatchOptions };
  private readonly lastSeen = new Map<number, number>();
  private confirmed: RoadClass = 'local';
  private candidate: RoadClass = 'local';
  private candidateCount = 0;

  constructor(opts: LocationCoachOptions = {}) {
    this.opts = {
      announceDistanceM: 150,
      clusterRadiusM: 40,
      forgetAfterMs: 30_000,
      confirmFixes: 3,
      defaultHighwaySpeedMps: 55 * MPH,
      defaultRampSpeedMps: 35 * MPH,
      speedToleranceMps: 10 * MPH,
      ...opts,
    };
  }

  /** The road class the coach currently believes the car is on. */
  get roadClass(): RoadClass {
    return this.confirmed;
  }

  /**
   * Feed one GPS fix with the features ahead of the car and the highway/ramp
   * ways around it (both from the tile cache). Returns any new events.
   */
  update(fix: GpsFix, ahead: readonly FeatureAhead[], roads: readonly RoadWay[]): LocationEvent[] {
    return [...this.announceFeatures(fix, ahead), ...this.trackHighway(fix, roads)];
  }

  private announceFeatures(fix: GpsFix, ahead: readonly FeatureAhead[]): LocationEvent[] {
    // Forget features out of view for a while first, so one coming back is announced again.
    for (const [id, t] of this.lastSeen) {
      if (fix.t - t > this.opts.forgetAfterMs) this.lastSeen.delete(id);
    }
    const events: LocationEvent[] = [];
    for (const { feature, distanceM } of ahead) {
      const known = this.lastSeen.has(feature.id);
      if (known) this.lastSeen.set(feature.id, fix.t);
      if (known || distanceM > this.opts.announceDistanceM) continue;
      this.lastSeen.set(feature.id, fix.t);
      // Same intersection as one already announced: remember it, stay quiet.
      // `ahead` is nearest first, so the nearest feature is the one announced.
      const sameIntersection = ahead.some(
        (o) =>
          o.feature.id !== feature.id &&
          o.feature.kind === feature.kind &&
          this.lastSeen.has(o.feature.id) &&
          dist(o.feature, feature) <= this.opts.clusterRadiusM,
      );
      if (sameIntersection) continue;
      events.push({
        kind: feature.kind === 'stop' ? 'stop_sign_ahead' : 'traffic_light_ahead',
        severity: 'info',
        t: fix.t,
        distanceM,
        featureId: feature.id,
      });
    }
    return events;
  }

  private trackHighway(fix: GpsFix, roads: readonly RoadWay[]): HighwayEvent[] {
    const match = matchRoad(fix, roads, this.opts.roadMatch);
    const seen: RoadClass = !match ? 'local' : match.road.kind === 'motorway' ? 'highway' : 'ramp';

    if (seen === this.confirmed) {
      this.candidateCount = 0;
      return [];
    }
    if (seen !== this.candidate) {
      this.candidate = seen;
      this.candidateCount = 0;
    }
    if (++this.candidateCount < this.opts.confirmFixes) return [];

    const from = this.confirmed;
    this.confirmed = seen;
    this.candidateCount = 0;
    const speed = Math.max(fix.speed, 0);

    if (from === 'local' && seen === 'ramp') {
      // Merge speed comes from the highway the ramp feeds into, which is nearby.
      const highway = nearestRoad(fix, roads, 'motorway', 1000)?.road;
      const target = highway?.maxspeedMps ?? null;
      const targetSpeedMps = target ?? this.opts.defaultHighwaySpeedMps;
      const slow = speed < targetSpeedMps - this.opts.speedToleranceMps;
      return [
        {
          kind: 'highway_entering',
          severity: slow ? 'warn' : 'info',
          t: fix.t,
          speedMps: speed,
          targetSpeedMps,
          targetIsDefault: target === null,
          advice: slow ? 'speed_up' : 'ok',
          ...roadLabel(highway),
        },
      ];
    }

    if (from === 'highway' && seen === 'ramp') {
      const ramp = match!.road;
      const targetSpeedMps = ramp.maxspeedMps ?? this.opts.defaultRampSpeedMps;
      const fast = speed > targetSpeedMps + this.opts.speedToleranceMps;
      return [
        {
          kind: 'highway_exiting',
          severity: fast ? 'warn' : 'info',
          t: fix.t,
          speedMps: speed,
          targetSpeedMps,
          targetIsDefault: ramp.maxspeedMps === null,
          advice: fast ? 'slow_down' : 'ok',
          ...roadLabel(ramp),
        },
      ];
    }
    return [];
  }
}

function roadLabel(road: RoadWay | undefined): { road?: string } {
  const label = road?.ref ?? road?.name;
  return label ? { road: label } : {};
}
