import type { DriveEventInput, HotspotKind } from '../events/types';
import { bearingDeg, bearingDelta, distanceM } from '../location/geo';
import type { GpsFix } from '../location/types';

// Crowd hotspots (README 'Databricks' loop): places where several other drivers rolled or ran a
// stop, or drove erratically. The cloud serves a small list per area; the phone fetches it once
// at trip start, so this needs no live network and no tile prefetch.

export type Hotspot = {
  cell: string;
  lat: number;
  lon: number;
  bad: number;
  trips: number;
  drivers: number;
  byKind: Record<string, number>;
  topKind: HotspotKind;
  /** A seeded demo driver contributed to this place. */
  demo?: boolean;
};

export type HotspotSnapshot = {
  source: string;
  generatedAt: number;
  demo: boolean;
  hotspots: Hotspot[];
};

export type HotspotIndexOptions = {
  /**
   * Warn at this distance. 250 m (about 9 s at 60 mph) lets the spoken warning finish before
   * the stop-sign alert at ~150 m, which outranks it.
   */
  announceDistanceM?: number;
  /** Too close to be useful: the car is already at the spot. */
  minDistanceM?: number;
  coneHalfAngleDeg?: number;
  /** Hotspots this close to an announced one are the same intersection (neighbouring grid cells). */
  clusterRadiusM?: number;
  /** Re-arm a hotspot after the car has been away from it this long. */
  forgetAfterMs?: number;
};

type CellState = { lastAheadT: number; announced: boolean };

export class HotspotIndex {
  private readonly opts: Required<HotspotIndexOptions>;
  private readonly state = new Map<string, CellState>();

  constructor(
    private readonly snapshot: HotspotSnapshot,
    opts: HotspotIndexOptions = {},
  ) {
    this.opts = {
      announceDistanceM: 250,
      minDistanceM: 30,
      coneHalfAngleDeg: 35,
      clusterRadiusM: 60,
      forgetAfterMs: 90_000,
      ...opts,
    };
  }

  get size(): number {
    return this.snapshot.hotspots.length;
  }

  /**
   * Feed one GPS fix. Returns at most one new warning per fix (the nearest hotspot ahead that
   * has not been handled yet); any others in view are picked up on the following fixes.
   */
  update(fix: GpsFix): DriveEventInput[] {
    for (const [cell, st] of this.state) {
      if (fix.t - st.lastAheadT > this.opts.forgetAfterMs) this.state.delete(cell);
    }
    // A heading of -1 means unknown, and without it we can't tell ahead from behind.
    if (!(Number.isFinite(fix.heading) && fix.heading >= 0)) return [];

    const ahead = this.snapshot.hotspots
      .map((h) => ({ h, d: distanceM(fix, h) }))
      .filter(
        ({ h, d }) =>
          d <= this.opts.announceDistanceM &&
          bearingDelta(fix.heading, bearingDeg(fix, h)) <= this.opts.coneHalfAngleDeg,
      )
      .sort((a, b) => a.d - b.d);

    const events: DriveEventInput[] = [];
    for (const { h, d } of ahead) {
      const seen = this.state.get(h.cell);
      if (seen) {
        seen.lastAheadT = fix.t;
        continue;
      }
      if (d < this.opts.minDistanceM || events.length > 0) continue;
      // Neighbouring grid cells of one intersection: say it once.
      const duplicate = this.snapshot.hotspots.some(
        (o) =>
          o.cell !== h.cell &&
          this.state.get(o.cell)?.announced === true &&
          distanceM(o, h) <= this.opts.clusterRadiusM,
      );
      this.state.set(h.cell, { lastAheadT: fix.t, announced: !duplicate });
      if (duplicate) continue;
      events.push({
        kind: 'hotspot_ahead',
        severity: 'info',
        t: fix.t,
        distanceM: Math.round(d),
        cell: h.cell,
        topKind: h.topKind,
        drivers: h.drivers,
        demo: this.snapshot.demo || h.demo === true,
      });
    }
    return events;
  }
}
