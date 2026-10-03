import type { TextToSpeech } from '../../features/voice/speakers/ports';

export type SpeechCallbacks = { onDone: () => void; onStopped: () => void; onError: (err: Error) => void };

/** Platform bits for the phone's built-in voice. Real one: expoBackends.ts. */
export interface SpeechBackend {
  speak(text: string, cb: SpeechCallbacks): void;
  stop(): void;
}

/** Last-resort speaker: always available, works offline. Aborting stops speech immediately. */
export class ExpoSpeechTts implements TextToSpeech {
  constructor(private backend: SpeechBackend) {}

  speak(text: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let done = false;
      const settle = (fn: () => void) => {
        if (done) return;
        done = true;
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
