import { SpeakerUnavailableError, type Speaker, type Utterance } from '../types';
import type { AudioPlayer } from './ports';

export type ServerTtsOptions = {
  baseUrl: string | undefined;
  fetchImpl?: typeof fetch;
  /** Give up and let the chain fall back if the audio has not arrived by then. */
  timeoutMs?: number;
};

/**
 * Speaks free text (text with no bundled clip) in the same ElevenLabs voice, via the cloud
 * service's /tts endpoint so the key stays on the server. Declines streamed replies, which
 * already carry their own audio, and anything when no service is configured.
 */
export class ServerTtsSpeaker implements Speaker {
  constructor(
    private player: AudioPlayer,
    private opts: ServerTtsOptions,
  ) {}

  async speak(utterance: Utterance, signal: AbortSignal): Promise<void> {
    const { baseUrl } = this.opts;
    if (!baseUrl) throw new SpeakerUnavailableError('no cloud service configured');
    if (utterance.stream) throw new SpeakerUnavailableError('streamed reply');
    if (signal.aborted) return;
    // The alert's abort or the timeout, whichever comes first (no AbortSignal.any on Hermes).
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(onAbort, this.opts.timeoutMs ?? 4_000);
    let data: Uint8Array;
    let mime: string;
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(`${baseUrl.replace(/\/$/, '')}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: utterance.text }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new SpeakerUnavailableError(`tts HTTP ${res.status}`);
      mime = res.headers.get('content-type') ?? 'audio/mpeg';
      data = new Uint8Array(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    if (data.length === 0) throw new SpeakerUnavailableError('empty tts audio');
    await this.player.play({ kind: 'bytes', data, mime }, signal);
  }
}
