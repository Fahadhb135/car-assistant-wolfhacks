import type { DriveEventInput, ImuEvent } from './types';

/**
 * Maps an experimental IMU candidate to the app-wide event the voice and trip record understand.
 *
 * - crash_candidate  -> crash (unconfirmed: the "Are you OK?" flow confirms it)
 * - swerve_candidate -> erratic_driving, with the detector's confidence as the score
 * - calibrated maneuver candidates -> their corresponding app-wide coaching events
 *
 * `epochOffsetMs` converts the IMU's monotonic sample clock to epoch time (Date.now() minus the
 * monotonic clock at the same instant). Voice staleness rules compare against the wall clock, so
 * events left on the monotonic clock would look hours old and be dropped.
 */
export function imuEventToDriveEventInput(e: ImuEvent, epochOffsetMs: number): DriveEventInput {
  const t = e.occurredAtMs + epochOffsetMs;
  switch (e.kind) {
    case 'crash_candidate':
      return { kind: 'crash', severity: 'critical', confirmed: false, t };
    case 'swerve_candidate':
      return { kind: 'erratic_driving', severity: 'warn', score: e.confidence, t };
    case 'hard_braking_candidate':
      return { kind: 'hard_braking', severity: 'warn', score: e.confidence, evidence: e.evidence, t };
    case 'rapid_acceleration_candidate':
      return { kind: 'rapid_acceleration', severity: 'warn', score: e.confidence, evidence: e.evidence, t };
    case 'harsh_corner_candidate':
      return { kind: 'harsh_cornering', severity: 'warn', score: e.confidence, evidence: e.evidence, t };
  }
}
