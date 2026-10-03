import { submitTrip, type CloudTrip } from '../../integrations/backend/tripUpload';

export type TripUploadState = 'pending' | 'uploading' | 'uploaded' | 'failed';
export type StoredTrip = Readonly<{
  trip: CloudTrip;
  uploadState: TripUploadState;
  uploadError?: string;
}>;

type Listener = () => void;

const trips = new Map<string, StoredTrip>();
const listeners = new Set<Listener>();
let driverId: string | undefined;

function emit(): void {
  for (const listener of listeners) listener();
}

function randomPart(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Anonymous installation-session identity; no hardware identifier or personal data is used. */
export function getAnonymousDriverId(): string {
  driverId ??= `anon-${randomPart()}-${randomPart()}`;
  return driverId;
}

export function createTripId(now = Date.now()): string {
  return `trip-${now.toString(36)}-${randomPart()}`;
}

export function saveTrip(trip: CloudTrip): StoredTrip {
  const stored: StoredTrip = { trip, uploadState: 'pending' };
  trips.set(trip.tripId, stored);
  emit();
  return stored;
}

export function getStoredTrip(tripId: string): StoredTrip | undefined {
  return trips.get(tripId);
}

export function subscribeToTrips(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function uploadStoredTrip(
  tripId: string,
  baseUrl: string | undefined,
  fetchImpl?: typeof fetch,
): Promise<StoredTrip> {
  const current = trips.get(tripId);
  if (!current) throw new Error(`Trip ${tripId} is not available on this device.`);
  if (!baseUrl) {
    const failed: StoredTrip = {
      ...current,
      uploadState: 'failed',
      uploadError: 'Cloud URL is not configured.',
    };
    trips.set(tripId, failed);
    emit();
    return failed;
  }

  const uploading: StoredTrip = { trip: current.trip, uploadState: 'uploading' };
  trips.set(tripId, uploading);
  emit();
  try {
    await submitTrip({ baseUrl, trip: current.trip, fetchImpl });
    const uploaded: StoredTrip = { trip: current.trip, uploadState: 'uploaded' };
    trips.set(tripId, uploaded);
    emit();
    return uploaded;
  } catch (cause) {
    const failed: StoredTrip = {
      trip: current.trip,
      uploadState: 'failed',
      uploadError: cause instanceof Error ? cause.message : String(cause),
    };
    trips.set(tripId, failed);
    emit();
    return failed;
  }
}
