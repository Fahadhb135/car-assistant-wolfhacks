import { describe, expect, it, vi } from 'vitest';
import type { ReplyPacket } from '../../integrations/backend/replyStream';
import { CoachChat } from './chat/CoachChat';
import { PHRASES, REPLY_FALLBACK_TEXT } from './phrases';
import { PushToTalk, type PttState, type SpeechRecognizer } from './ptt/PushToTalk';
import { buildSpeakerChain } from './speakerChain';
import { StreamedReplySpeaker } from './speakers/StreamedReplySpeaker';
import type { AudioPlayer, AudioSource, TextToSpeech } from './speakers/ports';
import { FakeLive, ev, flush } from './testing';
import type { Segment, SpokenStream } from './types';
import { VoiceCoordinator } from './VoiceCoordinator';

const seg = (text: string, audio = true): Segment => ({ text, audio: audio ? { data: new Uint8Array([text.length]), mime: 'audio/mpeg' } : null });

function streamOf(segments: Segment[], opts: { throwAfter?: number } = {}) {
  const state = { cancelled: 0, pulled: 0 };
  const stream: SpokenStream = {
    segments: (async function* () {
      for (let i = 0; i < segments.length; i++) {
        if (opts.throwAfter === i) throw new Error('stream broke');
        state.pulled++;
        yield segments[i]!;
      }
      if (opts.throwAfter === segments.length) throw new Error('stream broke');
    })(),
    cancel: () => void state.cancelled++,
  };
  return { stream, state };
}

function fakes() {
  const played: string[] = [];
  const spoken: string[] = [];
  let failPlay = false;
  const player: AudioPlayer = {
    play: async (s: AudioSource) => {
      if (failPlay) throw new Error('decode failed');
      played.push(s.kind === 'bytes' ? `bytes:${s.data[0]}` : 'asset');
    },
  };
  const tts: TextToSpeech = { speak: async (t) => void spoken.push(t) };
  return { player, tts, played, spoken, failPlay: (v: boolean) => (failPlay = v) };
}

const sig = () => new AbortController();

describe('StreamedReplySpeaker', () => {
  it('speaks each sentence in order: server audio when present, phone voice when not', async () => {
    const f = fakes();
    const { stream, state } = streamOf([seg('First sentence.'), seg('Second one.', false), seg('Third.')]);
    await new StreamedReplySpeaker(f.player, f.tts).speak({ text: REPLY_FALLBACK_TEXT, stream }, sig().signal);
    expect(f.played).toEqual(['bytes:15', 'bytes:6']);
    expect(f.spoken).toEqual(['Second one.']);
    expect(state.cancelled).toBe(1); // always released at the end
  });

  it("declines utterances that aren't streamed replies", async () => {
    const f = fakes();
    await expect(new StreamedReplySpeaker(f.player, f.tts).speak({ text: 'x' }, sig().signal)).rejects.toThrow('not a streamed reply');
  });

  it("falls back to the phone's voice when the server audio will not play", async () => {
    const f = fakes();
    f.failPlay(true);
    const { stream } = streamOf([seg('Say this anyway.')]);
    await new StreamedReplySpeaker(f.player, f.tts).speak({ text: 'x', stream }, sig().signal);
    expect(f.spoken).toEqual(['Say this anyway.']);
  });

  it('abort cancels the stream and stops after the current sentence', async () => {
    const f = fakes();
    const c = sig();
    const { stream, state } = streamOf([seg('One.'), seg('Two.'), seg('Three.')]);
    f.player.play = async () => { c.abort(); }; // a safety alert arrives while sentence one is playing
    await new StreamedReplySpeaker(f.player, f.tts).speak({ text: 'x', stream }, c.signal);
    expect(state.cancelled).toBeGreaterThanOrEqual(1);
    expect(state.pulled).toBe(1); // sentences two and three were never even fetched
  });

  it('a stream that breaks after the first sentence just ends; one that never spoke throws', async () => {
    const f = fakes();
    const partial = streamOf([seg('Only one.')], { throwAfter: 1 });
    await expect(new StreamedReplySpeaker(f.player, f.tts).speak({ text: 'x', stream: partial.stream }, sig().signal)).resolves.toBeUndefined();
    expect(f.played).toHaveLength(1);
    const dead = streamOf([seg('never')], { throwAfter: 0 });
    await expect(new StreamedReplySpeaker(f.player, f.tts).speak({ text: 'x', stream: dead.stream }, sig().signal)).rejects.toThrow('stream broke');
  });
});

