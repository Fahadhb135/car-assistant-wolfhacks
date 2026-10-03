import { describe, expect, it } from 'vitest';
import { destination } from '../location/geo';
import type { GpsFix } from '../location/types';
import { HotspotIndex, type Hotspot, type HotspotSnapshot } from './hotspots';

const SPOT = { lat: 35.7832, lon: -78.633 };

const hotspot = (over: Partial<Hotspot> = {}): Hotspot => ({
  cell: '35.783,-78.633', ...SPOT, bad: 6, trips: 4, drivers: 3,
  byKind: { rolling_stop: 6 }, topKind: 'rolling_stop', ...over,
});
const snap = (hotspots: Hotspot[], demo = false): HotspotSnapshot => ({ source: 'local', generatedAt: 1, demo, hotspots });

/** A fix `meters` away from the spot, on the side the car approaches from, driving toward it. */
function approaching(meters: number, t: number, headingToward = 0): GpsFix {
  const from = destination(SPOT, (headingToward + 180) % 360, meters); // behind the spot
  return { ...from, t, speed: 15, heading: headingToward };
}

describe('HotspotIndex', () => {
  it('warns once when the car is heading toward the hotspot within range', () => {
    const idx = new HotspotIndex(snap([hotspot()], true));
    expect(idx.update(approaching(400, 0))).toEqual([]); // too far
    const [e] = idx.update(approaching(240, 1000));
    expect(e).toMatchObject({ kind: 'hotspot_ahead', cell: '35.783,-78.633', topKind: 'rolling_stop', drivers: 3, demo: true });
    expect(Math.abs((e as { distanceM: number }).distanceM - 240)).toBeLessThanOrEqual(2);
    expect(idx.update(approaching(200, 2000))).toEqual([]); // not repeated
    expect(idx.update(approaching(120, 3000))).toEqual([]);
  });

  it('stays quiet when moving away, sideways, or with unknown heading', () => {
    const idx = new HotspotIndex(snap([hotspot()]));
    const pastIt: GpsFix = { ...destination(SPOT, 0, 150), t: 0, speed: 15, heading: 0 }; // 150 m beyond the spot, still heading north
    expect(idx.update(pastIt)).toEqual([]);
    expect(idx.update({ ...approaching(150, 1, 0), heading: 90 })).toEqual([]); // spot is off to the side
    expect(idx.update({ ...approaching(150, 2, 0), heading: -1 })).toEqual([]);
  });

  it('does not warn when the car is already at the spot', () => {
    const idx = new HotspotIndex(snap([hotspot()]));
    expect(idx.update(approaching(12, 0))).toEqual([]);
  });

  it('re-arms after the car has been away for a while', () => {
    const idx = new HotspotIndex(snap([hotspot()]), { forgetAfterMs: 60_000 });
    expect(idx.update(approaching(200, 0))).toHaveLength(1);
    expect(idx.update(approaching(180, 30_000))).toEqual([]);
    expect(idx.update(approaching(900, 100_000))).toEqual([]); // far away, state is forgotten
    expect(idx.update(approaching(200, 200_000))).toHaveLength(1); // second pass
  });

  it('announces neighbouring cells of one intersection only once', () => {
    const neighbour = hotspot({ cell: '35.784,-78.633', ...destination(SPOT, 0, 40) });
    const idx = new HotspotIndex(snap([hotspot(), neighbour]));
    const first = idx.update(approaching(220, 0));
    const second = idx.update(approaching(200, 1000));
    const third = idx.update(approaching(180, 2000));
    expect([...first, ...second, ...third]).toHaveLength(1);
  });

  it('announces separate intersections one per fix, nearest first', () => {
    // a second, separate intersection 100 m to the side: both are in range and in the cone at once
    const other = hotspot({ cell: 'other', ...destination(SPOT, 90, 100) });
    const idx = new HotspotIndex(snap([other, hotspot()]));
    const first = idx.update(approaching(200, 0));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ cell: '35.783,-78.633' }); // nearest first, only one per fix
    const second = idx.update(approaching(190, 1000));
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ cell: 'other' });
    expect(idx.update(approaching(180, 2000))).toEqual([]);
  });

  it('works with an empty snapshot', () => {
    expect(new HotspotIndex(snap([])).update(approaching(100, 0))).toEqual([]);
  });
});
