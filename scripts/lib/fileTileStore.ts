import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { TileData, TileStore } from '../../src/integrations/location/tileCache';

// Saves tiles to .cache/tiles/ so dev scripts work when Overpass is busy.
// Delete the folder to refetch.

const CACHE_DIR = new URL('../../.cache/tiles/', import.meta.url);
const fileFor = (key: string) => new URL(`${key.replace(':', '_')}.json`, CACHE_DIR);

export class FileTileStore implements TileStore {
  async get(key: string): Promise<TileData | null> {
    try {
      return JSON.parse(await readFile(fileFor(key), 'utf8')) as TileData;
    } catch {
      return null;
    }
  }
  async set(data: TileData): Promise<void> {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(fileFor(data.key), JSON.stringify(data));
  }
}
