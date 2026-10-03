// Thin glue over Expo's audio, speech and file modules. Deliberately logic-free: everything
// testable lives in ExpoAudioPlayer / ExpoSpeechTts. Needs a native rebuild when first added.
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';

import type { AudioBackend } from './ExpoAudioPlayer';
import type { SpeechBackend } from './ExpoSpeechTts';

let counter = 0;

export const expoAudioBackend: AudioBackend = {
  create(uri) {
    const player = createAudioPlayer(uri);
    return {
      play: () => player.play(),
      stop: () => player.pause(),
      onFinished: (cb) => {
        player.addListener('playbackStatusUpdate', (status) => {
          if (status.didJustFinish) cb();
        });
      },
      onError: (cb) => {
        player.addListener('playbackStatusUpdate', (status) => {
          if (status.error) cb(status.error);
        });
      },
      onLoaded: (cb) => {
        let reported = false;
        player.addListener('playbackStatusUpdate', (status) => {
          if (!reported && status.isLoaded && status.duration > 0) {
            reported = true;
            cb(status.duration);
          }
        });
      },
      release: () => player.remove(),
    };
  },
  writeCacheFile(data, extension) {
    const file = new File(Paths.cache, `voice-${Date.now()}-${++counter}.${extension}`);
    file.create({ overwrite: true });
    file.write(data);
    return file.uri;
  },
};

export const expoSpeechBackend: SpeechBackend = {
  speak: (text, cb) => Speech.speak(text, { language: 'en-US', ...cb }),
  stop: () => void Speech.stop(),
};

/** Alerts must be heard over music/navigation, so duck other audio instead of stopping it. */
export function configureAlertAudioSession(): Promise<void> {
  return setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', shouldPlayInBackground: false });
}
