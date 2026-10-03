import { describe, expect, it } from 'vitest';
import { PHRASES } from '../../features/voice/phrases';
import { buildSpeakerChain } from '../../features/voice/speakerChain';
import { VoiceCoordinator } from '../../features/voice/VoiceCoordinator';
import { ev, flush } from '../../features/voice/testing';
import { ExpoAudioPlayer, type AudioBackend, type PlayerHandle } from './ExpoAudioPlayer';
import { ExpoSpeechTts, type SpeechBackend, type SpeechCallbacks } from './ExpoSpeechTts';

class FakeHandle implements PlayerHandle {
  log: string[] = [];
  private cb: (() => void) | null = null;
  play = () => void this.log.push('play');
  stop = () => void this.log.push('stop');
  release = () => void this.log.push('release');
  onFinished = (cb: () => void) => void (this.cb = cb);
  finish = () => this.cb?.();
}

function fakeBackend() {
  const handles: FakeHandle[] = [];
  const created: (string | number)[] = [];
  const files: { data: Uint8Array; ext: string }[] = [];
  const backend: AudioBackend = {
    create(uri) { created.push(uri); const h = new FakeHandle(); handles.push(h); return h; },
    writeCacheFile(data, ext) { files.push({ data, ext }); return `file:///cache/x.${ext}`; },
  };
  return { backend, handles, created, files };
}

const sig = () => new AbortController();

describe('ExpoAudioPlayer', () => {
  it('plays a bundled asset and settles when it finishes, releasing the player once', async () => {
    const f = fakeBackend();
    const p = new ExpoAudioPlayer(f.backend).play({ kind: 'asset', ref: 7 }, sig().signal);
    expect(f.created).toEqual([7]);
    expect(f.handles[0]!.log).toEqual(['play']);
    f.handles[0]!.finish();
    f.handles[0]!.finish(); // a duplicate status event must not double-release
    await p;
    expect(f.handles[0]!.log).toEqual(['play', 'release']);
  });

  it('writes fetched bytes to a cache file with the right extension and plays that', async () => {
    const f = fakeBackend();
    const p = new ExpoAudioPlayer(f.backend).play({ kind: 'bytes', data: new Uint8Array([1, 2]), mime: 'audio/mpeg' }, sig().signal);
    expect(f.files).toEqual([{ data: new Uint8Array([1, 2]), ext: 'mp3' }]);
    expect(f.created).toEqual(['file:///cache/x.mp3']);
    f.handles[0]!.finish();
    await p;
  });

  it('abort stops the sound, releases it and settles immediately', async () => {
    const f = fakeBackend();
    const c = sig();
    const p = new ExpoAudioPlayer(f.backend).play({ kind: 'asset', ref: 1 }, c.signal);
    c.abort();
    await p;
    expect(f.handles[0]!.log).toEqual(['play', 'stop', 'release']);
    f.handles[0]!.finish(); // late finish event after abort is ignored
    expect(f.handles[0]!.log).toEqual(['play', 'stop', 'release']);
  });

  it('does nothing when already aborted', async () => {
    const f = fakeBackend();
    const c = sig();
    c.abort();
    await new ExpoAudioPlayer(f.backend).play({ kind: 'asset', ref: 1 }, c.signal);
    expect(f.created).toEqual([]);
  });

  it('rejects when the platform cannot create a player, so the next speaker is tried', async () => {
    const backend: AudioBackend = { create() { throw new Error('no audio'); }, writeCacheFile: () => 'x' };
    await expect(new ExpoAudioPlayer(backend).play({ kind: 'asset', ref: 1 }, sig().signal)).rejects.toThrow('no audio');
  });
});

class FakeSpeech implements SpeechBackend {
  spoken: string[] = [];
  stops = 0;
  cb: SpeechCallbacks | null = null;
  speak = (text: string, cb: SpeechCallbacks) => { this.spoken.push(text); this.cb = cb; };
  stop = () => void this.stops++;
}

describe('ExpoSpeechTts', () => {
  it('speaks and settles on done; abort stops speech', async () => {
    const s = new FakeSpeech();
    const p = new ExpoSpeechTts(s).speak('hello', sig().signal);
    s.cb!.onDone();
    await p;
    const c = sig();
    const s2 = new FakeSpeech();
    const p2 = new ExpoSpeechTts(s2).speak('x', c.signal);
    c.abort();
    await p2;
    expect(s2.stops).toBe(1);
  });

  it('rejects on a speech error', async () => {
    const s = new FakeSpeech();
    const p = new ExpoSpeechTts(s).speak('x', sig().signal);
    s.cb!.onError(new Error('tts down'));
    await expect(p).rejects.toThrow('tts down');
  });
});

describe('speaker chain on the phone', () => {
  it('plays the bundled clip for a fixed phrase; falls back to the phone voice when it is missing or fails', async () => {
    const f = fakeBackend();
    const speech = new FakeSpeech();
    const chain = buildSpeakerChain({ stop_ok: 3 }, new ExpoAudioPlayer(f.backend), new ExpoSpeechTts(speech));
    const a = chain.speak({ text: 'Nice stop.', phraseId: 'stop_ok' }, sig().signal);
    await flush(); // the streamed-reply speaker declines first, then the bundled clip starts
    f.handles[0]!.finish();
    await a;
    expect(speech.spoken).toEqual([]); // bundled audio was enough

    const b = chain.speak({ text: 'A brand new sentence.' }, sig().signal); // no phrase id -> phone voice
    await flush(); // the bundled speaker declines first, then the phone voice starts
    speech.cb!.onDone();
    await b;
    expect(speech.spoken).toEqual(['A brand new sentence.']);
  });

  it('a safety alert cuts off the clip that is playing, end to end', async () => {
    const f = fakeBackend();
    const assets = { erratic_driving: 1, crash_check: 2 };
    const chain = buildSpeakerChain(assets, new ExpoAudioPlayer(f.backend), new ExpoSpeechTts(new FakeSpeech()));
    const voice = new VoiceCoordinator({ speaker: chain, live: { isActive: () => false, pause() {}, resume() {}, end() {} }, now: () => 0 });
    voice.handleEvent(ev({ kind: 'erratic_driving', severity: 'warn', score: 1 }, 0));
    await flush();
    expect(f.created).toEqual([1]);
    voice.handleEvent(ev({ kind: 'crash', severity: 'critical', confirmed: false }, 0));
    await flush();
    expect(f.handles[0]!.log).toEqual(['play', 'stop', 'release']); // erratic clip cut off
    expect(f.created).toEqual([1, 2]); // crash clip started
    expect(PHRASES.crash_check).toBeTruthy();
  });
});
