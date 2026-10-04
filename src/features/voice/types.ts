export type AlertKind =
  | 'crash'
  | 'speeding'
  | 'ran_stop'
  | 'hotspot_ahead'
  | 'stop_sign_ahead'
  | 'highway_entering'
  | 'highway_exiting'
  | 'traffic_light_ahead'
  | 'rolling_stop'
  | 'erratic_driving'
  | 'stop_ok'
  | 'chat_reply'
  | 'coaching_tip';

/** One sentence of a streamed reply: its text, plus server-made audio when available. */
export type Segment = { text: string; audio?: { data: Uint8Array; mime: string } | null };

/** A reply that is still arriving. Cancelling must abort the underlying request. */
export type SpokenStream = { segments: AsyncIterable<Segment>; cancel(): void };

export type Utterance = {
  /** For a streamed reply this is the fallback line, spoken if nothing arrives. */
  text: string;
  /** Set for fixed phrases that have bundled audio. Dynamic text leaves it unset. */
  phraseId?: string;
  /** Set for streamed chat replies; spoken sentence by sentence as they arrive. */
  stream?: SpokenStream;
};

export type Alert = {
  id: string;
  kind: AlertKind;
  /** Higher wins. crash > stop-sign > swerve > tips. */
  priority: number;
  utterance: Utterance;
  createdAt: number;
  /** Alert is dropped, not spoken late, once older than this. */
  ttlMs: number;
};

/** Plays one utterance. Must settle (resolve or reject) promptly when `signal` aborts. */
export interface Speaker {
  speak(utterance: Utterance, signal: AbortSignal): Promise<void>;
}

/** What the voice module needs from the Gemini Live session. */
export interface LiveControl {
  /** True while a Live session exists, including while paused for an alert. */
  isActive(): boolean;
  pause(): void;
  resume(): void;
  end(): void;
}

export class SpeakerUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SpeakerUnavailableError';
  }
}
