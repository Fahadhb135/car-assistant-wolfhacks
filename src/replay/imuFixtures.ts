import type { ImuSample } from '../core/sensors/types';

type FixtureOptions = Readonly<{
  durationMs?: number;
  samplePeriodMs?: number;
}>;

function buildFixture(
  createVectors: (index: number, timestampMs: number) => Pick<ImuSample, 'accelerationG' | 'angularVelocityDps'>,
  options: FixtureOptions = {},
): readonly ImuSample[] {
  const durationMs = options.durationMs ?? 4_000;
  const samplePeriodMs = options.samplePeriodMs ?? 20;
  const samples: ImuSample[] = [];
  for (let timestampMs = 0, sequence = 0; timestampMs <= durationMs; timestampMs += samplePeriodMs, sequence += 1) {
    samples.push(Object.freeze({
      sequence,
      deviceTimeMs: timestampMs,
      receivedMonotonicMs: timestampMs,
      ...createVectors(sequence, timestampMs),
      frame: 'sensor' as const,
    }));
  }
  return Object.freeze(samples);
}

const quietAngularVelocity = Object.freeze({ x: 0.2, y: -0.1, z: 0.1 });

export function stationaryFixture(options?: FixtureOptions): readonly ImuSample[] {
  return buildFixture(() => ({
    accelerationG: Object.freeze({ x: 0, y: 0, z: 1 }),
    angularVelocityDps: quietAngularVelocity,
  }), options);
}

export function normalMotionFixture(options?: FixtureOptions): readonly ImuSample[] {
  return buildFixture((index) => ({
    accelerationG: Object.freeze({
      x: 0.05 * Math.sin(index / 12),
      y: 0.04 * Math.cos(index / 15),
      z: 1 + 0.02 * Math.sin(index / 20),
    }),
    angularVelocityDps: Object.freeze({ x: 1, y: 0.5, z: 4 * Math.sin(index / 18) }),
  }), options);
}

export function potholeLikeFixture(options?: FixtureOptions): readonly ImuSample[] {
  return buildFixture((index) => ({
    accelerationG: index === 50
      ? Object.freeze({ x: 0.5, y: 0.2, z: 4.5 })
      : Object.freeze({ x: 0, y: 0, z: 1 }),
    angularVelocityDps: index === 50
      ? Object.freeze({ x: 2, y: 3, z: 5 })
      : quietAngularVelocity,
  }), options);
}

export function crashLikeFixture(options?: FixtureOptions): readonly ImuSample[] {
  return buildFixture((index) => {
    const impact = index >= 50 && index <= 55;
    return {
      accelerationG: impact
        ? Object.freeze({ x: 4.5, y: 1, z: 1.2 })
        : Object.freeze({ x: 0, y: 0, z: 1 }),
      angularVelocityDps: impact
        ? Object.freeze({ x: 10, y: 20, z: 90 })
        : quietAngularVelocity,
    };
  }, options);
}

export function repeatedSwerveFixture(options?: FixtureOptions): readonly ImuSample[] {
  return buildFixture((_index, timestampMs) => {
    const phase = Math.floor(timestampMs / 180) % 2 === 0 ? 1 : -1;
    return {
      accelerationG: Object.freeze({ x: phase > 0 ? 1.1 : 0.05, y: 0, z: 1 }),
      angularVelocityDps: Object.freeze({ x: 0, y: 0, z: phase * 65 }),
    };
  }, options);
}
