import type { LatLon } from '../../core/location/geo.ts';
import type { StopSign } from '../../core/location/overpass.ts';
import { signsAhead, type SignAhead, type SignFilterOptions } from '../../core/location/signFilter.ts';
import { tileBounds, tilesForFix, type TileKey } from '../../core/location/tiles.ts';
import type { OverpassClient } from './overpassClient.ts';

// Stop-sign data per ~1-mile tile, layered: memory → persistent store → Overpass
// → (on failure) a stale stored copy → bundled demo-route data.
//
// The live path never waits on the network: call `update(fix)` on every GPS fix
// to start any fetches it needs (fire and forget), and `signsAhead(fix)` to read
// whatever is already loaded. A tile that fails to load is retried after a
// back-off instead of on every fix.

export type TileData = {
  key: TileKey;
  fetchedAt: number;
  signs: StopSign[];
  source: 'network' | 'bundled';
};

/** Persistent storage for tiles. Back it with SQLite/AsyncStorage in the app. */
export interface TileStore {
  get(key: TileKey): Promise<TileData | null>;
  set(data: TileData): Promise<void>;
}

export class MemoryTileStore implements TileStore {
  private readonly map = new Map<TileKey, TileData>();
  async get(key: TileKey) {
    return this.map.get(key) ?? null;
  }
  async set(data: TileData) {
    this.map.set(data.key, data);
  }
}

export type TileCacheOptions = {
  client: Pick<OverpassClient, 'fetchStopSigns'>;
  store?: TileStore;
  /** Pre-fetched tiles for the demo route, used when the network is unavailable. */
  bundled?: Record<TileKey, StopSign[]>;
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
  private readonly bundled: Record<TileKey, StopSign[]>;
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

  /** Signs ahead of the car among the tiles already loaded. Never blocks. */
  signsAhead(fix: LatLon & { heading?: number | null }, opts?: SignFilterOptions): SignAhead[] {
    const signs = tilesForFix(fix, opts?.maxDistanceM, opts?.maxBearingDeltaDeg).flatMap(
      (key) => this.memory.get(key)?.signs ?? [],
    );
    return signsAhead(fix, signs, opts);
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

  private isFresh(t: TileData): boolean {
    return t.source === 'network' && this.now() - t.fetchedAt < this.maxAgeMs;
  }

  private async load(key: TileKey): Promise<TileData | null> {
    const stored = await this.store.get(key).catch(() => null);
    if (stored && this.isFresh(stored)) {
      this.memory.set(key, stored);
      return stored;
    }

    const failed = this.failedAt.get(key);
    const inBackoff = failed !== undefined && this.now() - failed < this.retryAfterMs;
    if (!inBackoff) {
      try {
        const signs = await this.client.fetchStopSigns(tileBounds(key));
        const data: TileData = { key, fetchedAt: this.now(), signs, source: 'network' };
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
    const fallback =
      stored ??
      (this.bundled[key] ? { key, fetchedAt: 0, signs: this.bundled[key], source: 'bundled' as const } : null);
    if (fallback) this.memory.set(key, fallback);
    return fallback;
  }
}
