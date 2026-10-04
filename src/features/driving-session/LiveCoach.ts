import type { DriveEvent, DriveEventKind } from '../../core/events/types';
import type { CoachRequestBody } from '../../integrations/backend/coachClient';
import { describeEvent } from '../voice/chat/describeEvent';
import { alertFromEvent } from '../voice/phrases';
import type { DriveContext } from './DriveContext';

/**
 * Moments worth a personal remark. Approach warnings (stop sign / light ahead) are left to the
 * instant clips, and a possible crash is never coaching material.
 */
export const COACHABLE: ReadonlySet<DriveEventKind> = new Set<DriveEventKind>([
  'stop_ok', 'rolling_stop', 'ran_stop',
  'hard_braking', 'rapid_acceleration', 'harsh_cornering', 'erratic_driving',
  'highway_entering', 'highway_exiting', 'speeding', 'hotspot_ahead',
]);

export type LiveCoachDeps = {
  driverId: string;
  context: DriveContext;
  /** On-the-spot Gemini call through the cloud; null when it has nothing (or failed). */
  request(body: CoachRequestBody): Promise<string | null>;
  speak(id: string, text: string): void;
  recentEvents(): readonly DriveEvent[];
  smoothness(): number;
  startedAt: number;
  now?: () => number;
  /** At most one remark per this many ms, so coaching never nags. */
  minIntervalMs?: number;
};

const KMH = 3.6;

/**
 * Live coaching: after a notable moment, sends Gemini the moment plus everything the phone knows
 * (GPS, speed, limit, road, this trip's events and score; the cloud adds the driver's Databricks
 * history and the crowd data for that spot) and speaks the one-sentence reply. Throttled, one
 * request at a time, never blocks or delays the instant safety clips.
 */
export class LiveCoach {
  private inFlight = false;
  private lastAskedAt = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  private n = 0;

  constructor(private deps: LiveCoachDeps) {
    this.now = deps.now ?? Date.now;
  }

  onEvent(event: DriveEvent): void {
    if (!COACHABLE.has(event.kind)) return;
    // Silent clips (a ramp taken at a good speed) still count as a moment worth praising.
    const now = this.now();
    if (this.inFlight || now - this.lastAskedAt < (this.deps.minIntervalMs ?? 45_000)) return;
    this.lastAskedAt = now;
    this.inFlight = true;
    void this.ask(event, now).finally(() => {
      this.inFlight = false;
    });
  }

  private async ask(event: DriveEvent, now: number): Promise<void> {
    const { context, driverId } = this.deps;
    const p = context.latest();
    const body: CoachRequestBody = {
      driverId,
      trigger: describeEvent(event),
      ...(alertFromEvent(event) ? { spokenAlert: alertFromEvent(event)!.utterance.text } : {}),
      ...(p ? { lat: p.fix.lat, lon: p.fix.lon } : {}),
      ...(p && p.fix.speed >= 0 ? { speedKmh: p.fix.speed * KMH } : {}),
      ...(p?.limitMps != null ? { limitKmh: p.limitMps * KMH } : {}),
      ...(p?.road ? { road: p.road } : {}),
      recentEvents: this.deps.recentEvents().filter((e) => e.eventId !== event.eventId).slice(-6).map(describeEvent),
      elapsedMin: (now - this.deps.startedAt) / 60_000,
      smoothness: this.deps.smoothness(),
    };
    const text = await this.deps.request(body);
    if (!text) return;
    context.addSaid(this.now(), 'assistant', text);
    this.deps.speak(`coach-${++this.n}`, text);
  }
}
