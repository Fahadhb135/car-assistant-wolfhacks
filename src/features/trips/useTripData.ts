import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import {
  fetchDriverTrips,
  fetchTripSummary,
  type DriverTrips,
  type TripSummary,
} from '../../integrations/backend/dashboardClient';
import { getReport, type TripReport } from '../../integrations/backend/reports';

export type Loadable<T> = Readonly<{ data: T | null; loading: boolean; failed: boolean }>;

/** The driver's latest trips (Databricks, plus not-yet-ingested ones), reloaded whenever the screen is shown. */
export function useRecentTrips(driverId: string, limit = 5): Loadable<DriverTrips> & { reload: () => void } {
  const [state, setState] = useState<Loadable<DriverTrips>>({ data: null, loading: true, failed: false });
  const [tick, setTick] = useState(0);
  useFocusEffect(useCallback(() => setTick((t) => t + 1), []));
  useEffect(() => {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!baseUrl) {
      setState({ data: null, loading: false, failed: true });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    void fetchDriverTrips({ baseUrl, driverId, limit }).then((data) => {
      if (cancelled) return;
      // Keep the last good list on a failed refresh rather than blanking the screen.
      setState((s) => ({ data: data ?? s.data, loading: false, failed: !data }));
    });
    return () => {
      cancelled = true;
    };
  }, [driverId, limit, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/**
 * One trip's summary. While Databricks has not ingested the trip yet it polls every 20 s, so the
 * screen switches from the service's copy to the Databricks data on its own.
 */
export function useTripSummary(tripId: string): Loadable<TripSummary> {
  const [state, setState] = useState<Loadable<TripSummary>>({ data: null, loading: true, failed: false });
  useEffect(() => {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!baseUrl) {
      setState({ data: null, loading: false, failed: true });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = (attempt: number) => {
      void fetchTripSummary({ baseUrl, tripId }).then((data) => {
        if (cancelled) return;
        setState((s) => ({ data: data ?? s.data, loading: false, failed: !data && !s.data }));
        const waiting = data ? data.source !== 'databricks' : true;
        if (waiting && attempt < 15) timer = setTimeout(() => load(attempt + 1), 20_000);
      });
    };
    load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tripId]);
  return state;
}

/** Gemini's written report for the trip (the cloud writes it right after upload). */
export function useTripReport(tripId: string): TripReport | null {
  const [report, setReport] = useState<TripReport | null>(null);
  useEffect(() => {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!baseUrl) return;
    let cancelled = false;
    void getReport({ baseUrl, tripId, timeoutMs: 20_000 }).then((r) => !cancelled && setReport(r?.report ?? null));
    return () => {
      cancelled = true;
    };
  }, [tripId]);
  return report;
}
