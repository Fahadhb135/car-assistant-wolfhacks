import { describe, expect, it, vi } from 'vitest';

import { buildCloudTrip } from '../../integrations/backend/tripUpload';
import { getStoredTrip, saveTrip, uploadStoredTrip } from './tripStore';

function trip(id: string) {
  return buildCloudTrip({ tripId: id, driverId: 'anon', start: 1, end: 2, events: [] });
}

describe('tripStore', () => {
  it('keeps a failed upload retryable and later marks it uploaded', async () => {
    saveTrip(trip('retry-me'));
    const failedFetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect((await uploadStoredTrip('retry-me', 'http://cloud', failedFetch)).uploadState).toBe('failed');
    expect(getStoredTrip('retry-me')?.trip.tripId).toBe('retry-me');

    const goodFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 }) as unknown as typeof fetch;
    expect((await uploadStoredTrip('retry-me', 'http://cloud', goodFetch)).uploadState).toBe('uploaded');
  });

  it('preserves the trip when the cloud URL is absent', async () => {
    saveTrip(trip('not-configured'));
    const stored = await uploadStoredTrip('not-configured', undefined);
    expect(stored.uploadState).toBe('failed');
    expect(stored.uploadError).toMatch(/not configured/i);
  });
});
