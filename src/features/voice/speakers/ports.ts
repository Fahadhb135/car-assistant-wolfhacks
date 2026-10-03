export type AudioSource =
  | { kind: 'asset'; ref: number | string }
  | { kind: 'bytes'; data: Uint8Array; mime: string };

/** Adapter over expo-av. Must reject or resolve promptly when `signal` aborts. */
export interface AudioPlayer {
  play(source: AudioSource, signal: AbortSignal): Promise<void>;
}

/** Adapter over expo-speech. */
export interface TextToSpeech {
  speak(text: string, signal: AbortSignal): Promise<void>;
}
