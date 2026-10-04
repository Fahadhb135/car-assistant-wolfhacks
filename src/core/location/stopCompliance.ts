import type { StopComplianceEvent } from './events';
import { distanceM, type LatLon } from './geo';
import type { GpsFix } from './types';

// Did the driver actually stop at the sign? Starts following a stop sign when the coach announces
// it, records the slowest GPS speed while the car is within `zoneM` of the sign, and judges once the
// car has clearly moved past it:
//   slowest <= stoppedMps  -> stop_ok       (about 1.3 mph: GPS noise of a stopped car)
//   slowest <= rollingMps  -> rolling_stop  (about 7 mph)
//   otherwise              -> ran_stop
// A sign the car never reaches (turned off before it) is dropped silently. Fixes without a speed
// are ignored; a sign passed with no speed reading at all is not judged.

export type StopComplianceOptions = {
  /** Distance from the sign that counts as "at the stop line". Default 25 m (1 Hz GPS at speed). */
  zoneM?: number;
  /** How far past the closest approach before judging. Default 12 m. */
  passMarginM?: number;
  stoppedMps?: number;
  rollingMps?: number;
  /** Give up on a sign after this long (parked, detour). Default 3 min. */
  maxFollowMs?: number;
};

type Followed = { sign: LatLon; featureId: number; since: number; closestM: number; slowestMps: number | null };

export class StopComplianceTracker {
  private readonly opts: Required<StopComplianceOptions>;
  private readonly followed = new Map<number, Followed>();

  constructor(opts: StopComplianceOptions = {}) {
    this.opts = {
      zoneM: 25,
      passMarginM: 12,
      stoppedMps: 0.6,
      rollingMps: 3.1,
      maxFollowMs: 180_000,
      ...opts,
    };
  }

  /** Begin following an announced stop sign. */
  follow(featureId: number, sign: LatLon, t: number): void {
    if (!this.followed.has(featureId)) {
      this.followed.set(featureId, { sign, featureId, since: t, closestM: Infinity, slowestMps: null });
    }
  }

  update(fix: GpsFix): StopComplianceEvent[] {
    const events: StopComplianceEvent[] = [];
    for (const [id, f] of this.followed) {
      if (fix.t - f.since > this.opts.maxFollowMs) {
        this.followed.delete(id);
        continue;
      }
      const d = distanceM(fix, f.sign);
      if (d <= this.opts.zoneM && fix.speed >= 0) {
        f.slowestMps = f.slowestMps === null ? fix.speed : Math.min(f.slowestMps, fix.speed);
      }
      f.closestM = Math.min(f.closestM, d);
      const reached = f.closestM <= this.opts.zoneM;
      const passed = reached && d > this.opts.zoneM && d > f.closestM + this.opts.passMarginM;
      if (!passed) continue;
      this.followed.delete(id);
      if (f.slowestMps === null) continue;
      const kind = f.slowestMps <= this.opts.stoppedMps ? 'stop_ok'
        : f.slowestMps <= this.opts.rollingMps ? 'rolling_stop'
          : 'ran_stop';
      events.push({
        kind,
        severity: kind === 'stop_ok' ? 'info' : 'warn',
        t: fix.t,
        featureId: f.featureId,
        minSpeedMps: Math.round(f.slowestMps * 10) / 10,
      });
    }
    return events;
  }
}
