import { describe, expect, it, vi } from 'vitest';

import type { DriveEvent } from '../../core/events/types';
import { buildCloudTrip, cloudEvents, submitTrip } from './tripUpload';

const events: DriveEvent[] = [
  { eventId: 'c1', kind: 'crash', severity: 'critical', confirmed: false, t: 10 },
  { eventId: 's1', kind: 'erratic_driving', severity: 'warn', score: 0.7, t: 20 },
  { eventId: 'b1', kind: 'hard_braking', severity: 'warn', score: 0.8, evidence: { durationMs: 300, peakAccelerationG: 0.5 }, t: 25 },
  { eventId: 'h1', kind: 'highway_entering', severity: 'info', speedMps: 20, targetSpeedMps: 25, targetIsDefault: false, advice: 'speed_up', t: 30 },
];

describe('trip upload', () => {
  it('serializes every event, with calibrated behavior evidence and kind-specific detail', () => {
    expect(cloudEvents(events)).toEqual([
      { eventId: 'c1', kind: 'crash', confirmed: false, t: 10 },
      { eventId: 's1', kind: 'erratic_driving', score: 0.7, t: 20 },
      { eventId: 'b1', kind: 'hard_braking', score: 0.8, evidence: { durationMs: 300, peakAccelerationG: 0.5 }, t: 25 },
      {
        eventId: 'h1', kind: 'highway_entering', t: 30,
        detail: { speedMps: 20, targetSpeedMps: 25, targetIsDefault: false, advice: 'speed_up' },
      },
    ]);
    const trip = buildCloudTrip({ tripId: 't1', driverId: 'anon', start: 1, end: 40, events });
    expect(trip.scores.smoothness).toBe(47);
    expect(trip.features).toEqual([]);
  });

  it('stamps each event with where the car was, and carries what the coach said', () => {
    const trip = buildCloudTrip({
      tripId: 't1', driverId: 'anon', start: 1, end: 40, events,
      stampFor: (id) => (id === 'h1' ? { lat: 35.8, lon: -78.6, speedMps: 17, limitMps: 29, road: 'I-40' } : undefined),
      transcript: [{ t: 31, role: 'assistant', text: 'Match highway speed earlier on the ramp.' }],
    });
    expect(trip.events[3]).toMatchObject({ lat: 35.8, lon: -78.6, speedMps: 17, limitMps: 29, road: 'I-40' });
    expect(trip.events[0]).not.toHaveProperty('lat');
    expect(trip.transcript).toEqual([{ t: 31, role: 'assistant', text: 'Match highway speed earlier on the ramp.' }]);
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
