import { POLICIES } from './phrases';
import type { Alert } from './types';

export type EnqueueResult = 'queued' | 'rate_limited';

/** A dropped alert that is still streaming in must stop its request (SpokenStream contract). */
function release(a: Alert): void {
  a.utterance.stream?.cancel();
}

/** Priority queue with per-kind cooldowns and staleness dropping. Pure; time is passed in. */
export class AlertQueue {
  private items: Alert[] = [];
  private lastAccepted = new Map<string, number>();

  enqueue(alert: Alert, now: number): EnqueueResult {
    const last = this.lastAccepted.get(alert.kind);
    if (last !== undefined && now - last < POLICIES[alert.kind].cooldownMs) {
      return 'rate_limited';
    }
    this.lastAccepted.set(alert.kind, now);
    this.items.push(alert);
    // Highest priority first, then oldest first.
    this.items.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    return 'queued';
  }

  /** Highest-priority non-expired alert without removing it. */
  peek(now: number, opts: { allowTips: boolean }): Alert | undefined {
    this.dropExpired(now);
    return this.items.find((a) => opts.allowTips || a.kind !== 'coaching_tip');
  }

  next(now: number, opts: { allowTips: boolean }): Alert | undefined {
    const alert = this.peek(now, opts);
    if (alert) this.items = this.items.filter((a) => a !== alert);
    return alert;
  }

  /** Drop everything of one kind (e.g. a chat reply the driver no longer wants). */
  removeKind(kind: string): void {
    this.items = this.items.filter((a) => (a.kind === kind ? (release(a), false) : true));
  }

  /** Drop and release all queued work below a safety alert's priority. */
  removeBelowPriority(priority: number): void {
    this.items = this.items.filter((alert) => (alert.priority < priority ? (release(alert), false) : true));
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    for (const alert of this.items) release(alert);
    this.items = [];
  }

  private dropExpired(now: number): void {
    this.items = this.items.filter((a) => (now - a.createdAt <= a.ttlMs ? true : (release(a), false)));
  }
}
