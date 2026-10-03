import assert from 'node:assert/strict';
import test from 'node:test';
import type { DriveEvent } from '../core/events/types';
import { ImuPipeline } from '../core/imu';
import type { ImuSample } from '../core/sensors/types';
import { ReplaySensorSource } from './ReplaySensorSource';
import {
  crashLikeFixture,
  normalMotionFixture,
  potholeLikeFixture,
  repeatedSwerveFixture,
  stationaryFixture,
} from './imuFixtures';

async function processFixture(samples: readonly ImuSample[]): Promise<readonly DriveEvent[]> {
  const pipeline = new ImuPipeline();
  const events: DriveEvent[] = [];
  const errors: Error[] = [];
  await new ReplaySensorSource(samples).start(
    (sample) => events.push(...pipeline.process(sample).events),
    (error) => errors.push(error),
  );
  assert.deepEqual(errors, []);
  return events;
}

test('stationary and normal replay fixtures emit no candidates', async () => {
  assert.deepEqual(await processFixture(stationaryFixture()), []);
  assert.deepEqual(await processFixture(normalMotionFixture()), []);
});

test('a pothole-like isolated spike does not emit a crash candidate', async () => {
  assert.equal((await processFixture(potholeLikeFixture())).some((event) => event.kind === 'crash_candidate'), false);
});

test('a sustained impact emits exactly one crash candidate', async () => {
  const events = (await processFixture(crashLikeFixture())).filter((event) => event.kind === 'crash_candidate');
  assert.equal(events.length, 1);
  assert.equal(events[0]!.severity, 'critical');
  assert.ok(events[0]!.confidence >= 0 && events[0]!.confidence <= 1);
  assert.ok(events[0]!.evidence.peakAccelerationG! > 3.5);
});

test('repeated rotational motion emits one swerve candidate without overlap flooding', async () => {
  const events = (await processFixture(repeatedSwerveFixture())).filter((event) => event.kind === 'swerve_candidate');
  assert.equal(events.length, 1);
  assert.ok(events[0]!.evidence.rotationAxisDirectionChanges! >= 3);
});

test('replay routes listener errors to the error callback and can be reused', async () => {
  const source = new ReplaySensorSource(stationaryFixture({ durationMs: 40 }));
  const errors: Error[] = [];
  await source.start(() => {
    throw new Error('listener failed');
  }, (error) => errors.push(error));
  assert.equal(errors[0]?.message, 'listener failed');

  let replayed = 0;
  await source.start(() => replayed += 1, (error) => errors.push(error));
  assert.equal(replayed, 3);
});
