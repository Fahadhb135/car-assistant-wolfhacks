import { SpeakerUnavailableError, type Speaker, type Utterance } from '../types';
import type { AudioPlayer } from './ports';

export type ElevenLabsConfig = {
  apiKey: string;
  voiceId: string;
  modelId?: string;
  /** Give up and let the fallback speaker take over after this long. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** Dynamic-text TTS. The key is in app config for the demo only (see README risks). */
export class ElevenLabsSpeaker implements Speaker {
  constructor(
    private config: ElevenLabsConfig,
    private player: AudioPlayer,
  ) {}

  async speak(utterance: Utterance, signal: AbortSignal): Promise<void> {
    const { apiKey, voiceId, modelId = 'eleven_flash_v2_5', timeoutMs = 2500 } = this.config;
    if (!apiKey) throw new SpeakerUnavailableError('missing ElevenLabs key');
    const doFetch = this.config.fetchImpl ?? fetch;

    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await doFetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: utterance.text, model_id: modelId }),
        signal: AbortSignal.any([signal, timeout]),
      },
    );
    if (!res.ok) throw new SpeakerUnavailableError(`ElevenLabs HTTP ${res.status}`);
    const data = new Uint8Array(await res.arrayBuffer());
    if (signal.aborted) return;
    await this.player.play({ kind: 'bytes', data, mime: 'audio/mpeg' }, signal);
  }
}
