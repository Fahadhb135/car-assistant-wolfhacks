// Event contract from README section 9. `eventId` and `t` are added so reports
// and the cloud can reference individual events.
export type DriveEventBody =
  | { kind: 'crash'; severity: 'critical'; confirmed: boolean }
  | { kind: 'erratic_driving'; severity: 'warn'; score: number }
  | { kind: 'stop_sign_ahead'; severity: 'info'; distanceM: number }
  | { kind: 'stop_ok' | 'rolling_stop' | 'ran_stop'; severity: 'info' | 'warn' };

export type DriveEvent = DriveEventBody & {
  eventId: string;
  /** Epoch milliseconds when the event was detected. */
  t: number;
};

export type DriveEventKind = DriveEvent['kind'];
