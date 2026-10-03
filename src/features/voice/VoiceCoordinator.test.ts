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
