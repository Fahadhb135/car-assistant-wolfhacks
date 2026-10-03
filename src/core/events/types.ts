export type DriveEvent = Readonly<{
  kind: 'crash_candidate' | 'swerve_candidate';
  occurredAtMs: number;
  severity: 'warning' | 'critical';
  confidence: number;
  evidence: Readonly<Record<string, number>>;
}>;
