import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { destination } from '../../core/location/geo.ts';
import type { StopSign } from '../../core/location/overpass.ts';
import { tileBounds, tileKeyFor, type BBox } from '../../core/location/tiles.ts';
import { OverpassClient, OverpassError } from './overpassClient.ts';
import { MemoryTileStore, TileCache } from './tileCache.ts';

const RALEIGH = { lat: 35.7796, lon: -78.6382 };
const KEY = tileKeyFor(RALEIGH);
const b = tileBounds(KEY);
const CENTER = { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
const SIGN: StopSign = { id: 7, ...destination(CENTER, 0, 100), facingDeg: null };

/** Fake Overpass client that records calls and returns signs inside the requested bbox. */
function fakeClient(signs: StopSign[] = [SIGN]) {
  const calls: BBox[] = [];
  let failing = false;
  return {
    calls,
    setFailing: (f: boolean) => (failing = f),
    async fetchStopSigns(bbox: BBox) {
      calls.push(bbox);
      if (failing) throw new Error('offline');
      return signs.filter((s) => s.lat >= bbox.south && s.lat < bbox.north && s.lon >= bbox.west && s.lon < bbox.east);
    },
  };
}

describe('TileCache', () => {
  it('loads tiles once and answers signsAhead from memory', async () => {
    const client = fakeClient();
    const cache = new TileCache({ client });
    const fix = { ...CENTER, heading: 0 };

    assert.deepEqual(cache.signsAhead(fix), []); // nothing loaded yet, never blocks
    await Promise.all([cache.update(fix), cache.update(fix)]);
    const fetched = client.calls.length;
    assert.ok(fetched >= 1);

    await cache.update(fix);
    assert.equal(client.calls.length, fetched, 'fresh tiles are not refetched');
    assert.deepEqual(cache.signsAhead(fix).map((s) => s.sign.id), [7]);
  });

  it('persists to the store and reloads from it', async () => {
    const store = new MemoryTileStore();
    await new TileCache({ client: fakeClient(), store }).getTile(KEY);

    const client = fakeClient();
    const tile = await new TileCache({ client, store }).getTile(KEY);
    assert.equal(client.calls.length, 0);
    assert.equal(tile?.signs[0].id, 7);
  });

  it('falls back to stale data, then bundled data, and backs off after failures', async () => {
    let now = 1_000_000;
    const store = new MemoryTileStore();
    await store.set({ key: KEY, fetchedAt: 0, signs: [SIGN], source: 'network' });

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
    const bundledCache = new TileCache({ client: offline, bundled: { [KEY]: [SIGN] } });
    assert.equal((await bundledCache.getTile(KEY))?.source, 'bundled');
    assert.equal(await new TileCache({ client: offline }).getTile('0:0'), null);
  });
});

describe('OverpassClient', () => {
  const okResponse = { elements: [{ type: 'node', id: 1, lat: 35, lon: -78, tags: { highway: 'stop' } }] };

  it('posts the query and parses the reply', async () => {
    let sent: RequestInit | undefined;
    const client = new OverpassClient({
      endpoints: ['https://a'],
      fetchFn: (async (_url: string, init: RequestInit) => {
        sent = init;
        return new Response(JSON.stringify(okResponse));
      }) as typeof fetch,
    });
    const signs = await client.fetchStopSigns({ south: 1, west: 2, north: 3, east: 4 });
    assert.equal(signs[0].id, 1);
    assert.equal(sent?.method, 'POST');
    assert.match((sent?.headers as Record<string, string>)['User-Agent'], /car-assistant-wolfhacks/);
    assert.match(decodeURIComponent(String(sent?.body)), /node\["highway"="stop"\]/);
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
    assert.equal((await client.fetchStopSigns(b)).length, 1);
    assert.deepEqual(urls, ['https://busy', 'https://ok']);

    const dead = new OverpassClient({
      endpoints: ['https://x', 'https://y'],
      timeoutMs: 20,
      fetchFn: ((_u: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch,
    });
    await assert.rejects(dead.fetchStopSigns(b), (err: unknown) => {
      assert.ok(err instanceof OverpassError);
      assert.deepEqual(err.failures, ['https://x: timeout', 'https://y: timeout']);
      return true;
    });
  });
});
