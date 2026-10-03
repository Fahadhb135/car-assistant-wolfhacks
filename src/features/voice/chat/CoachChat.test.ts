import { describe, expect, it, vi } from 'vitest';
import { CoachChat } from './CoachChat';

const mk = (fetchImpl: unknown) => {
  const speak = vi.fn();
  const chat = new CoachChat({
    baseUrl: 'http://x',
    voice: { speakReply: speak },
    getContext: () => ({ smoothness: 80 }),
    getRecentEvents: () => [{ eventId: 'e', t: 0, kind: 'rolling_stop', severity: 'warn' }],
    fetchImpl: fetchImpl as typeof fetch,
  });
  return { chat, speak };
};

describe('CoachChat', () => {
  it('posts context and speaks the reply', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: 'Smooth.' }) });
    const { chat, speak } = mk(f);
    expect(await chat.ask('how was that?')).toBe('Smooth.');
    const sent = JSON.parse(f.mock.calls[0]![1].body);
    expect(sent.message).toBe('how was that?');
    expect(sent.recentEvents[0]).toContain('rolled through');
    expect(speak).toHaveBeenCalledWith('chat-1', 'Smooth.');
  });

  it('speaks a fallback on network failure or HTTP error', async () => {
    const a = mk(vi.fn().mockRejectedValue(new Error('offline')));
    await a.chat.ask('hi');
    expect(a.speak.mock.calls[0]![1]).toContain("can't answer");
    const b = mk(vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await b.chat.ask('hi');
    expect(b.speak.mock.calls[0]![1]).toContain("can't answer");
  });
});
