export type AlertKind =
  | 'crash'
  | 'ran_stop'
  | 'stop_sign_ahead'
  | 'rolling_stop'
  | 'erratic_driving'
  | 'stop_ok'
  | 'coaching_tip';

export type Utterance = {
  text: string;
  /** Set for fixed phrases that have bundled audio. Dynamic text leaves it unset. */
  phraseId?: string;
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
