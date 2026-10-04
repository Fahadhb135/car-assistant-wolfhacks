import { describe, expect, it } from 'vitest';

import { speedLevel } from './speedLevel';

const MPH = 0.44704;

describe('speedLevel', () => {
  const tolerance = 5 * MPH;

  it('is unknown without a speed and ok without a limit', () => {
    expect(speedLevel(null, 25 * MPH, tolerance)).toBe('unknown');
    expect(speedLevel(40 * MPH, null, tolerance)).toBe('ok');
  });

  it('is ok at the limit, over above it, and speeding past the tolerance', () => {
    expect(speedLevel(25 * MPH, 25 * MPH, tolerance)).toBe('ok');
    expect(speedLevel(28 * MPH, 25 * MPH, tolerance)).toBe('over');
    expect(speedLevel(31 * MPH, 25 * MPH, tolerance)).toBe('speeding');
  });
});
