import { File, Paths } from 'expo-file-system';

import { DEFAULT_IMU_TUNING, normalizeTuning, type ImuTuning } from '../../core/imu';

const file = new File(Paths.document, 'imu-tuning.json');
const listeners = new Set<() => void>();
let current: ImuTuning = DEFAULT_IMU_TUNING;
let loaded: Promise<void> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

/** Reads the saved tuning once per app session; later calls return the same promise. */
export function loadImuTuning(): Promise<void> {
  loaded ??= (async () => {
    try {
      if (file.exists) {
        current = normalizeTuning(JSON.parse(await file.text()));
        emit();
      }
    } catch {
      // A corrupt file falls back to the defaults.
    }
  })();
  return loaded;
}

export function getImuTuning(): ImuTuning {
  return current;
}

/** Applies immediately to any running drive and saves for the next one. */
export function setImuTuning(next: ImuTuning): void {
  current = normalizeTuning(next);
  emit();
  try {
    file.create({ overwrite: true, intermediates: true });
    file.write(JSON.stringify(current));
  } catch {
    // Still applied for this session.
  }
}

export function subscribeImuTuning(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
