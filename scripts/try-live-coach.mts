// End-to-end demo of live coaching: a simulated drive through the real location coach (stop signs,
// stop compliance), crowd hotspots, the voice queue and the live Gemini coach, against a running
// cloud service. Then the trip is uploaded exactly as the app does (every event stamped with where
// the car was, plus what the coach said), so it reaches Databricks.
//
//   npx tsx scripts/try-live-coach.mts <baseUrl> [driverId] [--no-upload]
//
// The car drives north from the given start, makes a full stop at the first stop sign, rolls the
// second at walking pace and drives through the third. Time is simulated (1 fix per second), but
// every Gemini call is real, so the latencies printed are real.

import { HotspotIndex } from '../src/core/coaching/hotspots';
import { createIdGenerator, toDriveEvent, type DriveEvent } from '../src/core/events/types';
import { LocationCoach } from '../src/core/location/coach';
import { destination, distanceM } from '../src/core/location/geo';
import { DriveContext } from '../src/features/driving-session/DriveContext';
import { LiveCoach } from '../src/features/driving-session/LiveCoach';
import { describeEvent } from '../src/features/voice/chat/describeEvent';
import { VoiceCoordinator } from '../src/features/voice/VoiceCoordinator';
import type { Speaker } from '../src/features/voice/types';
import { requestCoachLine } from '../src/integrations/backend/coachClient';
import { fetchHotspots } from '../src/integrations/backend/hotspotsClient';
import { buildCloudTrip, smoothnessScore, submitTrip } from '../src/integrations/backend/tripUpload';
import { devTileCache } from './lib/devTileCache';

const baseUrl = process.argv[2];
const driverId = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'demo-maya';
const upload = !process.argv.includes('--no-upload');
if (!baseUrl) {
  console.error('usage: npx tsx scripts/try-live-coach.mts <baseUrl> [driverId] [--no-upload]');
  process.exit(1);
}

const START = { lat: 35.7826, lon: -78.633 };
const HEADING = 0;
const DRIVE_M = 650;
const CRUISE = 11; // m/s, about 25 mph
const t0 = Date.now();

let simMs = 0;
let atM = 0;
const log = (tag: string, msg: string) =>
  console.log(`${String(Math.round(atM)).padStart(5)} m  t=${String(Math.round(simMs / 1000)).padStart(3)}s  ${tag.padEnd(7)} ${msg}`);

const events: DriveEvent[] = [];
const context = new DriveContext();
const pending: Promise<unknown>[] = [];
let coach: LiveCoach | null = null;

const speaker: Speaker = {
  async speak(u) {
    log(u.deviceVoice ? 'COACH' : 'ALERT', `"${u.text}"${u.deviceVoice ? '  (Apple voice)' : ''}`);
  },
};
const voice = new VoiceCoordinator({
  speaker,
  live: { isActive: () => false, pause() {}, resume() {}, end() {} },
  now: () => simMs,
  onEvent: (e) => {
    context.stamp(e);
    coach?.onEvent(e);
  },
});
coach = new LiveCoach({
  driverId,
  context,
  startedAt: 0,
  now: () => simMs,
  minIntervalMs: 15_000, // shorter than the app's 45 s so a short demo drive gets a few remarks
  recentEvents: () => events,
  smoothness: () => smoothnessScore(events),
  request: (body) => {
    const started = Date.now();
    const p = requestCoachLine({ baseUrl, body }).then((text) => {
      log('GEMINI', `${Date.now() - started} ms for: ${body.trigger}`);
      return text;
    });
    pending.push(p);
    return p;
  },
  speak: (id, text) => voice.speakCoach(id, text),
});

const snapshot = await fetchHotspots({ baseUrl, lat: START.lat, lon: START.lon, radiusM: 5000 });
const hotspots = snapshot ? new HotspotIndex(snapshot) : null;
console.log(`driver ${driverId}; hotspots: ${snapshot ? `${snapshot.hotspots.length} from ${snapshot.source}` : 'unavailable'}\n`);

const cache = devTileCache();
const location = new LocationCoach();
const nextId = createIdGenerator('e2e-');
// The sign the coach last announced, and how to handle it: 1st full stop, 2nd rolling, then through.
let announced = 0;
const queue: { id: number; lat: number; lon: number; mode: 'stop' | 'roll' | 'through' }[] = [];
let stoppedFor = 0;
let speed = CRUISE;

while (atM <= DRIVE_M) {
  const pos = destination(START, HEADING, atM);
  const target = queue[0];
  // Distance along the road to the sign's position (signs sit at the kerb, off the centreline).
  const toSign = target ? Math.max(0, distanceM(START, { lat: target.lat, lon: START.lon }) - atM) : Infinity;
  speed = CRUISE;
  if (target && toSign < 35) {
    if (target.mode === 'stop') {
      speed = toSign < 4 ? (stoppedFor++ < 3 ? 0 : 1.5) : Math.max(1.5, toSign / 4);
    } else if (target.mode === 'roll') {
      speed = 2.2;
    }
  }

  const fix = { ...pos, heading: HEADING, speed, t: t0 + simMs };
  await cache.update(fix);
  context.updateFix(fix, 11.2, 'S Wilmington St');
  const inputs = [...(hotspots?.update(fix) ?? []), ...location.update(fix, cache.featuresAhead(fix), cache.roadsNear(fix))];
  for (const input of inputs) {
    const event = toDriveEvent(input, nextId);
    events.push(event);
    if (event.kind === 'stop_sign_ahead' && event.featureId !== undefined) {
      const sign = cache.featuresAhead(fix).find((f) => f.feature.id === event.featureId)?.feature;
      const mode = (['stop', 'roll'] as const)[announced++] ?? 'through';
      if (sign) queue.push({ id: sign.id, lat: sign.lat, lon: sign.lon, mode });
    }
    if (event.kind === 'stop_ok' || event.kind === 'rolling_stop' || event.kind === 'ran_stop') {
      const i = queue.findIndex((q) => q.id === event.featureId);
      if (i >= 0) queue.splice(i, 1);
      stoppedFor = 0;
    }
    log('EVENT', describeEvent(event));
    voice.handleEvent(event);
    await new Promise((r) => setTimeout(r, 0));
  }
  // Wait for any Gemini call in flight, so its remark lands at the right point of the drive.
  await Promise.all(pending.splice(0));
  await new Promise((r) => setTimeout(r, 0));
  simMs += 1000;
  atM += speed;
}

const trip = buildCloudTrip({
  tripId: `e2e-${Date.now().toString(36)}`,
  driverId,
  start: t0,
  end: t0 + simMs,
  events,
  stampFor: context.stampFor,
  transcript: context.transcript(),
});
console.log(`\ntrip ${trip.tripId}: ${trip.events.length} events (${trip.events.filter((e) => e.lat !== undefined).length} with GPS), ` +
  `${trip.transcript.length} coach lines, smoothness ${trip.scores.smoothness}`);
console.log('kinds:', [...new Set(trip.events.map((e) => e.kind))].join(', '));
if (upload) {
  await submitTrip({ baseUrl, trip });
  console.log(`uploaded to ${baseUrl}/trips (the service pushes it to the Databricks Volume)`);
}
