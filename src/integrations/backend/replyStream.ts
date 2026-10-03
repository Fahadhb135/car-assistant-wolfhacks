import { base64ToBytes } from '../bluetooth/base64';

export type ReplyPacket =
  | { type: 'sentence'; i: number; text: string; audio: Uint8Array | null; mime: string; ms: number }
  | { type: 'done'; ms: number };

export type StreamReplyOptions = {
  baseUrl: string;
  /** Chat request body (message plus trip context). */
  body: unknown;
  /** Needs a fetch whose response has a streaming `body`: `fetch` from 'expo/fetch' in the app. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Give up if the first packet takes longer than this. */
  firstPacketTimeoutMs?: number;
};

const NEWLINE = 0x0a;

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return decodeURIComponent(escape(bin)); // Hermes builds without TextDecoder
}

/** Never trusts the stream: anything malformed is skipped, never spoken. */
export function parsePacket(line: string): ReplyPacket | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') return null;
  const ms = typeof p.ms === 'number' ? p.ms : 0;
  if (p.type === 'done') return { type: 'done', ms };
  if (p.type !== 'sentence' || typeof p.text !== 'string' || !p.text.trim() || typeof p.i !== 'number') return null;
  let audio: Uint8Array | null = null;
  if (typeof p.audio === 'string' && p.audio) {
    try {
      audio = base64ToBytes(p.audio);
    } catch {
      audio = null; // bad audio: the sentence is still spoken, by the phone's voice
    }
  }
  return { type: 'sentence', i: p.i, text: p.text, audio, mime: typeof p.mime === 'string' ? p.mime : 'audio/mpeg', ms };
}

/** Reads the server's one-JSON-object-per-line reply, yielding each packet as soon as it arrives. */
export async function* streamReply(o: StreamReplyOptions): AsyncGenerator<ReplyPacket> {
  const ctrl = new AbortController();
  const relay = () => ctrl.abort();
  o.signal?.addEventListener('abort', relay, { once: true });
  if (o.signal?.aborted) ctrl.abort();
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => ctrl.abort(), o.firstPacketTimeoutMs ?? 8000);
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const res = await (o.fetchImpl ?? fetch)(`${o.baseUrl}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o.body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`chat stream HTTP ${res.status}`);
    reader = res.body.getReader();

    let buf = new Uint8Array(0);
    for (;;) {
      const { done, value } = await reader.read();
      if (value && value.length) {
        const merged = new Uint8Array(buf.length + value.length);
        merged.set(buf);
        merged.set(value, buf.length);
        buf = merged;
      }
      // Split on newline BYTES, so a multi-byte character cut by a chunk boundary is never decoded early.
      let nl: number;
      while ((nl = buf.indexOf(NEWLINE)) >= 0) {
        const packet = parsePacket(decodeUtf8(buf.subarray(0, nl)));
        buf = buf.subarray(nl + 1);
        if (packet) {
          clear();
          yield packet;
          if (packet.type === 'done') return;
        }
      }
      if (done) {
        const tail = buf.length ? parsePacket(decodeUtf8(buf)) : null;
        if (tail) yield tail;
        return;
      }
    }
  } finally {
    clear();
    o.signal?.removeEventListener('abort', relay);
    ctrl.abort(); // stop downloading if the consumer left early
    reader?.cancel().catch(() => {});
  }
}
