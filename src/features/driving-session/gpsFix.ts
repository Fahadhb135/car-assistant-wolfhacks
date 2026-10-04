import type { GpsFix } from '../../core/location/types';

/** The parts of an expo-location reading the coach needs. */
export type LocationReading = Readonly<{
  timestamp: number;
  coords: Readonly<{
    latitude: number;
    longitude: number;
    speed: number | null;
    heading: number | null;
  }>;
}>;

/**
 * expo-location reports a missing or invalid speed/heading as null or a negative number; the coach
 * expects -1 for "unknown" (GpsFix in core/location/types.ts).
 */
export function toGpsFix(reading: LocationReading): GpsFix {
  const { latitude, longitude, speed, heading } = reading.coords;
  return {
    lat: latitude,
    lon: longitude,
    t: reading.timestamp,
    speed: speed == null || speed < 0 ? -1 : speed,
    heading: heading == null || heading < 0 ? -1 : heading,
  };
}
