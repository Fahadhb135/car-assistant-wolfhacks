import { SpeakerUnavailableError, type Speaker, type Utterance } from '../types';
import type { AudioPlayer, TextToSpeech } from './ports';

/**
 * Speaks a streamed reply one sentence at a time, starting with the first sentence while the
 * rest is still being written. Each sentence uses the server's audio when it came with one and the
 * phone's own voice when it didn't (or when playing the audio fails). Aborting (a safety alert, or
 * the driver pressing talk) cancels the underlying request, so nothing keeps downloading.
 */
export class StreamedReplySpeaker implements Speaker {
  constructor(
    private player: AudioPlayer,
    private tts: TextToSpeech,
  ) {}

  async speak(utterance: Utterance, signal: AbortSignal): Promise<void> {
    const stream = utterance.stream;
    if (!stream) throw new SpeakerUnavailableError('not a streamed reply');

    const onAbort = () => stream.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    const it = stream.segments[Symbol.asyncIterator]();
    let spoken = 0;
    let failure: unknown = null;
    try {
      // Manual iteration, so nothing more is pulled from the network once we have been aborted.
      for (;;) {
        if (signal.aborted) break;
        const next = await it.next();
        if (next.done || signal.aborted) break;
        const seg = next.value;
        try {
          if (seg.audio) await this.player.play({ kind: 'bytes', data: seg.audio.data, mime: seg.audio.mime }, signal);
          else await this.tts.speak(seg.text, signal);
          spoken++;
        } catch (err) {
          if (signal.aborted) break;
          if (seg.audio) {
            // the server's audio would not play: say this sentence with the phone's voice instead
            try {
              await this.tts.speak(seg.text, signal);
              spoken++;
            } catch {
              /* skip this sentence */
            }
          } else failure = err;
        }
      }
    } catch (err) {
      failure = err; // the stream broke mid-reply
    } finally {
      signal.removeEventListener('abort', onAbort);
      stream.cancel();
      void it.return?.(undefined)?.catch?.(() => {});
    }
    // A reply that broke after the first sentence just ends. One that never spoke anything throws,
    // so the chain falls back to the apology line.
    if (spoken === 0 && !signal.aborted && failure) throw failure;
  }
}
