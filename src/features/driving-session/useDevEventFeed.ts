import { useEffect } from 'react';

import type { DriveEvent } from '../../core/events/types';
import type { DriveEventSink } from './DriveEventGate';

const POLL_MS = 1_000;

/**
 * Dev builds only: pulls test events queued on the cloud (POST /dev/events, enabled with
 * DEV_EVENTS=1) into the running drive through the real gate, voice queue, and live coach, so
 * voice and coaching edge cases can be checked without driving. Each event is a DriveEvent body
 * ({ kind, severity, ... }); its id and time are filled in here.
 */
export function useDevEventFeed(enabled: boolean, sink: DriveEventSink): void {
  useEffect(() => {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!__DEV__ || !enabled || !baseUrl) return;
    let n = 0;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/dev/events`, { signal: AbortSignal.timeout(3_000) });
        if (!res.ok || stopped) return;
        const bodies = (await res.json()) as Record<string, unknown>[];
        for (const body of bodies) {
          const event = { ...body, eventId: `dev-${Date.now()}-${++n}`, t: Date.now() } as unknown as DriveEvent;
          const admitted = sink.route(event);
          console.log(`[dev event] ${event.kind} ${admitted ? 'admitted' : 'suppressed by the gate'}`);
        }
      } catch {
        // Feed unavailable: nothing to inject.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [enabled, sink]);
}
