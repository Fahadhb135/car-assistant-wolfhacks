import { useCallback, useEffect, useRef, useState } from 'react';

import type { ParentResult, ParentSession } from '../../integrations/backend/parentClient';
import { loadWithFallback, type Loaded, type ResourceCache } from './loadWithFallback';
import { clearParentSession, getParentSession } from './parentSession';

/** One cache for the whole app session: the last good response per screen, for when the connection drops. */
const cache: ResourceCache = new Map();

export function currentParentSession(): ParentSession | null {
  const stored = getParentSession();
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  return stored && baseUrl ? { baseUrl, token: stored.token } : null;
}

/**
 * Loads one parent resource and keeps it fresh on demand (`reload`). A 401 means the driver revoked
 * access, so the saved link is dropped and the screen sends the parent back to the link screen.
 */
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
    const session = currentParentSession();
    setLoading(true);
    if (!session) {
      setState({ status: 'error', failure: process.env.EXPO_PUBLIC_API_URL ? 'unauthorized' : 'offline' });
      setLoading(false);
      return;
    }
    void loadWithFallback(cache, key, () => fetcherRef.current(session)).then((next) => {
      if (run !== latest.current) return; // a newer request (e.g. another range) already took over
      if (next.status === 'error' && next.failure === 'unauthorized') clearParentSession();
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
