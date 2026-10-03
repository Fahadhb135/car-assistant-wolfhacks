/** On-device speech to text. Real adapter (e.g. expo-speech-recognition) lives outside this module. */
export interface SpeechRecognizer {
  /** False when the platform has no recognizer, in which case only tap-to-ask works. */
  readonly available: boolean;
  start(): Promise<void>;
  /** Stop listening and return the final transcript ('' if nothing was heard). */
  stop(): Promise<string>;
  cancel(): void;
}

export type PttState = 'idle' | 'listening' | 'thinking' | 'error';

export type PushToTalkDeps = {
  recognizer: SpeechRecognizer;
  chat: { askStream(message: string): Promise<void> };
  voice: { interruptChat(): void };
  onState?: (state: PttState) => void;
};

/**
 * Hold-to-talk (and tap-to-ask) for the coach chat. Pressing silences any reply that is still
 * playing, so the microphone never hears the speaker. A safety alert cancels listening.
 */
export class PushToTalk {
  private _state: PttState = 'idle';
  /** Bumped on every press/cancel so a slow recognizer or reply from an old press cannot act late. */
  private turn = 0;

  constructor(private deps: PushToTalkDeps) {}

  get state(): PttState {
    return this._state;
  }

  get canListen(): boolean {
    return this.deps.recognizer.available;
  }

  async pressIn(): Promise<void> {
    if (!this.deps.recognizer.available || this._state === 'listening') return;
    const turn = ++this.turn;
    this.deps.voice.interruptChat();
    this.set('listening');
    try {
      await this.deps.recognizer.start();
    } catch {
      if (turn === this.turn) this.fail();
    }
  }

  async pressOut(): Promise<void> {
    if (this._state !== 'listening') return;
    const turn = this.turn;
    let text = '';
    try {
      text = (await this.deps.recognizer.stop()).trim();
    } catch {
      if (turn === this.turn) this.fail();
      return;
    }
    if (turn !== this.turn) return; // cancelled while stopping
    if (!text) return this.set('idle');
    await this.ask(text, turn);
  }

  /** Tap a quick-question chip: no microphone needed. */
  async askQuick(text: string): Promise<void> {
    const turn = ++this.turn;
    this.deps.voice.interruptChat();
    await this.ask(text, turn);
  }

  /** E.g. a safety alert started: stop listening; the driver can ask again afterwards. */
  cancel(): void {
    this.turn++;
    if (this._state === 'listening') this.deps.recognizer.cancel();
    this.set('idle');
  }

  private async ask(text: string, turn: number): Promise<void> {
    this.set('thinking');
    try {
      await this.deps.chat.askStream(text);
    } catch {
      /* askStream speaks its own apology; never leave the button stuck */
    }
    if (turn === this.turn) this.set('idle');
  }

  private fail(): void {
    this.set('error');
    setTimeout(() => this._state === 'error' && this.set('idle'), 1500);
  }

  private set(state: PttState): void {
    if (this._state === state) return;
    this._state = state;
    this.deps.onState?.(state);
  }
}
