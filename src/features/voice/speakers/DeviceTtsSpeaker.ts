import type { Speaker, Utterance } from '../types';
import type { TextToSpeech } from './ports';

/** Last-resort speaker: the phone's built-in voice. Always available, no network. */
export class DeviceTtsSpeaker implements Speaker {
  constructor(private tts: TextToSpeech) {}

  speak(utterance: Utterance, signal: AbortSignal): Promise<void> {
    return this.tts.speak(utterance.text, signal);
  }
}
