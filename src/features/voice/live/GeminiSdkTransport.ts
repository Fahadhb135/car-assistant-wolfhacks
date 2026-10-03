import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
import { INPUT_MIME, type ConnectOptions, type LiveConnection, type LiveHandlers, type LiveTransport } from './ports';

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Pure mapping from an SDK server message to our handlers, so it can be unit-tested. */
export function dispatchServerMessage(msg: LiveServerMessage, h: LiveHandlers): void {
  const sc = msg.serverContent;
  if (sc?.interrupted) h.onInterrupted();
  const audio = msg.data;
  if (audio) h.onAudio(fromBase64(audio));
  if (sc?.inputTranscription?.text) h.onInputTranscript(sc.inputTranscription.text);
  if (sc?.outputTranscription?.text) h.onOutputTranscript(sc.outputTranscription.text);
  if (sc?.turnComplete) h.onTurnComplete();
}

/**
 * Real transport over @google/genai. Authenticates with the cloud service's ephemeral
 * token (v1alpha). UNVERIFIED on a phone: Hermes/React Native WebSocket support for the
 * SDK needs a device test. If it fails, point a transport at the cloud WebSocket proxy
 * instead; GeminiLiveSession does not change.
 */
export class GeminiSdkTransport implements LiveTransport {
  async connect(opts: ConnectOptions, handlers: LiveHandlers): Promise<LiveConnection> {
    const ai = new GoogleGenAI({ apiKey: opts.token, httpOptions: { apiVersion: 'v1alpha' } });
    const session = await ai.live.connect({
      model: opts.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: opts.systemInstruction,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
      },
      callbacks: {
        onmessage: (m) => dispatchServerMessage(m, handlers),
        onerror: (e) => handlers.onError(e),
        onclose: () => handlers.onClose(),
      },
    });
    return {
      sendAudio: (pcm) => session.sendRealtimeInput({ audio: { data: toBase64(pcm), mimeType: INPUT_MIME } }),
      endAudioStream: () => session.sendRealtimeInput({ audioStreamEnd: true }),
      sendContext: (text) =>
        session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: false }),
      close: () => session.close(),
    };
  }
}
