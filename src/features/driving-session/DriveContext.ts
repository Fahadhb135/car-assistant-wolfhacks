import type { DriveEvent } from '../../core/events/types';
import { distanceM } from '../../core/location/geo';
import type { GpsFix } from '../../core/location/types';
import type { CloudTrip, EventStamp } from '../../integrations/backend/tripUpload';

export type LivePosition = Readonly<{
  fix: GpsFix;
  limitMps: number | null;
  road: string | null;
}>;

/** Hops shorter than this are GPS jitter while parked or creeping; longer ones are a lost signal, not driving. */
const MIN_HOP_M = 5;
const MAX_HOP_M = 1_000;

/**
 * What one drive knows about where the car is, shared by the trip upload and live coaching:
 * the latest GPS fix (with the matched road and its limit), where the car was when each event
 * happened, and what the coach said. Pure, one per drive.
 */
export class DriveContext {
  private position: LivePosition | null = null;
  private readonly stamps = new Map<string, EventStamp>();
  private readonly said: CloudTrip['transcript'][number][] = [];
  private travelledM = 0;

  updateFix(fix: GpsFix, limitMps: number | null = null, road: string | null = null): void {
    if (this.position) {
      const hop = distanceM(this.position.fix, fix);
      if (hop >= MIN_HOP_M && hop <= MAX_HOP_M) this.travelledM += hop;
    }
    this.position = { fix, limitMps, road };
  }

  /** How far the car has driven so far, summed from GPS fixes (metres). */
  distanceM(): number {
    return this.travelledM;
  }

  latest(): LivePosition | null {
    return this.position;
  }

  /** Remember where the car was when this event happened (no-op before the first fix). */
  stamp(event: DriveEvent): void {
    const p = this.position;
    if (!p || this.stamps.has(event.eventId)) return;
    this.stamps.set(event.eventId, {
      lat: p.fix.lat,
      lon: p.fix.lon,
      ...(p.fix.speed >= 0 ? { speedMps: p.fix.speed } : {}),
      ...(p.limitMps !== null ? { limitMps: p.limitMps } : {}),
      ...(p.road ? { road: p.road } : {}),
    });
  }

  stampFor = (eventId: string): EventStamp | undefined => this.stamps.get(eventId);

  addSaid(t: number, role: 'driver' | 'assistant', text: string): void {
    this.said.push({ t, role, text });
  }

  transcript(): CloudTrip['transcript'] {
    return [...this.said];
  }
}
