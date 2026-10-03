import type { DriveEvent } from '../../core/events/types';
import { AlertQueue } from './AlertQueue';
import { alertFromEvent, chatReplyAlert, coachingTipAlert } from './phrases';
import type { Alert, LiveControl, Speaker } from './types';

export type VoiceDeps = {
  speaker: Speaker;
  live: LiveControl;
  now?: () => number;
  onError?: (err: unknown, alert: Alert) => void;
};

/**
 * Single owner of the speaker. Alerts preempt Gemini Live: Live is paused while
 * an alert plays and resumed after, and a crash ends the Live session outright.
 */
export class VoiceCoordinator {
  private queue = new AlertQueue();
  private current: { alert: Alert; ctrl: AbortController } | null = null;
  private livePaused = false;
  private readonly now: () => number;

  constructor(private deps: VoiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  handleEvent(event: DriveEvent): void {
    this.queue.enqueue(alertFromEvent(event), this.now());
    this.pump();
  }

  /** Coaching tips only play when nothing else is speaking and Live is idle. */
  suggestTip(id: string, text: string): void {
    this.queue.enqueue(coachingTipAlert(id, text, this.now()), this.now());
    this.pump();
  }

  /** Speak the coach's answer to a driver question. Safety alerts still preempt it. */
  speakReply(id: string, text: string): void {
    this.queue.enqueue(chatReplyAlert(id, text, this.now()), this.now());
    this.pump();
  }

  /** Call when the Live session ends so deferred tips can play. */
  notifyLiveIdle(): void {
    this.pump();
  }

  private pump(): void {
    const now = this.now();
    const allowTips = !this.deps.live.isActive();

    if (this.current) {
      const top = this.queue.peek(now, { allowTips });
      if (top && top.priority > this.current.alert.priority) {
        // Settling the speaker re-enters pump() from play().
        this.current.ctrl.abort();
      }
      return;
    }

    const next = this.queue.next(now, { allowTips });
    if (next) {
      void this.play(next);
      return;
    }
    if (this.livePaused) {
      this.livePaused = false;
      this.deps.live.resume();
    }
  }

  private async play(alert: Alert): Promise<void> {
    const ctrl = new AbortController();
    this.current = { alert, ctrl };

    if (alert.kind === 'crash') {
      this.deps.live.end();
      this.livePaused = false;
    } else if (this.deps.live.isActive() && !this.livePaused) {
      this.deps.live.pause();
      this.livePaused = true;
    }

    try {
      await this.deps.speaker.speak(alert.utterance, ctrl.signal);
    } catch (err) {
      if (!ctrl.signal.aborted) this.deps.onError?.(err, alert);
    } finally {
      this.current = null;
      this.pump();
    }
  }
}
