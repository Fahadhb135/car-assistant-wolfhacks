import { File, Paths } from 'expo-file-system';

import { getAnonymousDriverId } from './tripStore';

let cached: string | undefined;

/**
 * The anonymous driver id, kept in the app's documents folder so the same driver builds up a
 * history across launches (Databricks trends, the score screen, live coaching). No hardware
 * identifier or personal data is used. EXPO_PUBLIC_DRIVER_ID overrides it, e.g. `demo-maya` to
 * demo with the seeded driver's Databricks history.
 */
export function getDriverId(): string {
  if (cached) return cached;
  const override = process.env.EXPO_PUBLIC_DRIVER_ID?.trim();
  if (override) return (cached = override);
  try {
    const file = new File(Paths.document, 'driver-id.txt');
    if (file.exists) {
      const saved = file.textSync().trim();
      if (saved) return (cached = saved);
    }
    const fresh = getAnonymousDriverId();
    file.create({ overwrite: true });
    file.write(fresh);
    return (cached = fresh);
  } catch (err) {
    console.warn('[driver id] could not persist, using a session id:', err);
    return (cached = getAnonymousDriverId());
  }
}
