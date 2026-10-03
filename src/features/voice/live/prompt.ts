import type { DriveEvent } from '../../../core/events/types';

export type TripContext = {
  speedKmh?: number;
  smoothness?: number;
  elapsedMin?: number;
};

const RULES = `You are a calm, friendly driving coach riding along with a new driver. Keep every reply to one or two short sentences, because the driver is on the road.
Hard rules:
- You explain and chat. You never decide anything about safety. The app's own alerts handle crashes, stop signs and erratic driving, and you must not confirm, dismiss, or contradict them.
- Never claim anyone is impaired or intoxicated.
- If asked about an emergency, tell them to pull over safely and call emergency services.
- Only describe what the trip data below shows. If you don't know, say so.`;

export function describeEvent(e: DriveEvent): string {
  switch (e.kind) {
    case 'crash':
      return e.confirmed ? 'A crash was confirmed.' : 'A possible crash was detected.';
    case 'erratic_driving':
      return `Erratic driving was flagged (score ${e.score.toFixed(2)}).`;
    case 'stop_sign_ahead':
      return `A stop sign was ahead (${Math.round(e.distanceM)} m).`;
    case 'stop_ok':
      return 'The driver stopped correctly at a stop sign.';
    case 'rolling_stop':
      return 'The driver rolled through a stop sign.';
    case 'ran_stop':
      return 'The driver ran a stop sign.';
  }
}

export function buildSystemInstruction(ctx: TripContext, recent: DriveEvent[], max = 8): string {
  const lines: string[] = [];
  if (ctx.elapsedMin !== undefined) lines.push(`Trip time: ${Math.round(ctx.elapsedMin)} min.`);
  if (ctx.smoothness !== undefined) lines.push(`Smoothness score: ${Math.round(ctx.smoothness)}/100.`);
  if (ctx.speedKmh !== undefined) lines.push(`Current speed: ${Math.round(ctx.speedKmh)} km/h.`);
  const events = recent.slice(-max).map((e) => `- ${describeEvent(e)}`);
  lines.push(events.length ? `Recent events:\n${events.join('\n')}` : 'No events so far this trip.');
  return `${RULES}\n\nTrip data:\n${lines.join('\n')}`;
}

/** Text turn injected into the live conversation when an event fires. */
export function contextTurn(e: DriveEvent): string {
  return `[Trip update] ${describeEvent(e)} Do not respond unless the driver asks about it.`;
}
