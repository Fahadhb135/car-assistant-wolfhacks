import { useEffect, useRef, useState } from 'react';

import { createVoice } from '../voice/createVoice';
import { CLEAR_ROAD, coachMessage, type CoachMessage } from './coachMessage';
import { createReplaySession } from './createReplaySession';
import { replayFixes } from './replayRoute';

const FINISHED: CoachMessage = { title: 'Replay finished', detail: 'Nice drive. Tap End drive for your summary.', tone: 'calm' };
/** After a coaching message has been up this long with nothing new, go back to the calm state. */
const CALM_AFTER_MS = 8_000;

/**
 * Replays the demo drive in real time through the real coaching, hotspot and voice code, fully
 * offline (bundled map tile and hotspots). Returns the message for the drive screen's coach card.
 */
export function useReplayDrive(enabled: boolean): { coach: CoachMessage; finished: boolean } {
  const [coach, setCoach] = useState<CoachMessage>(CLEAR_ROAD);
  const [finished, setFinished] = useState(false);
  const calmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const voice = createVoice();
    const show = (m: CoachMessage) => {
      if (cancelled) return;
      setCoach(m);
      if (calmTimer.current) clearTimeout(calmTimer.current);
      calmTimer.current = setTimeout(() => !cancelled && setCoach(CLEAR_ROAD), CALM_AFTER_MS);
    };
    const session = createReplaySession(voice, (e) => show(coachMessage(e)));
    // Fix times follow the real clock so the voice queue's staleness rules behave as in a live drive.
    const fixes = replayFixes(undefined, Date.now());
    let i = 0;
    const timer = setInterval(() => {
      if (cancelled) return;
      const fix = fixes[i++];
      if (!fix) {
        clearInterval(timer);
        setFinished(true);
        setCoach(FINISHED);
        return;
      }
      void session.onFix(fix).catch((err) => console.warn('[replay]', err));
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (calmTimer.current) clearTimeout(calmTimer.current);
    };
  }, [enabled]);

  return { coach, finished };
}
