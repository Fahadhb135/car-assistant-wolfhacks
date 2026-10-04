import { featuresAhead, type FeatureAhead, type FeatureFilterOptions } from '../../core/location/featureFilter';
import type { LatLon } from '../../core/location/geo';
import { tileBounds, tilesForFix, type TileKey } from '../../core/location/tiles';
import type { RoadWay, SpeedLimitWay, TileContents } from '../../core/location/types';
import type { OverpassClient } from './overpassClient';

// Map data per ~1-mile tile, layered: memory → persistent store → Overpass
// → (on failure) a stale stored copy → bundled demo-route data.
//
// The live path never waits on the network: call `update(fix)` on every GPS fix
// to start any fetches it needs (fire and forget), and read `featuresAhead(fix)`
// and `roadsNear(fix)` for whatever is already loaded. A tile that fails to
// load is retried after a back-off instead of on every fix.

/** Bump when TileContents changes shape so stored tiles from older builds are refetched. */
export const TILE_SCHEMA = 3;

export type TileData = TileContents & {
  key: TileKey;
  schema: number;
  fetchedAt: number;
  source: 'network' | 'bundled';
};

/** Persistent storage for tiles. Back it with SQLite/AsyncStorage in the app. */
export interface TileStore {
  get(key: TileKey): Promise<TileData | null>;
  set(data: TileData): Promise<void>;
  /** Drop a tile. Optional: stores without it keep tiles after `retain`. */
  delete?(key: TileKey): Promise<void>;
  /** Keys of every stored tile. Needed alongside `delete` for `retain`. */
  keys?(): Promise<TileKey[]>;
}

export class MemoryTileStore implements TileStore {
  private readonly map = new Map<TileKey, TileData>();
  async get(key: TileKey) {
    return this.map.get(key) ?? null;
  }
  async set(data: TileData) {
    this.map.set(data.key, data);
  }
  async delete(key: TileKey) {
    this.map.delete(key);
  }
  async keys() {
    return [...this.map.keys()];
  }
}

