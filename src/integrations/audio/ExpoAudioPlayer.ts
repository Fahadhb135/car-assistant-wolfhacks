import type { AudioPlayer, AudioSource } from '../../features/voice/speakers/ports';

/** One playing sound. */
export interface PlayerHandle {
  play(): void;
  stop(): void;
  /** Called once when playback reaches the end. */
  onFinished(cb: () => void): void;
  /** Called if the platform reports a load or playback error. */
  onError(cb: (message: string) => void): void;
  /** Called once the sound has loaded and its length is known. */
  onLoaded(cb: (durationSec: number) => void): void;
  release(): void;
}

/** The platform bits, so the logic below is testable without a phone. Real one: expoBackends.ts. */
export interface AudioBackend {
  create(uri: string | number): PlayerHandle;
  /** Write fetched audio bytes to a cache file and return its uri. */
  writeCacheFile(data: Uint8Array, extension: string): string;
}

export type ExpoAudioPlayerOptions = {
  /** Give up if the sound has not loaded by then (a bad file may never report anything). */
  loadTimeoutMs?: number;
  /** Extra time allowed past the sound's own length before giving up. */
  finishGraceMs?: number;
};

const EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/aac': 'aac' };

export class AudioPlaybackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioPlaybackError';
  }
}

/**
 * Plays bundled assets or fetched bytes. Always settles: on finish, promptly on abort (how a
 * safety alert cuts off a lower-priority one), and with a rejection on a load/playback error or
 * a watchdog timeout, so the voice queue can never get stuck and the speaker chain can fall back
 * to the phone's own voice.
 */
export class ExpoAudioPlayer implements AudioPlayer {
  private readonly loadTimeoutMs: number;
  private readonly finishGraceMs: number;

  constructor(
    private backend: AudioBackend,
    opts: ExpoAudioPlayerOptions = {},
  ) {
    this.loadTimeoutMs = opts.loadTimeoutMs ?? 6_000;
    this.finishGraceMs = opts.finishGraceMs ?? 3_000;
  }

  async play(source: AudioSource, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    // async, so a platform error here becomes a rejection the fallback chain can handle
    const uri =
      source.kind === 'asset' ? source.ref : this.backend.writeCacheFile(source.data, EXT[source.mime] ?? 'mp3');
    const handle = this.backend.create(uri);

    await new Promise<void>((resolve, reject) => {
      let done = false;
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      const arm = (ms: number, why: string) => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => fail(why), ms);
      };
      const settle = (fn: () => void) => {
        if (done) return;
        done = true;
        if (watchdog) clearTimeout(watchdog);
        signal.removeEventListener('abort', onAbort);
        handle.release();
        fn();
      };
      const fail = (message: string) => {
        handle.stop();
        settle(() => reject(new AudioPlaybackError(message)));
      };
      const onAbort = () => {
        handle.stop();
        settle(resolve);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      handle.onFinished(() => settle(resolve));
      handle.onError((message) => fail(message));
      handle.onLoaded((durationSec) => arm(durationSec * 1000 + this.finishGraceMs, 'playback did not finish'));
      arm(this.loadTimeoutMs, 'sound did not load');
      handle.play();
    });
  }
}
