import { describe, expect, it } from 'vitest';

import { toGpsFix } from './gpsFix';

describe('toGpsFix', () => {
  it('maps an expo-location reading to a GPS fix', () => {
    expect(
      toGpsFix({ timestamp: 1_000, coords: { latitude: 35.78, longitude: -78.63, speed: 12.5, heading: 270 } }),
    ).toEqual({ lat: 35.78, lon: -78.63, t: 1_000, speed: 12.5, heading: 270 });
  });

  it('reports unknown speed and heading as -1', () => {
    const fix = toGpsFix({ timestamp: 1, coords: { latitude: 0, longitude: 0, speed: null, heading: -1 } });
    expect(fix.speed).toBe(-1);
    expect(fix.heading).toBe(-1);
  });
});
