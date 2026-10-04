import type { DriveEvent, DriveEventKind } from '../../core/events/types';
import type { VoiceCoordinator } from '../voice/VoiceCoordinator';

export const CRASH_QUIET_INTERVAL_MS = 15 * 1_000;

export type DriveEventSuppressionReason = 'crash_quiet_interval';

export type DriveEventGateSnapshot = Readonly<{
  quiet: boolean;
  quietUntilMonotonicMs: number | null;
  quietRemainingMs: number;
  admittedCount: number;
  suppressedCount: number;
  suppressedByKind: Readonly<Partial<Record<DriveEventKind, number>>>;
}>;

export type DriveEventGateDecision = Readonly<{
  admitted: boolean;
  reason?: DriveEventSuppressionReason;
  state: DriveEventGateSnapshot;
}>;

export type DriveEventGateOptions = Readonly<{
  monotonicNow?: () => number;
  quietIntervalMs?: number;
}>;

/**
 * Pure per-drive arbitration for automatic events. Time is read only from the injected monotonic
 * clock, never from an event's wall-clock timestamp. A possible crash wins once and makes the
 * automatic event path quiet for the configured interval.
 */
export class DriveEventGate {
  private readonly monotonicNow: () => number;
  private readonly quietIntervalMs: number;
  private lastNowMs = Number.NEGATIVE_INFINITY;
  private quietUntilMs: number | null = null;
  private admittedCount = 0;
  private suppressedCount = 0;
  private suppressedByKind: Partial<Record<DriveEventKind, number>> = {};

  constructor(options: DriveEventGateOptions = {}) {
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.quietIntervalMs = options.quietIntervalMs ?? CRASH_QUIET_INTERVAL_MS;
    if (!Number.isFinite(this.quietIntervalMs) || this.quietIntervalMs <= 0) {
      throw new Error('quietIntervalMs must be finite and positive');
    }
  }

  evaluate(event: DriveEvent): DriveEventGateDecision {
    const now = this.now();
    if (this.quietUntilMs !== null && now < this.quietUntilMs) {
      this.suppressedCount += 1;
      this.suppressedByKind[event.kind] = (this.suppressedByKind[event.kind] ?? 0) + 1;
      return Object.freeze({
        admitted: false,
        reason: 'crash_quiet_interval',
        state: this.snapshotAt(now),
      });
    }

    if (this.quietUntilMs !== null) this.quietUntilMs = null;
    this.admittedCount += 1;
    if (event.kind === 'crash') this.quietUntilMs = now + this.quietIntervalMs;
    return Object.freeze({ admitted: true, state: this.snapshotAt(now) });
  }

  snapshot(): DriveEventGateSnapshot {
    return this.snapshotAt(this.now());
  }

  reset(): void {
    this.lastNowMs = Number.NEGATIVE_INFINITY;
    this.quietUntilMs = null;
    this.admittedCount = 0;
    this.suppressedCount = 0;
    this.suppressedByKind = {};
  }

  private now(): number {
    const measured = this.monotonicNow();
    if (!Number.isFinite(measured)) throw new Error('monotonic clock must return a finite value');
    this.lastNowMs = Math.max(this.lastNowMs, measured);
    return this.lastNowMs;
  }

  private snapshotAt(now: number): DriveEventGateSnapshot {
    const quiet = this.quietUntilMs !== null && now < this.quietUntilMs;
    return Object.freeze({
      quiet,
      quietUntilMonotonicMs: quiet ? this.quietUntilMs : null,
      quietRemainingMs: quiet ? this.quietUntilMs! - now : 0,
      admittedCount: this.admittedCount,
      suppressedCount: this.suppressedCount,
      suppressedByKind: Object.freeze({ ...this.suppressedByKind }),
    });
  }
}

export interface DriveEventSink {
  route(event: DriveEvent): boolean;
}

export type DriveEventRouterOptions = Readonly<{
  gate: DriveEventGate;
  voice: Pick<VoiceCoordinator, 'handleEvent'>;
  onEvent?: (event: DriveEvent) => void;
  onDecision?: (decision: DriveEventGateDecision, event: DriveEvent) => void;
}>;

/** The sole side-effecting path from an automatic event to retention, the coach card, and voice. */
export class DriveEventRouter implements DriveEventSink {
  constructor(private readonly options: DriveEventRouterOptions) {}

  route(event: DriveEvent): boolean {
    const decision = this.options.gate.evaluate(event);
    this.options.onDecision?.(decision, event);
    if (!decision.admitted) return false;
    this.options.onEvent?.(event);
    this.options.voice.handleEvent(event);
    return true;
  }
}
