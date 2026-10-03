import { describe, expect, it } from 'vitest';
import { parsePacket, streamReply, type ReplyPacket } from './replyStream';

const enc = new TextEncoder();
const b64 = (s: string) => Buffer.from(s).toString('base64');
const line = (o: unknown) => JSON.stringify(o) + '\n';

function fetchOf(chunks: Uint8Array[], opts: { onCancel?: () => void; status?: number } = {}) {
  const calls: { url: string; signal: AbortSignal; body: string }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, signal: init.signal as AbortSignal, body: init.body as string });
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < chunks.length) c.enqueue(chunks[i++]);
        else c.close();
      },
      cancel: () => opts.onCancel?.(),
    });
    return new Response(opts.status && opts.status >= 400 ? null : body, { status: opts.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const collect = async (g: AsyncGenerator<ReplyPacket>) => {
  const out: ReplyPacket[] = [];
  for await (const p of g) out.push(p);
  return out;
};

describe('streamReply', () => {
  it('yields sentences with decoded audio, then stops at done', async () => {
    const data = enc.encode(
      line({ type: 'sentence', i: 0, text: 'First one.', audio: b64('AUDIO1'), mime: 'audio/mpeg', ms: 800 }) +
        line({ type: 'sentence', i: 1, text: 'Second one.', audio: null, mime: 'audio/mpeg', ms: 850 }) +
        line({ type: 'done', ms: 900 }),
    );
    const { impl, calls } = fetchOf([data]);
    const out = await collect(streamReply({ baseUrl: 'http://x', body: { message: 'hi' }, fetchImpl: impl }));
    expect(calls[0]!.url).toBe('http://x/chat/stream');
    expect(JSON.parse(calls[0]!.body)).toEqual({ message: 'hi' });
    expect(out.map((p) => p.type)).toEqual(['sentence', 'sentence', 'done']);
    expect(out[0]).toMatchObject({ text: 'First one.', ms: 800 });
    expect(Buffer.from((out[0] as { audio: Uint8Array }).audio).toString()).toBe('AUDIO1');
    expect((out[1] as { audio: unknown }).audio).toBeNull();
  });

  it('reassembles lines and multi-byte characters split across network chunks', async () => {
    const full = enc.encode(line({ type: 'sentence', i: 0, text: "That’s a smooth stop — nice work.", audio: null, mime: 'audio/mpeg', ms: 1 }) + line({ type: 'done', ms: 2 }));
    // cut inside the 3-byte curly apostrophe and in the middle of a line, plus one-byte chunks
    const apos = full.indexOf(0xe2) + 1;
    const chunks = [full.subarray(0, apos), full.subarray(apos, apos + 5), full.subarray(apos + 5, full.length - 7), full.subarray(full.length - 7)];
    const out = await collect(streamReply({ baseUrl: 'http://x', body: {}, fetchImpl: fetchOf(chunks).impl }));
    expect((out[0] as { text: string }).text).toBe("That’s a smooth stop — nice work.");
    const bytewise = Array.from(full, (b) => new Uint8Array([b]));
    const out2 = await collect(streamReply({ baseUrl: 'http://x', body: {}, fetchImpl: fetchOf(bytewise).impl }));
    expect(out2).toEqual(out);
  });

  it('skips malformed lines instead of speaking them', async () => {
    const data = enc.encode('not json\n' + line({ type: 'sentence', i: 0, text: '   ', audio: null }) + line({ type: 'nope' }) + line({ type: 'sentence', i: 1, text: 'Good one.', audio: '###bad###', mime: 'audio/mpeg', ms: 5 }) + line({ type: 'done', ms: 6 }));
    const out = await collect(streamReply({ baseUrl: 'http://x', body: {}, fetchImpl: fetchOf([data]).impl }));
    expect(out.map((p) => p.type)).toEqual(['sentence', 'done']);
    expect((out[0] as { audio: unknown }).audio).toBeNull(); // bad audio: sentence kept, phone voice will say it
  });

  it('handles a final packet with no trailing newline', async () => {
    const out = await collect(streamReply({ baseUrl: 'http://x', body: {}, fetchImpl: fetchOf([enc.encode(JSON.stringify({ type: 'sentence', i: 0, text: 'Last words.', audio: null, ms: 1 }))]).impl }));
    expect(out).toHaveLength(1);
  });

  it('throws on an HTTP error so the caller can speak its apology', async () => {
    await expect(collect(streamReply({ baseUrl: 'http://x', body: {}, fetchImpl: fetchOf([], { status: 500 }).impl }))).rejects.toThrow('HTTP 500');
  });

  it('stops downloading when the consumer leaves early', async () => {
    let cancelled = false;
    const many = Array.from({ length: 50 }, (_, i) => enc.encode(line({ type: 'sentence', i, text: `Sentence number ${i}.`, audio: null, ms: i })));
    const { impl, calls } = fetchOf(many, { onCancel: () => (cancelled = true) });
    for await (const p of streamReply({ baseUrl: 'http://x', body: {}, fetchImpl: impl })) {
      if (p.type === 'sentence') break; // the driver pressed talk again
    }
    expect(calls[0]!.signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(cancelled).toBe(true);
  });

  it('gives up if the first packet takes too long', async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    await expect(collect(streamReply({ baseUrl: 'http://x', body: {}, fetchImpl: hang, firstPacketTimeoutMs: 20 }))).rejects.toThrow('aborted');
  });
});

describe('parsePacket', () => {
  it('rejects non-objects and missing fields', () => {
    for (const bad of ['null', '5', '"x"', '{"type":"sentence"}', '{"type":"sentence","i":"0","text":"a"}']) expect(parsePacket(bad)).toBeNull();
  });
});
