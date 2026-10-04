import type { ImuEvent } from '../events/types';
import { DEFAULT_IMU_PIPELINE_CONFIG as D } from './config';
import type { ImuPipelineConfig } from './types';

export type DetectorKey = 'crash' | 'hardBraking' | 'rapidAcceleration' | 'harshCornering' | 'swerve';

export type DetectorTuning = Readonly<{ enabled: boolean; sensitivity: number }>;

/** Live, user-adjustable knobs over the default heuristics. Sensitivity 2 halves every threshold. */
export type ImuTuning = Readonly<{
  detectors: Readonly<Record<DetectorKey, DetectorTuning>>;
  /** Ignore braking/acceleration/cornering/drastic slowing while the board tilts fast. */
  tiltGuard: boolean;
  /** Heading a sharp turn must sweep in one direction. */
  turnHeadingDeg: number;
}>;

export const DETECTOR_KEYS: readonly DetectorKey[] = ['crash', 'hardBraking', 'rapidAcceleration', 'harshCornering', 'swerve'];

export const SENSITIVITY = Object.freeze({ min: 0.5, max: 2, step: 0.1 });
export const TURN_HEADING = Object.freeze({ min: 15, max: 120, step: 15 });

export const DEFAULT_IMU_TUNING: ImuTuning = Object.freeze({
  detectors: Object.freeze({
    crash: { enabled: true, sensitivity: 1 },
    hardBraking: { enabled: true, sensitivity: 1 },
    rapidAcceleration: { enabled: true, sensitivity: 1 },
    harshCornering: { enabled: true, sensitivity: 1 },
    swerve: { enabled: true, sensitivity: 1 },
  }),
  tiltGuard: true,
  turnHeadingDeg: D.behaviors.harshCornering.minimumHeadingChangeDeg,
});

const KIND_BY_DETECTOR: Readonly<Record<DetectorKey, ImuEvent['kind']>> = {
  crash: 'crash_candidate',
  hardBraking: 'hard_braking_candidate',
  rapidAcceleration: 'rapid_acceleration_candidate',
  harshCornering: 'harsh_corner_candidate',
  swerve: 'swerve_candidate',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, step: number) => Math.round(value / step) * step;

export function clampSensitivity(value: number): number {
  return Number(clamp(round(value, SENSITIVITY.step), SENSITIVITY.min, SENSITIVITY.max).toFixed(1));
}

export function clampTurnHeading(value: number): number {
  return clamp(round(value, TURN_HEADING.step), TURN_HEADING.min, TURN_HEADING.max);
}

/** Accepts anything (e.g. a saved file) and returns a complete, in-range tuning. */
export function normalizeTuning(value: unknown): ImuTuning {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<{
    detectors: Partial<Record<DetectorKey, Partial<DetectorTuning>>>;
    tiltGuard: unknown;
    turnHeadingDeg: unknown;
  }>;
  const detectors = {} as Record<DetectorKey, DetectorTuning>;
  for (const key of DETECTOR_KEYS) {
    const saved = input.detectors?.[key];
    detectors[key] = {
      enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : true,
      sensitivity: typeof saved?.sensitivity === 'number' && Number.isFinite(saved.sensitivity)
        ? clampSensitivity(saved.sensitivity)
        : 1,
    };
  }
  return {
    detectors,
    tiltGuard: typeof input.tiltGuard === 'boolean' ? input.tiltGuard : DEFAULT_IMU_TUNING.tiltGuard,
    turnHeadingDeg: typeof input.turnHeadingDeg === 'number' && Number.isFinite(input.turnHeadingDeg)
      ? clampTurnHeading(input.turnHeadingDeg)
      : DEFAULT_IMU_TUNING.turnHeadingDeg,
  };
}

