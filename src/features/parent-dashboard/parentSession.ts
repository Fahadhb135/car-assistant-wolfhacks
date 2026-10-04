import { File, Paths } from 'expo-file-system';

/** The link between this phone and one driver: the viewer token the service gave it. */
export type StoredParentSession = Readonly<{ token: string; driverId: string; shareLocation: boolean }>;

/** Never trusts the file: anything that is not a token plus an id means "not linked". */
export function parseStoredSession(raw: string): StoredParentSession | null {
  try {
    const j = JSON.parse(raw) as Partial<StoredParentSession> | null;
    if (!j || typeof j.token !== 'string' || !j.token || typeof j.driverId !== 'string') return null;
    return { token: j.token, driverId: j.driverId, shareLocation: j.shareLocation === true };
  } catch {
    return null;
  }
}

let cached: StoredParentSession | null | undefined;
const listeners = new Set<() => void>();

const file = () => new File(Paths.document, 'parent-session.json');

export function getParentSession(): StoredParentSession | null {
  if (cached !== undefined) return cached;
  try {
    const f = file();
    cached = f.exists ? parseStoredSession(f.textSync()) : null;
  } catch (err) {
    console.warn('[parent] could not read the saved link:', err);
    cached = null;
  }
  return cached;
}

export function saveParentSession(session: StoredParentSession): void {
  cached = session;
  try {
    const f = file();
    f.create({ overwrite: true });
    f.write(JSON.stringify(session));
  } catch (err) {
    console.warn('[parent] could not save the link (it will last until the app closes):', err);
  }
  listeners.forEach((l) => l());
}

export function clearParentSession(): void {
  cached = null;
  try {
    const f = file();
    if (f.exists) f.delete();
  } catch (err) {
    console.warn('[parent] could not remove the saved link:', err);
  }
  listeners.forEach((l) => l());
}

export function subscribeToParentSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
