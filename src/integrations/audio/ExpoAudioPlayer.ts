import type { AudioPlayer, AudioSource } from '../../features/voice/speakers/ports';

/** One playing sound. */
export interface PlayerHandle {
  play(): void;
  stop(): void;
  /** Called once when playback reaches the end. */
  onFinished(cb: () => void): void;
  release(): void;
}

/** The platform bits, so the logic below is testable without a phone. Real one: expoBackends.ts. */
export interface AudioBackend {
  create(uri: string | number): PlayerHandle;
  /** Write fetched audio bytes to a cache file and return its uri. */
  writeCacheFile(data: Uint8Array, extension: string): string;
}

const EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/aac': 'aac' };

/**
 * Plays bundled assets or fetched bytes. Settles when playback finishes, and promptly (and
 * cleanly) when `signal` aborts, which is how a safety alert cuts off a lower-priority one.
 */
export class ExpoAudioPlayer implements AudioPlayer {
  constructor(private backend: AudioBackend) {}

  async play(source: AudioSource, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    // async, so a platform error here becomes a rejection the fallback chain can handle
    const uri =
      source.kind === 'asset' ? source.ref : this.backend.writeCacheFile(source.data, EXT[source.mime] ?? 'mp3');
    const handle = this.backend.create(uri);

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        signal.removeEventListener('abort', onAbort);
        handle.release();
        resolve();
      };
      const onAbort = () => {
        handle.stop();
        finish();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      handle.onFinished(finish);
      handle.play();
    });
  }
}
