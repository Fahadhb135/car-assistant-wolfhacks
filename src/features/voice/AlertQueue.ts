import { POLICIES } from './phrases';
import type { Alert } from './types';

export type EnqueueResult = 'queued' | 'rate_limited';

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

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }

  private dropExpired(now: number): void {
    this.items = this.items.filter((a) => now - a.createdAt <= a.ttlMs);
  }
}
