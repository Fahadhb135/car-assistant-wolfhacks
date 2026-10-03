import { useEffect, useRef } from 'react';

import { createVoice } from '../voice/createVoice';
import type { VoiceCoordinator } from '../voice/VoiceCoordinator';
import type { Alert } from '../voice/types';

/** One voice coordinator for the drive screen's lifetime, shared by coaching alerts and the chat. */
export function useDriveVoice(onAlertStart?: (alert: Alert) => void): VoiceCoordinator {
  const cb = useRef(onAlertStart);
  cb.current = onAlertStart;
  const ref = useRef<VoiceCoordinator | null>(null);
  if (!ref.current) ref.current = createVoice(undefined, (a) => cb.current?.(a));
  useEffect(() => () => ref.current?.interruptChat(), []);
  return ref.current;
}
