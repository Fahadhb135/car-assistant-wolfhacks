import { SpeakerUnavailableError, type Speaker, type Utterance } from '../types';

/** Tries each speaker in order. Aborts are never retried on the next speaker. */
export class FallbackSpeaker implements Speaker {
  constructor(private speakers: Speaker[]) {}

  async speak(utterance: Utterance, signal: AbortSignal): Promise<void> {
    let lastError: unknown = new SpeakerUnavailableError('no speakers configured');
    for (const speaker of this.speakers) {
      if (signal.aborted) return;
      try {
        await speaker.speak(utterance, signal);
        return;
      } catch (err) {
        if (signal.aborted) return;
        lastError = err;
      }
    }
    throw lastError;
  }
}
