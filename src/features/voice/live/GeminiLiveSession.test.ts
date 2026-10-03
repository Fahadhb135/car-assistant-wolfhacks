import { describe, expect, it } from 'vitest';
import type { DriveEvent } from '../../../core/events/types';
import { flush } from '../testing';
import { GeminiLiveSession } from './GeminiLiveSession';
import { dispatchServerMessage, fromBase64, toBase64 } from './GeminiSdkTransport';
import type { AudioIO, ConnectOptions, LiveConnection, LiveHandlers, LiveTransport } from './ports';
import { buildSystemInstruction } from './prompt';

class FakeConn implements LiveConnection {
  log: string[] = [];
  sendAudio = (p: Uint8Array) => void this.log.push(`audio:${p.length}`);
  endAudioStream = () => void this.log.push('endStream');
  sendContext = (t: string) => void this.log.push(`ctx:${t}`);
  close = () => void this.log.push('close');
}

function setup(opts: { token?: () => Promise<string> } = {}) {
  const conn = new FakeConn();
  let handlers!: LiveHandlers;
  let connectOpts!: ConnectOptions;
  const transport: LiveTransport = {
    connect: async (o, h) => ((connectOpts = o), (handlers = h), conn),
  };
  const audioLog: string[] = [];
  let capture: ((p: Uint8Array) => void) | null = null;
  const audio: AudioIO = {
    startCapture: async (cb) => ((capture = cb), void audioLog.push('start')),
    stopCapture: () => void audioLog.push('stop'),
    playChunk: (p) => void audioLog.push(`play:${p.length}`),
    clearPlayback: () => void audioLog.push('clear'),
  };
  let t = 0;
  let ended = 0;
  const session = new GeminiLiveSession({
    transport,
    audio,
    getToken: opts.token ?? (async () => 'tok'),
    model: 'm',
    now: () => ++t,
    onEnded: () => void ended++,
  });
  return { session, conn, audioLog, get handlers() { return handlers; }, get connectOpts() { return connectOpts; }, mic: (n: number) => capture?.(new Uint8Array(n)), ended: () => ended };
}

const ev = (kind: 'rolling_stop'): DriveEvent => ({ eventId: 'e1', t: 0, kind, severity: 'warn' });

describe('GeminiLiveSession', () => {
  it('connects with the token, starts the mic and streams audio', async () => {
    const s = setup();
    await s.session.start();
    expect(s.connectOpts.token).toBe('tok');
    expect(s.session.isActive()).toBe(true);
    s.mic(4);
    expect(s.conn.log).toContain('audio:4');
  });

  it('pause stops mic and playback, drops model audio, resume restarts mic and flushes context', async () => {
    const s = setup();
    await s.session.start();
    s.session.pause();
    expect(s.audioLog.slice(-2)).toEqual(['stop', 'clear']);
    expect(s.conn.log).toContain('endStream');
    s.handlers.onAudio(new Uint8Array(3));
    expect(s.audioLog).not.toContain('play:3');
    s.session.noteEvent(ev('rolling_stop'));
    expect(s.conn.log.some((l) => l.startsWith('ctx:'))).toBe(false);
    s.session.resume();
    expect(s.conn.log.some((l) => l.startsWith('ctx:[Trip update]'))).toBe(true);
    expect(s.audioLog.at(-1)).toBe('start');
    expect(s.session.isActive()).toBe(true);
  });

  it('mic chunks are not sent while paused', async () => {
    const s = setup();
    await s.session.start();
    s.session.pause();
    s.mic(9);
    expect(s.conn.log).not.toContain('audio:9');
  });

  it('end() closes once and does not report onEnded; unexpected close does', async () => {
    const a = setup();
    await a.session.start();
    a.session.end();
    a.handlers.onClose();
    expect(a.conn.log.filter((l) => l === 'close')).toHaveLength(1);
    expect(a.ended()).toBe(0);
    expect(a.session.isActive()).toBe(false);

    const b = setup();
    await b.session.start();
    b.handlers.onClose();
    expect(b.ended()).toBe(1);
    expect(b.session.isActive()).toBe(false);
  });

  it('a failed token reports ended and leaves the session idle', async () => {
    const s = setup({ token: async () => { throw new Error('503'); } });
    await s.session.start();
    expect(s.session.isActive()).toBe(false);
    expect(s.ended()).toBe(1);
  });

  it('end() during connect closes the late connection', async () => {
    const s = setup();
    const p = s.session.start();
    s.session.end();
    await p;
    await flush();
    expect(s.conn.log).toContain('close');
    expect(s.session.isActive()).toBe(false);
  });

  it('builds a transcript, flushing on role change and turn complete', async () => {
    const s = setup();
    await s.session.start();
    s.handlers.onInputTranscript('how was ');
    s.handlers.onInputTranscript('that turn');
    s.handlers.onOutputTranscript('Pretty smooth.');
    s.handlers.onTurnComplete();
    expect(s.session.getTranscript().map((x) => [x.role, x.text])).toEqual([
      ['driver', 'how was that turn'],
      ['assistant', 'Pretty smooth.'],
    ]);
  });

  it('interruption clears queued model audio', async () => {
    const s = setup();
    await s.session.start();
    s.handlers.onInterrupted();
    expect(s.audioLog.at(-1)).toBe('clear');
  });
});

describe('prompt and SDK mapping', () => {
  it('system prompt carries hard rules and recent events', () => {
    const p = buildSystemInstruction({ smoothness: 82.4 }, [ev('rolling_stop')]);
    expect(p).toContain('never decide anything about safety');
    expect(p).toContain('82/100');
    expect(p).toContain('rolled through a stop sign');
  });

  it('base64 round-trips and server messages map to handlers', () => {
    const bytes = new Uint8Array([0, 1, 250, 255]);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual([0, 1, 250, 255]);
    const calls: string[] = [];
    const h = new Proxy({}, { get: (_t, k) => (...a: unknown[]) => void calls.push(`${String(k)}:${a.length ? 'x' : ''}`) }) as LiveHandlers;
    dispatchServerMessage(
      { data: toBase64(bytes), serverContent: { interrupted: true, outputTranscription: { text: 'hi' }, turnComplete: true } } as never,
      h,
    );
    expect(calls).toEqual(['onInterrupted:', 'onAudio:x', 'onOutputTranscript:x', 'onTurnComplete:']);
  });
});
