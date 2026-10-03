import type { DriveEvent } from '../../../core/events/types';
import { describeEvent, type TripContext } from '../live/prompt';
import { streamReply } from '../../../integrations/backend/replyStream';
import { REPLY_FALLBACK_TEXT } from '../phrases';
import type { Segment } from '../types';
import type { VoiceCoordinator } from '../VoiceCoordinator';

export type CoachChatDeps = {
  baseUrl: string;
  voice: Pick<VoiceCoordinator, 'speakReply' | 'speakReplyStream'>;
  getContext?: () => TripContext;
  getRecentEvents?: () => DriveEvent[];
  fetchImpl?: typeof fetch;
  /** Streaming fetch for /chat/stream: `fetch` from 'expo/fetch' in the app (the global one cannot stream). */
  streamFetchImpl?: typeof fetch;
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

  /**
   * Streamed reply: the first sentence is spoken as soon as it arrives while the rest is still
   * being written. If nothing arrives in time the phone says the apology line instead.
   */
  async askStream(message: string): Promise<void> {
    const { baseUrl, voice } = this.deps;
    const ctx = this.deps.getContext?.() ?? {};
    const body = {
      message,
      recentEvents: (this.deps.getRecentEvents?.() ?? []).slice(-8).map(describeEvent),
      smoothness: ctx.smoothness,
      speedKmh: ctx.speedKmh,
      elapsedMin: ctx.elapsedMin,
    };
    const ctrl = new AbortController();
    const id = `chat-${++this.n}`;
    const packets = streamReply({
      baseUrl,
      body,
      fetchImpl: this.deps.streamFetchImpl ?? this.deps.fetchImpl,
      signal: ctrl.signal,
    });

    let first: IteratorResult<Awaited<ReturnType<typeof packets.next>>['value']> | null = null;
    try {
      // Wait for the first sentence only; the rest keeps streaming while it is being spoken.
      do {
        first = await packets.next();
      } while (!first.done && first.value.type !== 'sentence');
    } catch {
      first = null;
    }
    if (!first || first.done || first.value.type !== 'sentence') {
      ctrl.abort();
      voice.speakReply(id, REPLY_FALLBACK_TEXT);
      return;
    }

    const head = first.value;
    async function* segments(): AsyncGenerator<Segment> {
      yield { text: head.text, audio: head.audio ? { data: head.audio, mime: head.mime } : null };
      for await (const p of packets) {
        if (p.type === 'sentence') yield { text: p.text, audio: p.audio ? { data: p.audio, mime: p.mime } : null };
      }
    }
    voice.speakReplyStream(id, {
      segments: segments(),
      cancel: () => {
        ctrl.abort();
        void packets.return(undefined);
      },
    });
  }
}
