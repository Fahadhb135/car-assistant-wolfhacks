import type { DriveEvent } from '../../../core/events/types';
import { describeEvent, type TripContext } from '../live/prompt';
import type { VoiceCoordinator } from '../VoiceCoordinator';

export type CoachChatDeps = {
  baseUrl: string;
  voice: Pick<VoiceCoordinator, 'speakReply'>;
  getContext?: () => TripContext;
  getRecentEvents?: () => DriveEvent[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Push-to-talk chat: the app turns speech into text (device speech recognition),
 * calls this, and the reply is spoken through the normal voice queue.
 * Network or server failure speaks a short apology instead of staying silent.
 */
export class CoachChat {
  private n = 0;
  constructor(private deps: CoachChatDeps) {}

  async ask(message: string): Promise<string> {
    const { baseUrl, voice, timeoutMs = 8000 } = this.deps;
    const doFetch = this.deps.fetchImpl ?? fetch;
    const ctx = this.deps.getContext?.() ?? {};
    const body = {
      message,
      recentEvents: (this.deps.getRecentEvents?.() ?? []).slice(-8).map(describeEvent),
      smoothness: ctx.smoothness,
      speedKmh: ctx.speedKmh,
      elapsedMin: ctx.elapsedMin,
    };
    let reply = "Sorry, I can't answer that right now.";
    try {
      const res = await doFetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) reply = ((await res.json()) as { reply: string }).reply || reply;
    } catch {
      // keep the fallback reply
    }
    voice.speakReply(`chat-${++this.n}`, reply);
    return reply;
  }
}
