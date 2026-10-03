// Generates bundled alert audio once, from your machine. Needs ELEVENLABS_API_KEY
// and ELEVENLABS_VOICE_ID in the environment (e.g. `node --env-file=.env`).
// Never ship the key in the app bundle's build output; only the mp3s are committed.
import { mkdir, writeFile } from 'node:fs/promises';
import { PHRASES } from '../src/features/voice/phrases';

const key = process.env.ELEVENLABS_API_KEY;
const voice = process.env.ELEVENLABS_VOICE_ID;
if (!key || !voice) {
  console.error('Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID');
  process.exit(1);
}

const outDir = new URL('../assets/audio/', import.meta.url);
await mkdir(outDir, { recursive: true });

const manifest: Record<string, string> = {};
for (const [id, text] of Object.entries(PHRASES)) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
    },
  );
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status} ${await res.text()}`);
  const file = `${id}.mp3`;
  await writeFile(new URL(file, outDir), Buffer.from(await res.arrayBuffer()));
  manifest[id] = file;
  console.log('wrote', file);
}
await writeFile(new URL('manifest.json', outDir), JSON.stringify(manifest, null, 2) + '\n');
