import { buildTileQuery, parseTile, type OverpassResponse } from '../../core/location/overpass';
import type { BBox } from '../../core/location/tiles';
import type { TileContents } from '../../core/location/types';

// Thin network wrapper around the public Overpass API. Tries each mirror in
// turn, with a per-request timeout, and moves on when a mirror is rate limited
// or overloaded. Callers (the tile cache) handle caching and fallbacks.
//
// overpass-api.de answers HTTP 406 to requests without a descriptive
// User-Agent (default fetch/node agents are rejected), so always send one.

export const DEFAULT_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const DEFAULT_USER_AGENT = 'car-assistant-wolfhacks/0.1 (+https://github.com/Fahadhb135/car-assistant-wolfhacks)';

export type OverpassClientOptions = {
  endpoints?: string[];
  timeoutMs?: number;
  userAgent?: string;
  fetchFn?: typeof fetch;
};

export class OverpassError extends Error {
  readonly failures: string[];
  constructor(message: string, failures: string[]) {
    super(message);
    this.name = 'OverpassError';
    this.failures = failures;
  }
}

export class OverpassClient {
  private readonly endpoints: string[];
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: OverpassClientOptions = {}) {
    this.endpoints = opts.endpoints ?? DEFAULT_ENDPOINTS;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchFn = opts.fetchFn ?? ((...args) => fetch(...args));
  }

  /** Stop signs, traffic lights and highway/ramp ways inside the box. */
  async fetchTile(bbox: BBox): Promise<TileContents> {
    const body = 'data=' + encodeURIComponent(buildTileQuery(bbox));
    const failures: string[] = [];

    for (const url of this.endpoints) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'User-Agent': this.userAgent,
          },
          body,
          signal: controller.signal,
        });
        if (!res.ok) {
          failures.push(`${url}: HTTP ${res.status}`);
          continue;
        }
        return parseTile((await res.json()) as OverpassResponse);
      } catch (err) {
        failures.push(`${url}: ${controller.signal.aborted ? 'timeout' : String(err)}`);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new OverpassError(`All Overpass endpoints failed`, failures);
  }
}
