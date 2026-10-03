import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { destination } from '../../core/location/geo';
import { tileBounds, tileKeyFor, type BBox } from '../../core/location/tiles';
import type { RoadFeature, RoadWay, TileContents } from '../../core/location/types';
import { OverpassClient, OverpassError } from './overpassClient';
import { MemoryTileStore, TILE_SCHEMA, TileCache, type TileData } from './tileCache';

const RALEIGH = { lat: 35.7796, lon: -78.6382 };
const KEY = tileKeyFor(RALEIGH);
const b = tileBounds(KEY);
const CENTER = { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
const SIGN: RoadFeature = { id: 7, kind: 'stop', ...destination(CENTER, 0, 100), facingDeg: null };
// A highway crossing the tile's northern border, so both tiles return it.
const ROAD: RoadWay = {
  id: 99,
  kind: 'motorway',
  geometry: [destination(CENTER, 0, 600), destination(CENTER, 0, 1400)],
  oneway: 1,
  maxspeedMps: 29,
};

const inBox = (p: { lat: number; lon: number }, box: BBox) =>
  p.lat >= box.south && p.lat < box.north && p.lon >= box.west && p.lon < box.east;

/** Fake Overpass client that records calls and returns what falls inside the requested bbox. */
function fakeClient(features: RoadFeature[] = [SIGN], roads: RoadWay[] = [ROAD]) {
  const calls: BBox[] = [];
  let failing = false;
  return {
    calls,
    setFailing: (f: boolean) => (failing = f),
    async fetchTile(bbox: BBox): Promise<TileContents> {
      calls.push(bbox);
      if (failing) throw new Error('offline');
      return {
        features: features.filter((f) => inBox(f, bbox)),
        roads: roads.filter((r) => r.geometry.some((p) => inBox(p, bbox))),
      };
    },
  };
}

const stored = (overrides: Partial<TileData> = {}): TileData => ({
  key: KEY,
  schema: TILE_SCHEMA,
  fetchedAt: 0,
  source: 'network',
  features: [SIGN],
  roads: [],
  ...overrides,
});

describe('TileCache', () => {
  it('loads tiles once and answers from memory', async () => {
    const client = fakeClient();
    const cache = new TileCache({ client });
    const fix = { ...CENTER, heading: 0 };

    assert.deepEqual(cache.featuresAhead(fix), []); // nothing loaded yet, never blocks
    await Promise.all([cache.update(fix), cache.update(fix)]);
    const fetched = client.calls.length;
    assert.ok(fetched >= 1);

    await cache.update(fix);
    assert.equal(client.calls.length, fetched, 'fresh tiles are not refetched');
    assert.deepEqual(cache.featuresAhead(fix).map((s) => s.feature.id), [7]);
  });

  it('returns roads near the car once, even when they span two tiles', async () => {
    const cache = new TileCache({ client: fakeClient() });
    const fix = { lat: b.north - 0.0005, lon: CENTER.lon, heading: 0 }; // loads this tile and the next
    await cache.update(fix);
    assert.deepEqual(cache.roadsNear(fix).map((r) => r.id), [99]);
  });

  it('persists to the store and reloads from it', async () => {
    const store = new MemoryTileStore();
    await new TileCache({ client: fakeClient(), store }).getTile(KEY);

    const client = fakeClient();
    const tile = await new TileCache({ client, store }).getTile(KEY);
    assert.equal(client.calls.length, 0);
    assert.equal(tile?.features[0].id, 7);
  });

  it('refetches stored tiles from an older schema', async () => {
    const store = new MemoryTileStore();
    await store.set(stored({ schema: 1, fetchedAt: Date.now() }));
    const client = fakeClient();
    const tile = await new TileCache({ client, store }).getTile(KEY);
    assert.equal(client.calls.length, 1);
    assert.equal(tile?.schema, TILE_SCHEMA);
  });

  it('falls back to stale data, then bundled data, and backs off after failures', async () => {
    let now = 1_000_000;
    const store = new MemoryTileStore();
    await store.set(stored());

    const client = fakeClient();
    client.setFailing(true);
    const errors: string[] = [];
    const cache = new TileCache({
      client,
      store,
      maxAgeMs: 1000,
      retryAfterMs: 30_000,
      now: () => now,
      onError: (k) => errors.push(k),
    });

    const stale = await cache.getTile(KEY);
    assert.equal(stale?.fetchedAt, 0, 'stale stored copy is used when Overpass fails');
    assert.deepEqual(errors, [KEY]);

    await cache.getTile(KEY);
    assert.equal(client.calls.length, 1, 'no retry during back-off');

    now += 31_000;
    client.setFailing(false);
    const fresh = await cache.getTile(KEY);
    assert.equal(fresh?.fetchedAt, now);
    assert.equal(client.calls.length, 2);

    const offline = fakeClient();
    offline.setFailing(true);
    const bundledCache = new TileCache({ client: offline, bundled: { [KEY]: { features: [SIGN], roads: [] } } });
    assert.equal((await bundledCache.getTile(KEY))?.source, 'bundled');
    assert.equal(await new TileCache({ client: offline }).getTile('0:0'), null);
  });
});

describe('OverpassClient', () => {
  const okResponse = {
    elements: [
      { type: 'node', id: 1, lat: 35, lon: -78, tags: { highway: 'stop' } },
      { type: 'node', id: 2, lat: 35, lon: -78, tags: { highway: 'traffic_signals' } },
      {
        type: 'way',
        id: 3,
        geometry: [
          { lat: 35, lon: -78 },
          { lat: 35.01, lon: -78 },
        ],
        tags: { highway: 'motorway_link' },
      },
    ],
  };

  it('posts the query and parses the reply', async () => {
    let sent: RequestInit | undefined;
    const client = new OverpassClient({
      endpoints: ['https://a'],
      fetchFn: (async (_url: string, init: RequestInit) => {
        sent = init;
        return new Response(JSON.stringify(okResponse));
      }) as typeof fetch,
    });
    const tile = await client.fetchTile({ south: 1, west: 2, north: 3, east: 4 });
    assert.deepEqual(tile.features.map((f) => f.kind), ['stop', 'traffic_signals']);
    assert.deepEqual(tile.roads.map((r) => r.kind), ['motorway_link']);
    assert.equal(sent?.method, 'POST');
    assert.match((sent?.headers as Record<string, string>)['User-Agent'], /car-assistant-wolfhacks/);
    assert.match(decodeURIComponent(String(sent?.body)), /motorway_link/);
  });

  it('fails over to the next mirror and reports every failure', async () => {
    const urls: string[] = [];
    const client = new OverpassClient({
      endpoints: ['https://busy', 'https://ok'],
      fetchFn: (async (url: string) => {
        urls.push(url);
        return url === 'https://busy' ? new Response('', { status: 429 }) : new Response(JSON.stringify(okResponse));
      }) as typeof fetch,
    });
    assert.equal((await client.fetchTile(b)).features.length, 2);
    assert.deepEqual(urls, ['https://busy', 'https://ok']);

    const dead = new OverpassClient({
      endpoints: ['https://x', 'https://y'],
      timeoutMs: 20,
      fetchFn: ((_u: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch,
    });
    await assert.rejects(dead.fetchTile(b), (err: unknown) => {
      assert.ok(err instanceof OverpassError);
      assert.deepEqual(err.failures, ['https://x: timeout', 'https://y: timeout']);
      return true;
    });
  });
});
