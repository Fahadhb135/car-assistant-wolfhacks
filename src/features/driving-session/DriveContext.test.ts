import { describe, expect, it } from 'vitest';

import { buildCloudTrip } from '../../integrations/backend/tripUpload';
import { DriveContext } from './DriveContext';

const fix = (t: number, lat: number, lon = -78.63) => ({ t, lat, lon, speed: 10, heading: 0 });
// 0.001 degrees of latitude is about 111 m.
const NORTH_111M = 0.001;

describe('DriveContext distance', () => {
  it('starts at zero and adds up the hops between GPS fixes', () => {
    const ctx = new DriveContext();
    expect(ctx.distanceM()).toBe(0);
    ctx.updateFix(fix(0, 35.0));
    ctx.updateFix(fix(1, 35.0 + NORTH_111M));
    ctx.updateFix(fix(2, 35.0 + 2 * NORTH_111M));
    expect(ctx.distanceM()).toBeGreaterThan(220);
    expect(ctx.distanceM()).toBeLessThan(224);
  });

  it('ignores GPS jitter while parked and jumps from a lost signal', () => {
    const ctx = new DriveContext();
    ctx.updateFix(fix(0, 35.0));
    ctx.updateFix(fix(1, 35.00001)); // about 1 m: jitter
    ctx.updateFix(fix(2, 35.0)); // jitter back
    expect(ctx.distanceM()).toBe(0);
    ctx.updateFix(fix(3, 35.1)); // about 11 km in one hop: the signal was lost, not driven
    expect(ctx.distanceM()).toBe(0);
  });
});

describe('trip upload distance', () => {
  const base = { tripId: 't', driverId: 'd', start: 1, end: 2, events: [] };

  it('uploads distance in the scores, rounded to a metre', () => {
    expect(buildCloudTrip({ ...base, distanceM: 1609.6 }).scores.distanceM).toBe(1610);
  });

  it('leaves it out when there was no GPS, so the dashboard shows "not recorded" rather than 0 miles', () => {
    expect(buildCloudTrip(base).scores).not.toHaveProperty('distanceM');
    expect(buildCloudTrip({ ...base, distanceM: 0 }).scores).not.toHaveProperty('distanceM');
  });
});
