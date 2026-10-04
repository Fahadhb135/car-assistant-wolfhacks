import type { ParentFailure, ParentResult } from '../../integrations/backend/parentClient';

/** The last good response per screen, so a dropped connection shows the old numbers with their age. */
export type ResourceCache = Map<string, { data: unknown; savedAt: number }>;

export type Loaded<T> =
  | { status: 'ready'; data: T; savedAt: number; stale: false }
  | { status: 'ready'; data: T; savedAt: number; stale: true; failure: ParentFailure }
  | { status: 'error'; failure: ParentFailure };

/** Fetch, and fall back to the last good copy when the network is the problem. */
export async function loadWithFallback<T>(
  cache: ResourceCache,
  key: string,
  fetcher: () => Promise<ParentResult<T>>,
  now: () => number = Date.now,
): Promise<Loaded<T>> {
  const result = await fetcher();
  if (result.ok) {
    const savedAt = now();
    cache.set(key, { data: result.data, savedAt });
    return { status: 'ready', data: result.data, savedAt, stale: false };
  }
  const old = cache.get(key);
  if (old && (result.reason === 'offline' || result.reason === 'bad-response')) {
    return { status: 'ready', data: old.data as T, savedAt: old.savedAt, stale: true, failure: result.reason };
  }
  return { status: 'error', failure: result.reason };
}

export function failureMessage(failure: ParentFailure): string {
  switch (failure) {
    case 'offline': return 'Can’t reach the Car Assistant service. Check your connection and try again.';
    case 'not-found': return 'We couldn’t find that drive.';
    case 'bad-response': return 'The service sent something unexpected. Try again in a moment.';
  }
}
