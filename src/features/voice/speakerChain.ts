import { BundledAudioSpeaker } from './speakers/BundledAudioSpeaker';
import { DeviceTtsSpeaker } from './speakers/DeviceTtsSpeaker';
import { FallbackSpeaker } from './speakers/FallbackSpeaker';
import type { AudioPlayer, TextToSpeech } from './speakers/ports';
import type { Speaker } from './types';

/**
 * Bundled audio first (instant, offline), then any extra speakers (e.g. server-generated speech
 * for free text), then the phone's built-in voice, so every alert is spoken whatever fails.
 */
export function buildSpeakerChain(
  assets: Record<string, number | string>,
  player: AudioPlayer,
  tts: TextToSpeech,
  extra: Speaker[] = [],
): Speaker {
  return new FallbackSpeaker([new BundledAudioSpeaker(assets, player), ...extra, new DeviceTtsSpeaker(tts)]);
}
