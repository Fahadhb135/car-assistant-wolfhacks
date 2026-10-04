import { ExpoAudioPlayer } from '../../integrations/audio/ExpoAudioPlayer';
import { ExpoSpeechTts } from '../../integrations/audio/ExpoSpeechTts';
import { configureAlertAudioSession, expoAudioBackend, expoSpeechBackend } from '../../integrations/audio/expoBackends';
import { BUNDLED_PHRASES } from './bundledPhrases';
import { buildSpeakerChain } from './speakerChain';
import { ServerTtsSpeaker } from './speakers/ServerTtsSpeaker';
import type { Alert, LiveControl } from './types';
import { VoiceCoordinator } from './VoiceCoordinator';

/** No Gemini Live session yet (push-to-talk chat is the default conversation path). */
const NO_LIVE: LiveControl = { isActive: () => false, pause() {}, resume() {}, end() {} };

/** The app's voice: bundled alerts, phone-voice fallback, ducking over music. Call once per drive. */
export function createVoice(
  onError: (err: unknown) => void = (e) => console.warn('[voice]', e),
  onAlertStart?: (alert: Alert) => void,
): VoiceCoordinator {
  void configureAlertAudioSession().catch(onError);
  const player = new ExpoAudioPlayer(expoAudioBackend);
  // Free text goes through the cloud's ElevenLabs /tts so every line uses the same voice; the
  // phone's built-in voice is only the last resort when that is unreachable.
  const speaker = buildSpeakerChain(
    BUNDLED_PHRASES,
    player,
    new ExpoSpeechTts(expoSpeechBackend),
    [new ServerTtsSpeaker(player, { baseUrl: process.env.EXPO_PUBLIC_API_URL })],
  );
  return new VoiceCoordinator({ speaker, live: NO_LIVE, onError, onAlertStart });
}