/** The full pipeline config for a tuning: every sensitivity-scaled threshold is the default divided by it. */
export function tuningToConfig(tuning: ImuTuning): ImuPipelineConfig {
  const s = (key: DetectorKey) => tuning.detectors[key].sensitivity;
  const crash = s('crash');
  const brake = s('hardBraking');
  const accelerate = s('rapidAcceleration');
  const corner = s('harshCornering');
  const swerve = s('swerve');
  const crashTrigger = D.crash.triggerAccelerationG / crash;
  return {
    ...D,
    crash: {
      ...D.crash,
      triggerAccelerationG: crashTrigger,
      releaseAccelerationG: Math.min(D.crash.releaseAccelerationG, crashTrigger * 0.9),
      minimumAngularVelocityDps: D.crash.minimumAngularVelocityDps / crash,
    },
    swerve: {
      ...D.swerve,
      minimumRotationStandardDeviationDps: D.swerve.minimumRotationStandardDeviationDps / swerve,
      minimumAccelerationStandardDeviationG: D.swerve.minimumAccelerationStandardDeviationG / swerve,
    },
    behaviors: {
      ...D.behaviors,
      maximumTiltRateDps: tuning.tiltGuard ? D.behaviors.maximumTiltRateDps : 1e9,
      severeDeceleration: {
        ...D.behaviors.severeDeceleration,
        triggerLongitudinalG: D.behaviors.severeDeceleration.triggerLongitudinalG / crash,
        releaseLongitudinalG: D.behaviors.severeDeceleration.releaseLongitudinalG / crash,
        tiltExemptG: D.behaviors.severeDeceleration.tiltExemptG / crash,
      },
      hardBraking: {
        ...D.behaviors.hardBraking,
        triggerLongitudinalG: D.behaviors.hardBraking.triggerLongitudinalG / brake,
        releaseLongitudinalG: D.behaviors.hardBraking.releaseLongitudinalG / brake,
        minimumJerkGps: D.behaviors.hardBraking.minimumJerkGps / brake,
      },
      rapidAcceleration: {
        ...D.behaviors.rapidAcceleration,
        triggerLongitudinalG: D.behaviors.rapidAcceleration.triggerLongitudinalG / accelerate,
        releaseLongitudinalG: D.behaviors.rapidAcceleration.releaseLongitudinalG / accelerate,
        minimumJerkGps: D.behaviors.rapidAcceleration.minimumJerkGps / accelerate,
      },
      harshCornering: {
        ...D.behaviors.harshCornering,
        triggerLateralG: D.behaviors.harshCornering.triggerLateralG / corner,
        releaseLateralG: D.behaviors.harshCornering.releaseLateralG / corner,
        minimumYawRateDps: D.behaviors.harshCornering.minimumYawRateDps / corner,
        releaseYawRateDps: D.behaviors.harshCornering.releaseYawRateDps / corner,
        minimumHeadingChangeDeg: tuning.turnHeadingDeg,
      },
    },
  };
}

/** Event kinds the tuning has switched on. */
export function enabledKinds(tuning: ImuTuning): ReadonlySet<ImuEvent['kind']> {
  return new Set(DETECTOR_KEYS.filter((key) => tuning.detectors[key].enabled).map((key) => KIND_BY_DETECTOR[key]));
}

/** One-line description of what a detector currently needs, for the tuning screen. */
export function describeThreshold(key: DetectorKey, tuning: ImuTuning): string {
  const config = tuningToConfig(tuning);
  const b = config.behaviors;
  switch (key) {
    case 'crash':
      return `impact ≥ ${config.crash.triggerAccelerationG.toFixed(1)} g or slowing ≥ ${b.severeDeceleration.triggerLongitudinalG.toFixed(2)} g`;
    case 'hardBraking':
      return `≥ ${b.hardBraking.triggerLongitudinalG.toFixed(2)} g for ${b.hardBraking.minimumDurationMs} ms, jerk ≥ ${b.hardBraking.minimumJerkGps.toFixed(2)} g/s`;
    case 'rapidAcceleration':
      return `≥ ${b.rapidAcceleration.triggerLongitudinalG.toFixed(2)} g for ${b.rapidAcceleration.minimumDurationMs} ms`;
    case 'harshCornering':
      return `≥ ${b.harshCornering.triggerLateralG.toFixed(2)} g, ≥ ${b.harshCornering.minimumYawRateDps.toFixed(0)}°/s, ≥ ${b.harshCornering.minimumHeadingChangeDeg}° of heading`;
    case 'swerve':
      return `${config.swerve.minimumDirectionChanges} reversals in 2 s, swing ≥ ${config.swerve.minimumRotationStandardDeviationDps.toFixed(0)}°/s`;
  }
}
