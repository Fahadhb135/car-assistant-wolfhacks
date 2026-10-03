import { ExpoAudioPlayer } from '../../integrations/audio/ExpoAudioPlayer';
import { ExpoSpeechTts } from '../../integrations/audio/ExpoSpeechTts';
import { configureAlertAudioSession, expoAudioBackend, expoSpeechBackend } from '../../integrations/audio/expoBackends';
import { BUNDLED_PHRASES } from './bundledPhrases';
import { buildSpeakerChain } from './speakerChain';
import type { LiveControl } from './types';
import { VoiceCoordinator } from './VoiceCoordinator';

/** No Gemini Live session yet (push-to-talk chat is the default conversation path). */
const NO_LIVE: LiveControl = { isActive: () => false, pause() {}, resume() {}, end() {} };

/** The app's voice: bundled alerts, phone-voice fallback, ducking over music. Call once per drive. */
export function createVoice(onError: (err: unknown) => void = (e) => console.warn('[voice]', e)): VoiceCoordinator {
  void configureAlertAudioSession().catch(onError);
  const speaker = buildSpeakerChain(
    BUNDLED_PHRASES,
    new ExpoAudioPlayer(expoAudioBackend),
    new ExpoSpeechTts(expoSpeechBackend),
  );
  return new VoiceCoordinator({ speaker, live: NO_LIVE, onError });
}
