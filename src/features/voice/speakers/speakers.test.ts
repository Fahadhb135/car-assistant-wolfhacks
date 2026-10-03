import { describe, expect, it, vi } from 'vitest';
import { BundledAudioSpeaker } from './BundledAudioSpeaker';
import { DeviceTtsSpeaker } from './DeviceTtsSpeaker';
import { FallbackSpeaker } from './FallbackSpeaker';
import type { AudioPlayer } from './ports';

const sig = () => new AbortController().signal;
const player = (): AudioPlayer & { played: unknown[] } => {
  const played: unknown[] = [];
  return { played, play: async (s) => void played.push(s) };
};

describe('speaker chain', () => {
  it('uses bundled audio for fixed phrases', async () => {
    const p = player();
    await new BundledAudioSpeaker({ stop_ok: 7 }, p).speak({ text: 'Nice stop.', phraseId: 'stop_ok' }, sig());
    expect(p.played).toEqual([{ kind: 'asset', ref: 7 }]);
  });

  it('falls through bundled -> a failing speaker -> device TTS', async () => {
    const p = player();
    const spoken: string[] = [];
    const chain = new FallbackSpeaker([
      new BundledAudioSpeaker({}, p),
      { speak: async () => { throw new Error('remote speech down'); } },
      new DeviceTtsSpeaker({ speak: async (t) => void spoken.push(t) }),
    ]);
    await chain.speak({ text: 'Hello' }, sig());
    expect(spoken).toEqual(['Hello']);
    expect(p.played).toEqual([]);
  });

  it('does not fall back to the next speaker after an abort', async () => {
    const ctrl = new AbortController();
    const second = vi.fn();
    const chain = new FallbackSpeaker([
      { speak: async () => { ctrl.abort(); throw new Error('aborted'); } },
      { speak: second },
    ]);
    await chain.speak({ text: 'x' }, ctrl.signal);
    expect(second).not.toHaveBeenCalled();
  });

  it('throws when every speaker fails', async () => {
    const chain = new FallbackSpeaker([{ speak: async () => { throw new Error('a'); } }]);
    await expect(chain.speak({ text: 'x' }, sig())).rejects.toThrow('a');
  });
});
