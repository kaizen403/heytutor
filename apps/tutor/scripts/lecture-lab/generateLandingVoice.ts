/** Use the same provider, voice and delivery settings as a live tutor segment. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { voiceSettingsForDelivery } from '@heytutor/tutor-core';
import { ttsConfig } from '../../lib/tts/providerConfig';
import { requestTts } from '../../lib/tts/ttsProvider';

async function main() {
  const landing = resolve(process.cwd(), '../landing');
  const assetPath = resolve(landing, 'src/components/hero-lesson/lessonAsset.json');
  const asset = JSON.parse(readFileSync(assetPath, 'utf8'));
  const config = ttsConfig('en-IN');
  if (!config.apiKey) throw new Error('The configured tutor speech provider needs an API key');
  const cache = resolve(process.cwd(), '.lecture-lab/hero-voice');
  mkdirSync(cache, { recursive: true });
  let next = 0;
  const paths: string[] = [];
  const durations: number[] = [];
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= asset.segments.length) return;
      const segment = asset.segments[i];
      const settings = voiceSettingsForDelivery(segment.delivery);
      const digest = createHash('sha256').update(JSON.stringify([config.provider, config.model, config.voiceId, settings, segment.narration])).digest('hex').slice(0, 20);
      const audioPath = resolve(cache, `${digest}.wav`);
      const timingPath = resolve(cache, `${digest}.json`);
      if (!existsSync(audioPath) || !existsSync(timingPath)) {
        const response = await requestTts(config, { text: segment.narration, voice_settings: settings }, true);
        if (!response.ok) throw new Error(`Speech request failed (${response.status}) for segment ${i}`);
        const chunks = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
        const audio = chunks.map((chunk) => chunk.audio ?? chunk.audio_base64).filter(Boolean);
        const bytes = Buffer.concat(audio.map((value) => Buffer.from(value, 'base64')));
        if (bytes.length < 1000) throw new Error(`No speech for segment ${i}`);
        writeFileSync(audioPath, bytes);
        const alignment = chunks.find((chunk) => chunk.alignment)?.alignment;
        const starts = alignment?.character_start_times_seconds ?? [];
        const ends = alignment?.character_end_times_seconds ?? [];
        writeFileSync(timingPath, JSON.stringify({
          charStartTimes: starts,
          charDurations: starts.map((start: number, index: number) => Math.max(0, (ends[index] ?? start) - start)),
        }));
      }
      const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', audioPath], { encoding: 'utf8' }).trim());
      if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid audio duration ${i}`);
      durations[i] = duration;
      paths[i] = audioPath;
      segment.timings = { ...JSON.parse(readFileSync(timingPath, 'utf8')), totalDuration: duration };
      console.log(`Speech ${i + 1}/${asset.segments.length}: ${duration.toFixed(2)}s`);
    }
  };
  await Promise.all([worker(), worker()]);
  const out = resolve(landing, 'public/hero');
  mkdirSync(out, { recursive: true });
  const list = resolve(cache, 'concat.txt');
  writeFileSync(list, paths.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join('\n'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '128k', resolve(out, 'lesson.mp3')]);
  const starts: number[] = [];
  let total = 0;
  for (const duration of durations) { starts.push(total); total += duration; }
  asset.voice = { provider: config.provider, model: config.model, voiceKey: config.voiceKey, voiceId: config.voiceId, generatedAt: new Date().toISOString() };
  writeFileSync(assetPath, JSON.stringify(asset, null, 2) + '\n');
  writeFileSync(resolve(out, 'lesson-timings.json'), JSON.stringify({ starts, total }, null, 2) + '\n');
  console.log(`Saved ${total.toFixed(1)}s of the current ${config.provider} tutor voice.`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