function voiceWith(f: ReturnType<typeof fakes>, extra: { onAlertStart?: (a: unknown) => void } = {}) {
  const speaker = buildSpeakerChain({ crash_check: 1, stop_ok: 2 }, f.player, f.tts);
  return new VoiceCoordinator({ speaker, live: new FakeLive(), now: () => 0, onAlertStart: extra.onAlertStart });
}

describe('streamed replies in the voice queue', () => {
  it('speaks a streamed reply sentence by sentence', async () => {
    const f = fakes();
    const voice = voiceWith(f);
    voice.speakReplyStream('c1', streamOf([seg('Nice stop there.'), seg('Keep it up.')]).stream);
    await flush();
    expect(f.played).toEqual(['bytes:16', 'bytes:11']);
  });

  it('a crash alert cuts off a streaming reply and cancels the request', async () => {
    const f = fakes();
    const voice = voiceWith(f);
    let release!: () => void;
    f.player.play = (s) => (s.kind === 'bytes' ? new Promise<void>((r) => (release = r)) : Promise.resolve());
    const { stream, state } = streamOf([seg('A long reply.'), seg('More.'), seg('Even more.')]);
    voice.speakReplyStream('c1', stream);
    await flush();
    voice.handleEvent(ev({ kind: 'crash', severity: 'critical', confirmed: false }, 0));
    await flush();
    release?.();
    await flush();
    expect(state.cancelled).toBeGreaterThanOrEqual(1);
    expect(state.pulled).toBe(1);
  });

  it('interruptChat stops the playing reply and drops any waiting one, but not safety alerts', async () => {
    const f = fakes();
    const voice = voiceWith(f);
    let release!: () => void;
    f.player.play = (s) => (s.kind === 'bytes' ? new Promise<void>((r) => (release = r)) : Promise.resolve());
    const first = streamOf([seg('Playing now.'), seg('Never heard.')]);
    const second = streamOf([seg('Waiting reply.')]);
    voice.speakReplyStream('c1', first.stream);
    await flush();
    voice.speakReplyStream('c2', second.stream);
    voice.interruptChat();
    await flush();
    release?.();
    await flush();
    expect(first.state.cancelled).toBeGreaterThanOrEqual(1);
    expect(second.state.pulled).toBe(0); // the waiting reply was removed from the queue
  });

  it('reports alert starts (so push-to-talk can stop listening for a safety alert)', async () => {
    const f = fakes();
    const seen: string[] = [];
    const voice = voiceWith(f, { onAlertStart: (a) => seen.push((a as { kind: string }).kind) });
    voice.handleEvent(ev({ kind: 'stop_ok', severity: 'info' }, 0));
    await flush();
    expect(seen).toEqual(['stop_ok']);
    expect(PHRASES.stop_ok).toBeTruthy();
  });
});

const ndjson = (packets: unknown[]) =>
  new TextEncoder().encode(packets.map((p) => JSON.stringify(p) + '\n').join(''));
const okFetch = (packets: unknown[], capture?: { body?: string }) =>
  (async (_u: string, init: RequestInit) => {
    if (capture) capture.body = init.body as string;
    const data = ndjson(packets);
    return new Response(new ReadableStream({ start(c) { c.enqueue(data); c.close(); } }), { status: 200 });
  }) as unknown as typeof fetch;

