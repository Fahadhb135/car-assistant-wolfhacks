import { useEffect, useMemo, useState } from 'react';

import type { DriveEvent } from '../../core/events/types';
import { fetchDriverStats, requestCoachLine, type DriverStatsResult } from '../../integrations/backend/coachClient';
import { smoothnessScore } from '../../integrations/backend/tripUpload';
import type { VoiceCoordinator } from '../voice/VoiceCoordinator';
import type { DriveContext } from './DriveContext';
import { LiveCoach } from './LiveCoach';

/** Live Gemini coaching for one drive, or null when no cloud service is configured. */
export function useLiveCoach(
  voice: VoiceCoordinator,
  context: DriveContext,
  getEvents: () => DriveEvent[],
  driverId: string,
  startedAt: number,
): LiveCoach | null {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  return useMemo(() => {
    if (!baseUrl) return null;
    return new LiveCoach({
      driverId,
      context,
      startedAt,
      request: (body) => requestCoachLine({ baseUrl, body }),
      speak: (id, text) => voice.speakCoach(id, text),
      recentEvents: getEvents,
      smoothness: () => smoothnessScore(getEvents()),
    });
  }, [baseUrl, voice, context, getEvents, driverId, startedAt]);
}

/** The driver's Databricks history for the score screen, fetched once when the drive starts. */
export function useDriverStats(driverId: string): DriverStatsResult | null {
  const [stats, setStats] = useState<DriverStatsResult | null>(null);
  useEffect(() => {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!baseUrl) return;
    let cancelled = false;
    void fetchDriverStats({ baseUrl, driverId }).then((result) => {
      if (!cancelled) setStats(result);
    });
    return () => {
      cancelled = true;
    };
  }, [driverId]);
  return stats;
}

export type ScoreSummary = Readonly<{ label: string; detail: string }>;

/** Words for the live trip score. */
export function scoreSummary(score: number): ScoreSummary {
  if (score >= 85) return { label: 'Smooth driving', detail: 'Steady speed and clean turns.' };
  if (score >= 70) return { label: 'Mostly smooth', detail: 'A few firm moments. Keep it gentle.' };
  return { label: 'Take it easy', detail: 'Several harsh moments this trip.' };
}

/** One line comparing this trip with the driver's history in Databricks. */
export function historyLine(result: DriverStatsResult | null): string | null {
  if (!result) return null;
  const s = result.stats;
  if (!s || s.trips === 0) return 'First recorded drive. Your history builds up in Databricks.';
  const parts = [`${s.trips} past trips`];
  if (s.avgSmoothness !== null) parts.push(`usual ${Math.round(s.avgSmoothness)}`);
  if (s.recentSmoothness !== null) parts.push(`last 3: ${Math.round(s.recentSmoothness)}`);
  return `${parts.join(' · ')}${result.source === 'databricks' ? ' (Databricks)' : ''}`;
}
