import { describe, expect, it, vi } from 'vitest';

import type { DriveEvent, DriveEventBody } from '../../core/events/types';
import {
  CRASH_QUIET_INTERVAL_MS,
  DriveEventGate,
  DriveEventRouter,
} from './DriveEventGate';

let id = 0;
function event(body: DriveEventBody): DriveEvent {
  return { ...body, eventId: `gate-${++id}`, t: 1_700_000_000_000 } as DriveEvent;
}

const crash = () => event({ kind: 'crash', severity: 'critical', confirmed: false });
const braking = () => event({ kind: 'hard_braking', severity: 'warn', score: 0.8, evidence: {} });
const locationAlert = () => event({ kind: 'stop_sign_ahead', severity: 'info', distanceM: 50 });

describe('DriveEventGate', () => {
  it('admits one possible crash and suppresses IMU and location events until the exact boundary', () => {
    let now = 100;
    const gate = new DriveEventGate({ monotonicNow: () => now });

    expect(gate.evaluate(crash()).admitted).toBe(true);
    now += 1;
    expect(gate.evaluate(braking())).toMatchObject({ admitted: false, reason: 'crash_quiet_interval' });
    expect(gate.evaluate(locationAlert()).admitted).toBe(false);
    expect(gate.evaluate(crash()).admitted).toBe(false);

    const quiet = gate.snapshot();
    expect(quiet).toMatchObject({ quiet: true, suppressedCount: 3 });
    expect(quiet.suppressedByKind).toEqual({ hard_braking: 1, stop_sign_ahead: 1, crash: 1 });

    now = 100 + CRASH_QUIET_INTERVAL_MS;
    expect(gate.evaluate(locationAlert()).admitted).toBe(true);
    expect(gate.snapshot()).toMatchObject({ quiet: false, quietRemainingMs: 0 });
  });

  it('clamps a regressing injected clock and resets all per-drive state', () => {
    let now = 1_000;
    const gate = new DriveEventGate({ monotonicNow: () => now });
    gate.evaluate(crash());
    now = 0;
    expect(gate.evaluate(braking()).admitted).toBe(false);
    gate.reset();
    expect(gate.snapshot()).toEqual({
      quiet: false,
      quietUntilMonotonicMs: null,
      quietRemainingMs: 0,
      admittedCount: 0,
      suppressedCount: 0,
      suppressedByKind: {},
    });
    expect(gate.evaluate(braking()).admitted).toBe(true);
  });

  it('routes only admitted events to retention and voice', () => {
    let now = 0;
    const onEvent = vi.fn();
    const handleEvent = vi.fn();
    const onDecision = vi.fn();
    const router = new DriveEventRouter({
      gate: new DriveEventGate({ monotonicNow: () => now }),
      voice: { handleEvent },
      onEvent,
      onDecision,
    });

    expect(router.route(crash())).toBe(true);
    now = 10;
    expect(router.route(locationAlert())).toBe(false);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(handleEvent).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledTimes(2);
  });
});