describe('CoachChat.askStream', () => {
  const sentence = (i: number, text: string): ReplyPacket & object => ({ type: 'sentence', i, text, audio: null, mime: 'audio/mpeg', ms: 1 }) as never;

  it('hands the voice a stream that starts with the first sentence, and sends trip context', async () => {
    const speakReply = vi.fn();
    let captured: SpokenStream | null = null;
    const capture: { body?: string } = {};
    const chat = new CoachChat({
      baseUrl: 'http://x',
      voice: { speakReply, speakReplyStream: (_id, s) => void (captured = s) },
      streamFetchImpl: okFetch([sentence(0, 'First sentence.'), sentence(1, 'Second sentence.'), { type: 'done', ms: 2 }], capture),
      getContext: () => ({ smoothness: 80, speedKmh: 40 }),
      getRecentEvents: () => [{ eventId: 'e', t: 0, kind: 'rolling_stop', severity: 'warn' }],
    });
    await chat.askStream('how was that?');
    expect(speakReply).not.toHaveBeenCalled();
    const body = JSON.parse(capture.body!);
    expect(body).toMatchObject({ message: 'how was that?', smoothness: 80, speedKmh: 40 });
    expect(body.recentEvents[0]).toContain('rolled through');
    const texts: string[] = [];
    for await (const s of captured!.segments) texts.push(s.text);
    expect(texts).toEqual(['First sentence.', 'Second sentence.']);
  });

  it('speaks the apology (never silence) when the server is unreachable or sends nothing', async () => {
    const speakReply = vi.fn();
    const speakReplyStream = vi.fn();
    const down = new CoachChat({ baseUrl: 'http://x', voice: { speakReply, speakReplyStream }, streamFetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    await down.askStream('hi');
    const empty = new CoachChat({ baseUrl: 'http://x', voice: { speakReply, speakReplyStream }, streamFetchImpl: okFetch([{ type: 'done', ms: 1 }]) });
    await empty.askStream('hi');
    expect(speakReply).toHaveBeenCalledTimes(2);
    expect(speakReply.mock.calls[0]![1]).toBe(REPLY_FALLBACK_TEXT);
    expect(speakReplyStream).not.toHaveBeenCalled();
  });
});

class FakeRecognizer implements SpeechRecognizer {
  available = true;
  transcript = 'why was that a rolling stop';
  log: string[] = [];
  failStart = false;
  start = async () => { this.log.push('start'); if (this.failStart) throw new Error('mic denied'); };
  stop = async () => { this.log.push('stop'); return this.transcript; };
  cancel = () => void this.log.push('cancel');
}

function ptt(over: Partial<FakeRecognizer> = {}) {
  const recognizer = Object.assign(new FakeRecognizer(), over);
  const asked: string[] = [];
  const states: PttState[] = [];
  let interrupts = 0;
  let pendingCancels = 0;
  let resolveAsk: (() => void) | null = null;
  const machine = new PushToTalk({
    recognizer,
    chat: {
      askStream: (t) => new Promise<void>((r) => { asked.push(t); resolveAsk = r; }),
      cancelPending: () => void pendingCancels++,
    },
    voice: { interruptChat: () => void interrupts++ },
    onState: (s) => states.push(s),
  });
  return { machine, recognizer, asked, states, interrupts: () => interrupts, pendingCancels: () => pendingCancels, finishAsk: () => resolveAsk?.() };
}

describe('PushToTalk', () => {
  it('hold, release, think, then idle; pressing silences any reply first', async () => {
    const p = ptt();
    await p.machine.pressIn();
    expect(p.interrupts()).toBe(1);
    expect(p.machine.state).toBe('listening');
    const out = p.machine.pressOut();
    await flush();
    expect(p.asked).toEqual(['why was that a rolling stop']);
    expect(p.machine.state).toBe('thinking');
    p.finishAsk();
    await out;
    expect(p.states).toEqual(['listening', 'thinking', 'idle']);
  });

  it('does nothing when no recognizer is available, but tap-to-ask still works', async () => {
    const p = ptt({ available: false });
    await p.machine.pressIn();
    expect(p.machine.state).toBe('idle');
    const q = p.machine.askQuick('How was that turn?');
    await flush();
    expect(p.asked).toEqual(['How was that turn?']);
    p.finishAsk();
    await q;
    expect(p.machine.state).toBe('idle');
  });

  it('an empty transcript asks nothing', async () => {
    const p = ptt({ transcript: '   ' });
    await p.machine.pressIn();
    await p.machine.pressOut();
    expect(p.asked).toEqual([]);
    expect(p.machine.state).toBe('idle');
  });

  it('a mic failure shows an error briefly, then recovers', async () => {
    vi.useFakeTimers();
    const p = ptt({ failStart: true });
    await p.machine.pressIn();
    expect(p.machine.state).toBe('error');
    vi.advanceTimersByTime(2000);
    expect(p.machine.state).toBe('idle');
    vi.useRealTimers();
  });

  it('a safety alert cancels listening', async () => {
    const p = ptt();
    await p.machine.pressIn();
    p.machine.cancel();
    expect(p.recognizer.log).toContain('cancel');
    expect(p.machine.state).toBe('idle');
    await p.machine.pressOut(); // the late release is ignored
    expect(p.asked).toEqual([]);
  });

  it('a stale reply from an earlier question cannot reset the button of a newer one', async () => {
    const p = ptt();
    const first = p.machine.askQuick('first question');
    await flush();
    const finishFirst = p.finishAsk;
    await p.machine.pressIn(); // the driver presses again while the first reply is still being fetched
    expect(p.machine.state).toBe('listening');
    finishFirst();
    await first;
    expect(p.machine.state).toBe('listening'); // not clobbered back to idle
  });
});


describe('review fixes: nothing from an old question is spoken later', () => {
  it('pressing talk, a safety-alert cancel and a new tap all drop the question still loading', async () => {
    const p = ptt();
    void p.machine.askQuick('How was that?');
    await flush();
    const before = p.pendingCancels();
    await p.machine.pressIn();
    expect(p.pendingCancels()).toBe(before + 1);
    p.machine.cancel();
    expect(p.pendingCancels()).toBe(before + 2);
    void p.machine.askQuick('What should I work on?');
    expect(p.pendingCancels()).toBe(before + 3);
  });

  it('CoachChat: a question cancelled while waiting for its first sentence says nothing at all', async () => {
    const speakReply = vi.fn();
    const speakReplyStream = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = (async (_u: string, init: RequestInit) => {
      await gate;
      if ((init.signal as AbortSignal).aborted) throw new Error('aborted');
      return new Response(new ReadableStream({ start(c) { c.enqueue(ndjson([{ type: 'sentence', i: 0, text: 'Too late now.', audio: null, ms: 1 }])); c.close(); } }));
    }) as unknown as typeof fetch;
    const chat = new CoachChat({ baseUrl: 'http://x', voice: { speakReply, speakReplyStream }, streamFetchImpl: slow });
    const asking = chat.askStream('how was that?');
    await flush();
    chat.cancelPending();
    release();
    await asking;
    expect(speakReplyStream).not.toHaveBeenCalled();
    expect(speakReply).not.toHaveBeenCalled(); // no apology either: the driver moved on
  });

  it('CoachChat: a newer question replaces an older one that has not answered yet', async () => {
    const speakReplyStream = vi.fn();
    const gates: (() => void)[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      await new Promise<void>((r) => gates.push(r));
      if ((init.signal as AbortSignal).aborted) throw new Error('aborted');
      return new Response(new ReadableStream({ start(c) { c.enqueue(ndjson([{ type: 'sentence', i: 0, text: 'An answer here.', audio: null, ms: 1 }])); c.close(); } }));
    }) as unknown as typeof fetch;
    const chat = new CoachChat({ baseUrl: 'http://x', voice: { speakReply: vi.fn(), speakReplyStream }, streamFetchImpl: fetchImpl });
    const first = chat.askStream('first');
    await flush();
    const second = chat.askStream('second');
    await flush();
    gates.forEach((g) => g());
    await Promise.all([first, second]);
    expect(speakReplyStream).toHaveBeenCalledTimes(1); // only the newer question is answered
  });

  it('AlertQueue: dropping or expiring a queued streamed reply cancels its download', async () => {
    const { AlertQueue } = await import('./AlertQueue');
    const { chatReplyStreamAlert } = await import('./phrases');
    const q = new AlertQueue();
    const a = streamOf([seg('one')]);
    const b = streamOf([seg('two')]);
    q.enqueue(chatReplyStreamAlert('a', a.stream, 0), 0);
    q.removeKind('chat_reply');
    expect(a.state.cancelled).toBe(1);
    q.enqueue(chatReplyStreamAlert('b', b.stream, 0), 0);
    q.next(60_000, { allowTips: true }); // long past its 15 s TTL
    expect(b.state.cancelled).toBe(1);
  });
});
