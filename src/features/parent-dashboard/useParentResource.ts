import { useCallback, useEffect, useRef, useState } from 'react';

import type { ParentResult, ParentSession } from '../../integrations/backend/parentClient';
import { getDriverId } from '../driving-session/driverId';
import { loadWithFallback, type Loaded, type ResourceCache } from './loadWithFallback';

/** One cache for the whole app session: the last good response per screen, for when the connection drops. */
const cache: ResourceCache = new Map();

/** This phone's own driver and the cloud service, or null when the service URL is not configured. */
export function currentSession(): ParentSession | null {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  return baseUrl ? { baseUrl, driverId: getDriverId() } : null;
}

/** Loads one dashboard resource and refreshes it on demand (`reload`). */
export function useParentResource<T>(
  key: string,
  fetcher: (session: ParentSession) => Promise<ParentResult<T>>,
): { state: Loaded<T> | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<Loaded<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(() => {
    const run = ++latest.current;
    const session = currentSession();
    setLoading(true);
    if (!session) {
      setState({ status: 'error', failure: 'offline' });
      setLoading(false);
      return;
    }
    void loadWithFallback(cache, key, () => fetcherRef.current(session)).then((next) => {
      if (run !== latest.current) return; // a newer request (e.g. another range) already took over
      setState(next);
      setLoading(false);
    });
  }, [key]);

  useEffect(() => {
    reload();
    return () => {
      latest.current += 1;
    };
  }, [reload]);

  return { state, loading, reload };
}
