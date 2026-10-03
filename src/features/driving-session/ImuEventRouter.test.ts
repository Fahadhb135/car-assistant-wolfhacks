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
  it('stamps, records, and voices candidates on the app-wide event path', () => {
    const handleEvent = vi.fn();
    const onEvent = vi.fn();
    const router = new ImuEventRouter({
      voice: { handleEvent },
      onEvent,
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
    expect(onEvent).toHaveBeenCalledWith(event);
    expect(handleEvent).toHaveBeenCalledWith(event);
  });

  it('keeps one monotonic-to-wall-clock offset for the whole drive', () => {
    const times = [10_000, 999_999];
    const router = new ImuEventRouter({
      voice: { handleEvent: vi.fn() },
      nextId: (() => {
        let id = 0;
        return () => `i${++id}`;
      })(),
      wallClockNow: () => times.shift()!,
    });

    expect(router.route(crash).t).toBe(10_000);
    expect(router.route(swerve).t).toBe(10_500);
  });
});
