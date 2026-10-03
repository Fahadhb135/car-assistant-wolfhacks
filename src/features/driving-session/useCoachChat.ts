import { fetch as expoFetch } from 'expo/fetch';
import { useEffect, useMemo, useState } from 'react';

import type { DriveEvent } from '../../core/events/types';
import { CoachChat } from '../voice/chat/CoachChat';
import { PushToTalk, type PttState, type SpeechRecognizer } from '../voice/ptt/PushToTalk';
import type { VoiceCoordinator } from '../voice/VoiceCoordinator';

/** No on-device recognizer is installed yet, so hold-to-talk stays hidden and the chips do the asking. */
export const NO_RECOGNIZER: SpeechRecognizer = {
  available: false,
  async start() {},
  async stop() {
    return '';
  },
  cancel() {},
};

export const QUICK_QUESTIONS = ['How was that?', 'Why was that a rolling stop?', 'What should I work on?'] as const;

export type CoachChatApi = {
  enabled: boolean;
  state: PttState;
  canTalk: boolean;
  ask(question: string): void;
  pressIn(): void;
  pressOut(): void;
  /** Call when a safety alert starts, so listening stops. */
  cancel(): void;
};

/** Coach chat for the drive screen. Disabled (no chips) unless EXPO_PUBLIC_API_URL is set. */
export function useCoachChat(
  voice: VoiceCoordinator,
  getEvents: () => DriveEvent[],
  recognizer: SpeechRecognizer = NO_RECOGNIZER,
): CoachChatApi {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  const [state, setState] = useState<PttState>('idle');
  const ptt = useMemo(() => {
    if (!baseUrl) return null;
    const chat = new CoachChat({
      baseUrl,
      voice,
      getRecentEvents: getEvents,
      streamFetchImpl: expoFetch as unknown as typeof fetch, // expo/fetch can stream the response body
    });
    return new PushToTalk({ recognizer, chat, voice, onState: setState });
  }, [baseUrl, voice, getEvents, recognizer]);
  useEffect(() => () => ptt?.cancel(), [ptt]);

  return {
    enabled: !!ptt,
    state,
    canTalk: !!ptt?.canListen,
    ask: (q) => void ptt?.askQuick(q),
    pressIn: () => void ptt?.pressIn(),
    pressOut: () => void ptt?.pressOut(),
    cancel: () => ptt?.cancel(),
  };
}
