import type { DriveEvent } from '../../../core/events/types';
import type { LiveControl } from '../types';
import { buildSystemInstruction, contextTurn, type TripContext } from './prompt';
import type { AudioIO, LiveConnection, LiveTransport } from './ports';

export type TranscriptTurn = { t: number; role: 'driver' | 'assistant'; text: string };

export type LiveSessionDeps = {
  transport: LiveTransport;
  audio: AudioIO;
  /** Calls the cloud service's POST /live-token. */
  getToken: () => Promise<string>;
  model: string;
  getContext?: () => TripContext;
  getRecentEvents?: () => DriveEvent[];
  now?: () => number;
  /** The session ended without us asking (network drop, server close, failed start). */
  onEnded?: () => void;
  onError?: (err: unknown) => void;
};

type State = 'idle' | 'connecting' | 'active' | 'paused';

/**
 * One hands-free Gemini Live conversation. Implements LiveControl so the voice
 * coordinator can pause it for alerts and end it on a crash. Read-only: the model
 * never gets tools and never triggers alerts.
 */
export class GeminiLiveSession implements LiveControl {
  private state: State = 'idle';
  private conn: LiveConnection | null = null;
  private pendingContext: string[] = [];
  private transcript: TranscriptTurn[] = [];
  private buffer: { role: TranscriptTurn['role']; text: string; t: number } | null = null;
  private generation = 0;
  private readonly now: () => number;

  constructor(private deps: LiveSessionDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** True from start() until end(), including while paused, so tips don't talk over it. */
  isActive(): boolean {
    return this.state !== 'idle';
  }

  getTranscript(): TranscriptTurn[] {
    this.flushBuffer();
    return [...this.transcript];
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.state = 'connecting';
    const gen = ++this.generation;
    try {
      const token = await this.deps.getToken();
      const systemInstruction = buildSystemInstruction(
        this.deps.getContext?.() ?? {},
        this.deps.getRecentEvents?.() ?? [],
      );
      const conn = await this.deps.transport.connect(
        { token, model: this.deps.model, systemInstruction },
        this.handlers(gen),
      );
      if (this.generation !== gen) {
        conn.close(); // end() was called while connecting
        return;
      }
      this.conn = conn;
      this.state = 'active';
      await this.deps.audio.startCapture((pcm) => {
        if (this.state === 'active') this.conn?.sendAudio(pcm);
      });
    } catch (err) {
      if (this.generation !== gen) return;
      this.deps.onError?.(err);
      this.teardown();
      this.deps.onEnded?.();
    }
  }

  pause(): void {
    if (this.state !== 'active') return;
    this.state = 'paused';
    this.deps.audio.stopCapture();
    this.deps.audio.clearPlayback();
    this.conn?.endAudioStream();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'active';
    for (const text of this.pendingContext.splice(0)) this.conn?.sendContext(text);
    void this.deps.audio
      .startCapture((pcm) => {
        if (this.state === 'active') this.conn?.sendAudio(pcm);
      })
      .catch((err) => this.deps.onError?.(err));
  }

  end(): void {
    if (this.state === 'idle') return;
    this.teardown();
  }

  /** Keep the model's picture of the trip current. Queued while paused. */
  noteEvent(event: DriveEvent): void {
    if (this.state === 'idle') return;
    const text = contextTurn(event);
    if (this.state === 'active') this.conn?.sendContext(text);
    else this.pendingContext.push(text);
  }

  private teardown(): void {
    this.generation++;
    this.flushBuffer();
    this.state = 'idle';
    this.pendingContext = [];
    this.deps.audio.stopCapture();
    this.deps.audio.clearPlayback();
    const conn = this.conn;
    this.conn = null;
    conn?.close();
  }

  private handlers(gen: number) {
    const live = () => this.generation === gen;
    return {
      onAudio: (pcm: Uint8Array) => {
        if (live() && this.state === 'active') this.deps.audio.playChunk(pcm);
      },
      onInputTranscript: (text: string) => live() && this.addText('driver', text),
      onOutputTranscript: (text: string) => live() && this.addText('assistant', text),
      onInterrupted: () => live() && this.deps.audio.clearPlayback(),
      onTurnComplete: () => live() && this.flushBuffer(),
      onClose: () => {
        if (!live() || this.state === 'idle') return;
        this.teardown();
        this.deps.onEnded?.();
      },
      onError: (err: unknown) => live() && this.deps.onError?.(err),
    };
  }

  private addText(role: TranscriptTurn['role'], text: string): void {
    if (this.buffer && this.buffer.role !== role) this.flushBuffer();
    if (!this.buffer) this.buffer = { role, text: '', t: this.now() };
    this.buffer.text += text;
  }

  private flushBuffer(): void {
    if (this.buffer && this.buffer.text.trim()) {
      this.transcript.push({ t: this.buffer.t, role: this.buffer.role, text: this.buffer.text.trim() });
    }
    this.buffer = null;
  }
}
