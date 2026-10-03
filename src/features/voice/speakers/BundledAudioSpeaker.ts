import { SpeakerUnavailableError, type Speaker, type Utterance } from '../types';
import type { AudioPlayer } from './ports';

/** Plays pre-generated phrase audio. Works offline and has no network latency. */
export class BundledAudioSpeaker implements Speaker {
  constructor(
    private assets: Record<string, number | string>,
    private player: AudioPlayer,
  ) {}

  async speak(utterance: Utterance, signal: AbortSignal): Promise<void> {
    const ref = utterance.phraseId ? this.assets[utterance.phraseId] : undefined;
    if (ref === undefined) throw new SpeakerUnavailableError('no bundled audio');
    await this.player.play({ kind: 'asset', ref }, signal);
  }
}
