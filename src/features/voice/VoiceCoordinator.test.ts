import { describe, expect, it } from 'vitest';
import { VoiceCoordinator } from './VoiceCoordinator';
import { PHRASES } from './phrases';
import { FakeLive, FakeSpeaker, ev, flush } from './testing';

function setup() {
  const speaker = new FakeSpeaker();
  const live = new FakeLive();
  let t = 0;
  const errors: unknown[] = [];
  const voice = new VoiceCoordinator({ speaker, live, now: () => t, onError: (e) => errors.push(e) });
  return { speaker, live, voice, errors, advance: (ms: number) => (t += ms), clock: () => t };
}

describe('VoiceCoordinator', () => {
  it('higher priority interrupts a playing lower-priority alert', async () => {
    const { speaker, voice } = setup();
    voice.handleEvent(ev({ kind: 'erratic_driving', severity: 'warn', score: 1 }, 0));
    await flush();
    voice.handleEvent(ev({ kind: 'crash', severity: 'critical', confirmed: false }, 0));
    await flush();
    expect(speaker.spoken).toEqual([PHRASES.erratic_driving, PHRASES.crash_check]);
  });

  it('clips go first, the live coach waits for them, and nothing cuts the live coach off', async () => {
    const { speaker, voice } = setup();
    const remark = 'Keep your hands steady for the next block.';
    voice.speakCoach('coach-1', remark);
    await flush();
    expect(speaker.spoken).toEqual([remark]);
    // A stop-sign clip and even a crash check wait for the remark to finish.
    voice.handleEvent(ev({ kind: 'stop_sign_ahead', severity: 'info', distanceM: 40 }, 0));
    voice.handleEvent(ev({ kind: 'crash', severity: 'critical', confirmed: false }, 0));
    await flush();
    expect(speaker.spoken).toEqual([remark]);
    speaker.complete();
    await flush();
    expect(speaker.spoken).toEqual([remark, PHRASES.crash_check]);
  });

  it('a queued remark waits behind every clip, even one that arrives after it', async () => {
    const { speaker, voice } = setup();
    voice.handleEvent(ev({ kind: 'erratic_driving', severity: 'warn', score: 1 }, 0));
    await flush();
    voice.speakCoach('coach-1', 'Ease into the turns.');
    voice.handleEvent(ev({ kind: 'stop_ok', severity: 'info' }, 0));
    speaker.complete();
    await flush();
    expect(speaker.spoken).toEqual([PHRASES.erratic_driving, PHRASES.stop_ok]);
    speaker.complete();
    await flush();
    expect(speaker.spoken).toEqual([PHRASES.erratic_driving, PHRASES.stop_ok, 'Ease into the turns.']);
  });

  it('a clip and the Gemini remark wait for each other instead of cutting each other off', async () => {
    const { speaker, voice } = setup();
    voice.handleEvent(ev({ kind: 'erratic_driving', severity: 'warn', score: 1 }, 0));
    await flush();
    voice.speakCoach('coach-1', 'Keep your hands steady for the next block.');
    await flush();
    expect(speaker.spoken).toEqual([PHRASES.erratic_driving]);
    speaker.complete();
    await flush();
    // The remark plays next, and a non-urgent clip arriving now waits for it.
    voice.handleEvent(ev({ kind: 'hard_braking', severity: 'warn', score: 1, evidence: {} }, 0));
    await flush();
    expect(speaker.spoken).toEqual([PHRASES.erratic_driving, 'Keep your hands steady for the next block.']);
    speaker.complete();
    await flush();
    expect(speaker.spoken).toHaveLength(3);
  });

  it('does not interrupt for an equal or lower priority alert, and plays it after', async () => {
    const { speaker, voice } = setup();
    voice.handleEvent(ev({ kind: 'stop_sign_ahead', severity: 'info', distanceM: 40 }, 0));
    await flush();
    voice.handleEvent(ev({ kind: 'stop_ok', severity: 'info' }, 0));
    await flush();
    expect(speaker.spoken).toEqual([PHRASES.stop_sign_ahead]);
    speaker.complete();
    await flush();
    expect(speaker.spoken).toEqual([PHRASES.stop_sign_ahead, PHRASES.stop_ok]);
  });

  it('pauses Live for an alert and resumes it afterwards', async () => {
    const { speaker, live, voice } = setup();
    live.active = true;
    voice.handleEvent(ev({ kind: 'stop_sign_ahead', severity: 'info', distanceM: 40 }, 0));
    await flush();
    expect(live.calls).toEqual(['pause']);
    speaker.complete();
    await flush();
    expect(live.calls).toEqual(['pause', 'resume']);
  });

  it('speaks a possible-crash check once and discards queued lower-priority work', async () => {
    const { speaker, voice } = setup();
    voice.handleEvent(ev({ kind: 'stop_sign_ahead', severity: 'info', distanceM: 40 }, 0));
    await flush();
    voice.speakReply('queued-chat', 'This must not play.');
    voice.suggestTip('queued-tip', 'Nor this.');
    const possibleCrash = { kind: 'crash' as const, severity: 'critical' as const, confirmed: false };
    voice.handleEvent(ev(possibleCrash, 0));
    voice.handleEvent(ev(possibleCrash, 0));
    await flush();
    expect(speaker.spoken).toEqual([PHRASES.stop_sign_ahead, PHRASES.crash_check]);
    speaker.complete();
    await flush();
    expect(speaker.spoken).toEqual([PHRASES.stop_sign_ahead, PHRASES.crash_check]);
    voice.speakReply('passenger-request', 'I am okay.');
    await flush();
    expect(speaker.spoken).toEqual([PHRASES.stop_sign_ahead, PHRASES.crash_check, 'I am okay.']);
  });

  it('ends Live on a crash and never resumes it', async () => {
    const { speaker, live, voice } = setup();
    live.active = true;
    voice.handleEvent(ev({ kind: 'crash', severity: 'critical', confirmed: false }, 0));
    await flush();
    speaker.complete();
    await flush();
    expect(live.calls).toEqual(['end']);
  });

  it('defers coaching tips while Live is active, then plays them when idle', async () => {
    const { speaker, live, voice } = setup();
    live.active = true;
    voice.suggestTip('tip1', 'Look further ahead.');
    await flush();
    expect(speaker.spoken).toEqual([]);
    live.active = false;
    voice.notifyLiveIdle();
    await flush();
    expect(speaker.spoken).toEqual(['Look further ahead.']);
  });

  it('keeps going after a speaker failure and reports it', async () => {
    const { speaker, voice, errors } = setup();
    speaker.speak = () => Promise.reject(new Error('boom'));
    voice.handleEvent(ev({ kind: 'ran_stop', severity: 'warn' }, 0));
    await flush();
    expect(errors).toHaveLength(1);
    voice.handleEvent(ev({ kind: 'crash', severity: 'critical', confirmed: false }, 0));
    await flush();
    expect(errors).toHaveLength(2);
  });
});

describe('chat replies', () => {
  it('a chat reply is preempted by a safety alert and outranks tips', async () => {
    const { speaker, voice } = setup();
    voice.speakReply('c1', 'Pretty smooth.');
    await flush();
    voice.handleEvent(ev({ kind: 'stop_sign_ahead', severity: 'info', distanceM: 30 }, 0));
    await flush();
    expect(speaker.spoken).toEqual(['Pretty smooth.', PHRASES.stop_sign_ahead]);
  });
});
