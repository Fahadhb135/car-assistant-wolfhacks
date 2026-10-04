import { describe, expect, it, vi } from 'vitest';

import type { ImuEvent } from '../../core/events/types';
import { ImuEventRouter } from './ImuEventRouter';

const crash: ImuEvent = {
  kind: 'crash_candidate',
  occurredAtMs: 2_000,
  severity: 'critical',
  confidence: 0.91,
  evidence: { peakG: 5.4 },
};

const swerve: ImuEvent = {
  kind: 'swerve_candidate',
  occurredAtMs: 2_500,
  severity: 'warning',
  confidence: 0.72,
  evidence: { rotation: 80 },
};

describe('ImuEventRouter', () => {
  it('stamps and routes candidates through the shared drive event sink', () => {
    const route = vi.fn(() => true);
    const router = new ImuEventRouter({
      eventSink: { route },
      nextId: () => 'imu-1',
      wallClockNow: () => 1_700_000_002_000,
    });

    const event = router.route(crash);

    expect(event).toEqual({
      eventId: 'imu-1',
      kind: 'crash',
      severity: 'critical',
      confirmed: false,
      t: 1_700_000_002_000,
    });
    expect(route).toHaveBeenCalledWith(event);
  });

  it('does not return a candidate rejected by the shared gate', () => {
    const router = new ImuEventRouter({
      eventSink: { route: () => false },
      wallClockNow: () => 2_000,
    });
    expect(router.route(crash)).toBeUndefined();
  });

  it('keeps one monotonic-to-wall-clock offset for the whole drive', () => {
    const times = [10_000, 999_999];
    const router = new ImuEventRouter({
      eventSink: { route: () => true },
      nextId: (() => {
        let id = 0;
        return () => `i${++id}`;
      })(),
      wallClockNow: () => times.shift()!,
    });

    expect(router.route(crash)?.t).toBe(10_000);
    expect(router.route(swerve)?.t).toBe(10_500);
  });
});
