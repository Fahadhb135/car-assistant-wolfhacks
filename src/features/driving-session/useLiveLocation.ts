import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

import type { DriveEvent } from '../../core/events/types';
import type { VoiceCoordinator } from '../voice/VoiceCoordinator';
import { createLiveLocationSession } from './createLiveLocationSession';
import { toGpsFix } from './gpsFix';

const MAP_ERROR_VISIBLE_MS = 60_000;
/** Log a GPS fix to the console at most this often (the first fix is always logged). */
const FIX_LOG_INTERVAL_MS = 10_000;

export type LiveLocationStatus = 'idle' | 'requesting' | 'denied' | 'waiting' | 'tracking' | 'error';

/**
 * Live GPS for one drive: watches the phone's location at about 1 Hz and runs each fix through the
 * location coach (stop signs, traffic lights, highway entry/exit from OpenStreetMap). Coaching
 * events go to `onEvent`, the same path as live IMU events. Foreground only: tracking pauses if
 * the app is backgrounded.
 */
export function useLiveLocation(
  enabled: boolean,
  voice: Pick<VoiceCoordinator, 'handleEvent'>,
  onEvent: (event: DriveEvent) => void,
): Readonly<{
  status: LiveLocationStatus;
  mapError: string | null;
  /** Latest GPS speed in m/s, or null when the phone doesn't know it. */
  speedMps: number | null;
  /** Posted limit of the road the car is matched to, m/s, or null when unknown. */
  limitMps: number | null;
  /** How far over the limit triggers a speeding warning, m/s. */
  toleranceMps: number;
}> {
  const [status, setStatus] = useState<LiveLocationStatus>('idle');
  const [speedMps, setSpeedMps] = useState<number | null>(null);
  const [limitMps, setLimitMps] = useState<number | null>(null);
  const [toleranceMps, setToleranceMps] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);
  // Keep the latest callback without restarting GPS when the parent re-renders.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    let mapErrorTimer: ReturnType<typeof setTimeout> | null = null;
    setStatus('requesting');
    setMapError(null);

    setSpeedMps(null);
    setLimitMps(null);
    const { session, speeding } = createLiveLocationSession(
      voice,
      (event) => !cancelled && onEventRef.current(event),
      (err) => {
        // The drive carries on with whatever map data is already loaded.
        console.warn('[live location] map tiles:', err instanceof Error ? err.message : String(err));
        if (cancelled) return;
        setMapError('Map data unavailable; retrying');
        // Tile loads are retried with back-off; drop the warning if no failure follows.
        if (mapErrorTimer) clearTimeout(mapErrorTimer);
        mapErrorTimer = setTimeout(() => setMapError(null), MAP_ERROR_VISIBLE_MS);
      },
    );

    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (!permission.granted) {
          setStatus('denied');
          return;
        }
        setStatus('waiting');
        let primed = false;
        let lastLoggedAt = 0;
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1_000, distanceInterval: 0 },
          (reading) => {
            if (cancelled) return;
            const fix = toGpsFix(reading);
            if (!primed || fix.t - lastLoggedAt >= FIX_LOG_INTERVAL_MS) {
              lastLoggedAt = fix.t;
              console.info(
                `[live location] fix ${fix.lat.toFixed(6)},${fix.lon.toFixed(6)} ` +
                  `±${Math.round(reading.coords.accuracy ?? -1)} m, speed ${fix.speed.toFixed(1)} m/s, heading ${Math.round(fix.heading)}`,
              );
            }
            if (!primed) {
              primed = true;
              setStatus('tracking');
              // Start loading the surrounding map tiles right away.
              void session.prime(fix).catch(() => undefined);
            }
            session.onFix(fix);
            setSpeedMps(fix.speed >= 0 ? fix.speed : null);
            setLimitMps(speeding.currentLimitMps);
            setToleranceMps(speeding.toleranceMps);
          },
        );
        if (cancelled) subscription.remove();
      } catch (err) {
        console.warn('[live location]', err instanceof Error ? err.message : String(err));
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
      if (mapErrorTimer) clearTimeout(mapErrorTimer);
    };
  }, [enabled, voice]);

  return { status, mapError, speedMps, limitMps, toleranceMps };
}
