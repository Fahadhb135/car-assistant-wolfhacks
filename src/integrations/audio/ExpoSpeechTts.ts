import type { TextToSpeech } from '../../features/voice/speakers/ports';

export type SpeechCallbacks = { onDone: () => void; onStopped: () => void; onError: (err: Error) => void };

/** Platform bits for the phone's built-in voice. Real one: expoBackends.ts. */
export interface SpeechBackend {
  speak(text: string, cb: SpeechCallbacks): void;
  stop(): void;
}

/** Generous upper bound on how long the phone takes to say `text` (about 15 characters a second). */
export function speechWatchdogMs(text: string): number {
  return 3_000 + text.length * 70;
}

/** Last-resort speaker: always available, works offline. Aborting stops speech immediately. */
export class ExpoSpeechTts implements TextToSpeech {
  constructor(private backend: SpeechBackend) {}

  speak(text: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let done = false;
      // iOS can cut speech off (e.g. an audio-session interruption) without ever reporting done or
      // stopped, which left the voice queue waiting forever and silenced every later alert. Give up
      // well past the line's expected length.
      const watchdog = setTimeout(() => {
        this.backend.stop();
        settle(resolve);
      }, speechWatchdogMs(text));
      const settle = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        signal.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = () => {
        this.backend.stop();
        settle(resolve);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.backend.speak(text, {
        onDone: () => settle(resolve),
        onStopped: () => settle(resolve),
        onError: (err) => settle(() => reject(err)),
      });
    });
  }
}
