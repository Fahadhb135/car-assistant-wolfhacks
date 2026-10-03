import { describe, expect, it, vi } from 'vitest';

import type { DriveEvent } from '../../core/events/types';
import { buildCloudTrip, cloudEvents, submitTrip } from './tripUpload';

const events: DriveEvent[] = [
  { eventId: 'c1', kind: 'crash', severity: 'critical', confirmed: false, t: 10 },
  { eventId: 's1', kind: 'erratic_driving', severity: 'warn', score: 0.7, t: 20 },
  { eventId: 'h1', kind: 'highway_entering', severity: 'info', speedMps: 20, targetSpeedMps: 25, targetIsDefault: false, advice: 'speed_up', t: 30 },
];

describe('trip upload', () => {
  it('serializes cloud-supported events without detector evidence', () => {
    expect(cloudEvents(events)).toEqual([
      { eventId: 'c1', kind: 'crash', confirmed: false, t: 10 },
      { eventId: 's1', kind: 'erratic_driving', score: 0.7, t: 20 },
    ]);
    const trip = buildCloudTrip({ tripId: 't1', driverId: 'anon', start: 1, end: 40, events });
    expect(trip.scores.smoothness).toBe(52);
    expect(trip.features).toEqual([]);
  });

  it('posts the trip to the configured cloud service', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    const trip = buildCloudTrip({ tripId: 't1', driverId: 'anon', start: 1, end: 40, events });
    await submitTrip({ baseUrl: 'http://cloud/', trip, fetchImpl: fetchImpl as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://cloud/trips',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(trip) }),
    );
  });

  it('rejects non-success responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const trip = buildCloudTrip({ tripId: 't1', driverId: 'anon', start: 1, end: 40, events: [] });
    await expect(submitTrip({ baseUrl: 'http://cloud', trip, fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toThrow('HTTP 503');
  });
});
