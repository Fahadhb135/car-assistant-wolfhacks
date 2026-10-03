// Replay demo: a simulated drive through the real coach, crowd hotspots and the voice queue.
//
//   npx tsx scripts/try-hotspots.mts <baseUrl> <lat> <lon> <heading> [driveMeters] [speedMph]
//
// Fetches hotspots from the cloud service (once, like the app does at trip start), loads real
// OpenStreetMap tiles (cached in .cache/tiles/), then "drives" straight along the heading in
// 1-second steps and prints what would be spoken, and when. Nothing is played: the speaker just
// logs, so this runs anywhere.

import { createIdGenerator, toDriveEvent, type DriveEvent } from '../src/core/events/types';
import { HotspotIndex } from '../src/core/coaching/hotspots';
import { LocationCoach } from '../src/core/location/coach';
import { destination } from '../src/core/location/geo';
import { fetchHotspots } from '../src/integrations/backend/hotspotsClient';
import { VoiceCoordinator } from '../src/features/voice/VoiceCoordinator';
import type { Speaker } from '../src/features/voice/types';
import { devTileCache } from './lib/devTileCache';

const MPH = 0.44704;
const [baseUrl, lat, lon, heading, drive = 500, speedMph = 25] = [
  process.argv[2],
  ...process.argv.slice(3).map(Number),
] as [string, number, number, number, number?, number?];
if (!baseUrl || [lat, lon, heading].some((n) => !Number.isFinite(n))) {
  console.error('usage: npx tsx scripts/try-hotspots.mts <baseUrl> <lat> <lon> <heading> [driveMeters] [speedMph]');
  process.exit(1);
}

const snapshot = await fetchHotspots({ baseUrl, lat, lon, radiusM: 5000 });
if (!snapshot) console.log('(no hotspot data: the cloud service was unreachable, so the drive has no hotspot warnings)');
else console.log(`Hotspots from "${snapshot.source}"${snapshot.demo ? ' (includes DEMO data)' : ''}: ${snapshot.hotspots.length}`);
for (const h of snapshot?.hotspots ?? []) {
  console.log(`  ${h.cell}  ${h.drivers} drivers, ${h.bad} incidents, mostly ${h.topKind}`);
}

const cache = devTileCache();
const coach = new LocationCoach();
const hotspots = new HotspotIndex(snapshot ?? { source: 'none', generatedAt: 0, demo: false, hotspots: [] });
const nextId = createIdGenerator('replay-');

let simMs = 0;
let atMeters = 0;
const speaker: Speaker = {
  async speak(u) {
    console.log(`  ${String(atMeters).padStart(5)} m  t=${String(simMs / 1000).padStart(3)}s  SPEAK: "${u.text}"`);
  },
};
const voice = new VoiceCoordinator({
  speaker,
  live: { isActive: () => false, pause() {}, resume() {}, end() {} },
  now: () => simMs,
});

console.log(`\nDriving ${drive} m at ${heading}°, ${speedMph} mph (${(speedMph * MPH).toFixed(1)} m/s)\n`);
const start = { lat, lon, heading };
const speed = speedMph * MPH;
for (let t = 0; t * speed <= drive; t++) {
  simMs = t * 1000;
  atMeters = Math.round(t * speed);
  const fix = { ...destination(start, heading, t * speed), heading, speed, t: simMs };
  await cache.update(fix);
  const inputs = [
    ...hotspots.update(fix),
    ...coach.update(fix, cache.featuresAhead(fix), cache.roadsNear(fix)),
  ];
  for (const input of inputs) {
    const event: DriveEvent = toDriveEvent(input, nextId);
    voice.handleEvent(event);
    await new Promise((r) => setTimeout(r, 0)); // let the voice queue run
  }
}
console.log('\nDone.');
