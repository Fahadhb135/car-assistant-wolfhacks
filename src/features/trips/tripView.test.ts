import { describe, expect, it } from 'vitest';

import { parseDriverTrips, parseTripSummary } from '../../integrations/backend/dashboardClient';
import { describeTripEvent, eventViews, sourceLabel, stopsLabel } from './tripView';

const SUMMARY = {
  source: 'databricks', pending: false,
  trip: { tripId: 't1', start: 0, end: 600_000, smoothness: 90, stopCompliance: 0.5, nEvents: 4, nBadEvents: 1, distanceM: 4828 },
  events: [
    { eventId: 'a', t: 10_000, kind: 'stop_sign_ahead', detail: { distanceM: 140 } },
    { eventId: 'b', t: 65_000, kind: 'rolling_stop', road: 'Wilmington St', detail: { minSpeedMps: 2.2 } },
    { eventId: 'c', t: 90_000, kind: 'speeding', detail: { speedMps: 20, limitMps: 15.6, road: 'Glenwood Ave' }, road: 'Glenwood Ave' },
    { eventId: 'bad' },
  ],
  transcript: [{ t: 66_000, role: 'assistant', text: 'Count to three.' }, { t: 1, role: 'robot', text: 'x' }],
};

describe('dashboard client', () => {
  it('parses a Databricks trip summary defensively', () => {
    const s = parseTripSummary(SUMMARY)!;
    expect(s.trip.distanceM).toBe(4828);
    expect(s.trip.pending).toBe(false);
    expect(s.events.map((e) => e.eventId)).toEqual(['a', 'b', 'c']);
    expect(s.transcript).toEqual([{ t: 66_000, role: 'assistant', text: 'Count to three.' }]);
    expect(parseTripSummary({ source: 'databricks', trip: { tripId: 'x' } })).toBeNull();
  });

  it('parses the trip list and keeps pending flags', () => {
    const d = parseDriverTrips({ source: 'databricks', trips: [{ ...SUMMARY.trip, pending: true }, { nope: 1 }] })!;
    expect(d.trips).toHaveLength(1);
    expect(d.trips[0]!.pending).toBe(true);
  });
});

describe('trip view', () => {
  it('words every moment for the driver and hides approach warnings', () => {
    const views = eventViews(parseTripSummary(SUMMARY)!);
    expect(views.map((v) => [v.time, v.title, v.detail, v.tone])).toEqual([
      ['1:05', 'Rolling stop', 'Slowest 5 mph on Wilmington St', 'warn'],
      ['1:30', 'Speeding', '45 mph in a 35 mph zone on Glenwood Ave', 'warn'],
    ]);
  });

  it('has a title for highway, stop and hotspot events', () => {
    expect(describeTripEvent({ eventId: 'h', t: 0, kind: 'highway_entering', detail: { advice: 'ok' } }).title)
      .toBe('Good highway merge');
    expect(describeTripEvent({ eventId: 's', t: 0, kind: 'stop_ok' }).tone).toBe('good');
    expect(describeTripEvent({ eventId: 'p', t: 0, kind: 'hotspot_ahead', detail: { drivers: 5, topKind: 'ran_stop' } }).detail)
      .toBe('5 drivers often run the stop here');
  });

  it('labels where the data came from', () => {
    expect(sourceLabel('databricks', false)).toBe('Loaded from Databricks');
    expect(sourceLabel('local', true)).toMatch(/still ingesting/);
    expect(sourceLabel('phone', true)).toBe('On this phone only');
    expect(stopsLabel(parseTripSummary(SUMMARY)!.trip)).toBe('50%');
  });
});
