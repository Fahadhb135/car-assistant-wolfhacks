import { describe, expect, it } from 'vitest';
import { alertFromEvent, PHRASES } from '../../features/voice/phrases';
import { imuEventToDriveEventInput } from './fromImu';
import { createIdGenerator, toDriveEvent, type ImuEvent } from './types';

const crash: ImuEvent = { kind: 'crash_candidate', occurredAtMs: 5_000, severity: 'critical', confidence: 0.9, evidence: { peakG: 6.1 } };
const swerve: ImuEvent = { kind: 'swerve_candidate', occurredAtMs: 7_000, severity: 'warning', confidence: 0.72, evidence: { yawRate: 80 } };
const brake: ImuEvent = {
  kind: 'hard_braking_candidate',
  occurredAtMs: 8_000,
  severity: 'warning',
  confidence: 0.81,
  evidence: { durationMs: 300, peakAccelerationG: 0.5, peakJerkGps: 4 },
};

describe('imuEventToDriveEventInput', () => {
  it('maps a crash candidate to an unconfirmed crash on the wall clock', () => {
    expect(imuEventToDriveEventInput(crash, 1_700_000_000_000)).toEqual({
      kind: 'crash', severity: 'critical', confirmed: false, t: 1_700_000_005_000,
    });
  });

  it('maps a swerve candidate to erratic driving, keeping the confidence as the score', () => {
    expect(imuEventToDriveEventInput(swerve, 0)).toEqual({ kind: 'erratic_driving', severity: 'warn', score: 0.72, t: 7_000 });
  });

  it('maps calibrated behavior evidence and produces events the voice layer speaks', () => {
    expect(imuEventToDriveEventInput(brake, 10)).toEqual({
      kind: 'hard_braking', severity: 'warn', score: 0.81, evidence: brake.evidence, t: 8_010,
    });
    const next = createIdGenerator('imu-');
    const spokenFor = (e: ImuEvent) => alertFromEvent(toDriveEvent(imuEventToDriveEventInput(e, 0), next))?.utterance.text;
    expect(spokenFor(crash)).toBe(PHRASES.crash_check);
    expect(spokenFor(swerve)).toBe(PHRASES.erratic_driving);
    expect(spokenFor(brake)).toContain('Brake more smoothly');
  });

  it('does not leak detector internals into the app-wide event', () => {
    expect(JSON.stringify(imuEventToDriveEventInput(crash, 0))).not.toContain('peakG');
  });
});
