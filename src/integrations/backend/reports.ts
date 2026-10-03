import maya01 from '../../../fixtures/reports/demo-maya-01.json';
import maya12 from '../../../fixtures/reports/demo-maya-12.json';

export type TripReport = {
  headline: string;
  scoreExplanation: string;
  topIssues: { eventRef: string; advice: string }[];
  praise: string;
  nextGoal: string;
};

export type ReportSource = 'cloud' | 'bundled';

/** Pre-generated Gemini reports for the demo trips: the offline fallback (README task 6). */
const BUNDLED: Record<string, TripReport> = {
  'demo-maya-01': maya01 as TripReport,
  'demo-maya-12': maya12 as TripReport,
};

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Never trusts the network: a malformed report is treated as unavailable. */
export function parseReport(json: unknown): TripReport | null {
  const r = json as Partial<TripReport> | null;
  if (!r || !isText(r.headline) || !isText(r.scoreExplanation) || !isText(r.praise) || !isText(r.nextGoal)) return null;
  if (!Array.isArray(r.topIssues)) return null;
  const topIssues = r.topIssues.filter(
    (i): i is { eventRef: string; advice: string } => !!i && isText(i.eventRef) && isText(i.advice),
  );
  return { headline: r.headline, scoreExplanation: r.scoreExplanation, topIssues, praise: r.praise, nextGoal: r.nextGoal };
}

export type GetReportOptions = { baseUrl: string; tripId: string; timeoutMs?: number; fetchImpl?: typeof fetch };

/** Report from the cloud when reachable, otherwise the bundled one for known demo trips, else null. */
export async function getReport(o: GetReportOptions): Promise<{ report: TripReport; source: ReportSource } | null> {
  try {
    const res = await (o.fetchImpl ?? fetch)(`${o.baseUrl}/trips/${encodeURIComponent(o.tripId)}/report`, {
      signal: AbortSignal.timeout(o.timeoutMs ?? 6000),
    });
    if (res.ok) {
      const report = parseReport(await res.json());
      if (report) return { report, source: 'cloud' };
    }
  } catch {
    // fall through to the bundled copy
  }
  const bundled = BUNDLED[o.tripId];
  return bundled ? { report: bundled, source: 'bundled' } : null;
}