export type TileCacheOptions = {
  client: Pick<OverpassClient, 'fetchTile'>;
  store?: TileStore;
  /** Pre-fetched tiles for the demo route, used when the network is unavailable. */
  bundled?: Record<TileKey, TileContents>;
  /** Stored tiles older than this are refetched (but still used if the fetch fails). */
  maxAgeMs?: number;
  /** Wait this long after a failed fetch before trying that tile again. */
  retryAfterMs?: number;
  now?: () => number;
  onError?: (key: TileKey, err: unknown) => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export class TileCache {
  private readonly memory = new Map<TileKey, TileData>();
  private readonly inFlight = new Map<TileKey, Promise<TileData | null>>();
  private readonly failedAt = new Map<TileKey, number>();
  private readonly client: TileCacheOptions['client'];
  private readonly store: TileStore;
  private readonly bundled: Record<TileKey, TileContents>;
  private readonly maxAgeMs: number;
  private readonly retryAfterMs: number;
  private readonly now: () => number;
  private readonly onError?: TileCacheOptions['onError'];

  constructor(opts: TileCacheOptions) {
    this.client = opts.client;
    this.store = opts.store ?? new MemoryTileStore();
    this.bundled = opts.bundled ?? {};
    this.maxAgeMs = opts.maxAgeMs ?? 7 * DAY_MS;
    this.retryAfterMs = opts.retryAfterMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.onError = opts.onError;
  }

  /** Start loading every tile this fix needs. Resolves when they have settled. */
  async update(fix: LatLon & { heading?: number | null }): Promise<void> {
    await Promise.all(tilesForFix(fix).map((key) => this.getTile(key)));
  }

  /** Stop signs and traffic lights ahead of the car among loaded tiles. Never blocks. */
  featuresAhead(fix: LatLon & { heading?: number | null }, opts?: FeatureFilterOptions): FeatureAhead[] {
    const features = this.loaded(fix, opts).flatMap((t) => t.features);
    return featuresAhead(fix, dedupeById(features), opts);
  }

  /** Highway and ramp ways in the loaded tiles around the car. Never blocks. */
  roadsNear(fix: LatLon & { heading?: number | null }): RoadWay[] {
    // A way crossing a tile border comes back in both tiles' queries.
    return dedupeById(this.loaded(fix).flatMap((t) => t.roads));
  }

  /**
   * Load these tiles in the background, at most `concurrency` network fetches at a time so a
   * whole region doesn't flood the public Overpass mirrors. Tiles already fresh in memory or the
   * store cost nothing. Failures go to onError and are retried on a later call.
   */
  async prefetch(keys: readonly TileKey[], concurrency = 2): Promise<void> {
    const queue = [...keys];
    const worker = async () => {
      for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
        await this.getTile(key);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  }

  /** Drop every tile not in `keys` from memory and from the store (if it supports deletion). */
  async retain(keys: readonly TileKey[]): Promise<void> {
    const keep = new Set(keys);
    for (const key of [...this.memory.keys()]) {
      if (!keep.has(key)) this.memory.delete(key);
    }
    for (const key of [...this.failedAt.keys()]) {
      if (!keep.has(key)) this.failedAt.delete(key);
    }
    if (this.store.delete && this.store.keys) {
      const stored = await this.store.keys().catch(() => []);
      await Promise.all(stored.filter((key) => !keep.has(key)).map((key) => this.store.delete!(key).catch(() => undefined)));
    }
  }

  /** Drivable roads with their speed limits in the loaded tiles around the car. Never blocks. */
  speedLimitsNear(fix: LatLon & { heading?: number | null }): SpeedLimitWay[] {
    return dedupeById(this.loaded(fix).flatMap((t) => t.speedLimits ?? []));
  }

  /** Synchronous peek at a loaded tile. */
  peek(key: TileKey): TileData | undefined {
    return this.memory.get(key);
  }

  /** Load a tile through every layer. Resolves null only if nothing at all is available. */
  getTile(key: TileKey): Promise<TileData | null> {
    const mem = this.memory.get(key);
    if (mem && this.isFresh(mem)) return Promise.resolve(mem);

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const failed = this.failedAt.get(key);
    if (mem && failed !== undefined && this.now() - failed < this.retryAfterMs) {
      return Promise.resolve(mem);
    }

    const p = this.load(key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  private loaded(fix: LatLon & { heading?: number | null }, opts?: FeatureFilterOptions): TileData[] {
    return tilesForFix(fix, opts?.maxDistanceM, opts?.maxBearingDeltaDeg)
      .map((key) => this.memory.get(key))
      .filter((t): t is TileData => t !== undefined);
  }

  private isFresh(t: TileData): boolean {
    return t.source === 'network' && this.now() - t.fetchedAt < this.maxAgeMs;
  }

  private async load(key: TileKey): Promise<TileData | null> {
    const raw = await this.store.get(key).catch(() => null);
    const stored = raw && raw.schema === TILE_SCHEMA ? raw : null;
    if (stored && this.isFresh(stored)) {
      this.memory.set(key, stored);
      return stored;
    }

    const failed = this.failedAt.get(key);
    const inBackoff = failed !== undefined && this.now() - failed < this.retryAfterMs;
    if (!inBackoff) {
      try {
        const contents = await this.client.fetchTile(tileBounds(key));
        const data: TileData = { key, schema: TILE_SCHEMA, fetchedAt: this.now(), source: 'network', ...contents };
        this.failedAt.delete(key);
        this.memory.set(key, data);
        await this.store.set(data).catch((err) => this.onError?.(key, err));
        return data;
      } catch (err) {
        this.failedAt.set(key, this.now());
        this.onError?.(key, err);
      }
    }

    // Offline or Overpass down: a stale copy beats bundled data beats nothing.
    const bundled = this.bundled[key];
    const fallback: TileData | null =
      stored ?? (bundled ? { key, schema: TILE_SCHEMA, fetchedAt: 0, source: 'bundled', ...bundled } : null);
    if (fallback) this.memory.set(key, fallback);
    return fallback;
  }
}

function dedupeById<T extends { id: number }>(items: T[]): T[] {
  const seen = new Map<number, T>();
  for (const item of items) seen.set(item.id, item);
  return [...seen.values()];
}
