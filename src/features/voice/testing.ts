import type { DriveEvent, DriveEventBody } from '../../core/events/types';
import type { LiveControl, Speaker, Utterance } from './types';

/** Speaker whose playback stays "in progress" until the test finishes it or aborts it. */
export class FakeSpeaker implements Speaker {
  spoken: string[] = [];
  private finish: (() => void) | null = null;

  speak(utterance: Utterance, signal: AbortSignal): Promise<void> {
    this.spoken.push(utterance.text);
    return new Promise((resolve) => {
      this.finish = resolve;
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  complete(): void {
    this.finish?.();
  }
}

export class FakeLive implements LiveControl {
  calls: string[] = [];
  active = false;
  isActive = () => this.active;
  pause = () => void this.calls.push('pause');
  resume = () => void this.calls.push('resume');
  end = () => {
    this.calls.push('end');
    this.active = false;
  };
}

export const flush = () => new Promise<void>((r) => setTimeout(r, 0));

let n = 0;
export function ev(body: DriveEventBody, t: number): DriveEvent {
  return { ...body, eventId: `e${++n}`, t } as DriveEvent;
}
