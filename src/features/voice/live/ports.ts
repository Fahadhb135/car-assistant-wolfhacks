/** Mic capture is PCM16 mono 16 kHz; Gemini audio output is PCM16 mono 24 kHz. */
export const INPUT_MIME = 'audio/pcm;rate=16000';
export const OUTPUT_SAMPLE_RATE = 24_000;

export type LiveHandlers = {
  onAudio(pcm: Uint8Array): void;
  onInputTranscript(text: string): void;
  onOutputTranscript(text: string): void;
  onInterrupted(): void;
  onTurnComplete(): void;
  /** Fires for any close, including ones we started. Sessions ignore the latter. */
  onClose(): void;
  onError(err: unknown): void;
};

export interface LiveConnection {
  sendAudio(pcm: Uint8Array): void;
  /** Flush buffered input when the mic stops (e.g. paused for an alert). */
  endAudioStream(): void;
  /** Add context to the conversation without asking the model to answer. */
  sendContext(text: string): void;
  close(): void;
}

export type ConnectOptions = {
  /** Short-lived token from the cloud service's /live-token. */
  token: string;
  model: string;
  systemInstruction: string;
};

export interface LiveTransport {
  connect(opts: ConnectOptions, handlers: LiveHandlers): Promise<LiveConnection>;
}

/** Adapter over the device mic and speaker (expo-av or a native audio-stream module). */
export interface AudioIO {
  startCapture(onChunk: (pcm: Uint8Array) => void): Promise<void>;
  stopCapture(): void;
  playChunk(pcm: Uint8Array): void;
  /** Drop queued model audio immediately (barge-in, alert, end). */
  clearPlayback(): void;
}
