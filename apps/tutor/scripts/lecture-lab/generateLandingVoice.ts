/** Use the same provider, voice and delivery settings as a live tutor segment. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { voiceSettingsForDelivery } from '@heytutor/tutor-core';
import { ttsConfig } from '../../lib/tts/providerConfig';
import { requestTts } from '../../lib/tts/ttsProvider';

type LandingLocale = 'en-GB' | 'hi-IN';

async function generateLocale(
  locale: LandingLocale,
  asset: { segments: Array<{ narration: string; delivery?: Parameters<typeof voiceSettingsForDelivery>[0] }> },
  narrations: Record<LandingLocale, string[]>,
  landing: string,
) {
  const config = ttsConfig(locale);
  if (!config.apiKey) throw new Error(`The configured ${locale} speech provider needs an API key`);
  const localized = narrations[locale];
  if (localized.length !== asset.segments.length) throw new Error(`${locale} narration does not cover every segment`);

  const cache = resolve(process.cwd(), `.lecture-lab/hero-voice/${locale.toLowerCase()}`);
  mkdirSync(cache, { recursive: true });
  let next = 0;
  const paths: string[] = [];
  const durations: number[] = [];
  const timings: Array<{ charStartTimes: number[]; charDurations: number[]; totalDuration: number }> = [];
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= asset.segments.length) return;
      const segment = asset.segments[i];
      const text = localized[i]!;
      const settings = voiceSettingsForDelivery(segment.delivery);
      const digest = createHash('sha256').update(JSON.stringify([config.provider, config.model, config.voiceId, settings, text])).digest('hex').slice(0, 20);
      const audioPath = resolve(cache, `${digest}.wav`);
      const timingPath = resolve(cache, `${digest}.json`);
      if (!existsSync(audioPath) || !existsSync(timingPath)) {
        const response = await requestTts(config, { text, voice_settings: settings }, true);
        if (!response.ok) throw new Error(`Speech request failed (${response.status}) for ${locale} segment ${i}`);
        const chunks = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
        const audio = chunks.map((chunk) => chunk.audio ?? chunk.audio_base64).filter(Boolean);
        const bytes = Buffer.concat(audio.map((value) => Buffer.from(value, 'base64')));
        if (bytes.length < 1000) throw new Error(`No speech for ${locale} segment ${i}`);
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
      if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid ${locale} audio duration ${i}`);
      const timing = JSON.parse(readFileSync(timingPath, 'utf8'));
      durations[i] = duration;
      paths[i] = audioPath;
      timings[i] = { ...timing, totalDuration: duration };
      console.log(`${locale} speech ${i + 1}/${asset.segments.length}: ${duration.toFixed(2)}s`);
    }
  };
  await Promise.all([worker(), worker()]);
  const out = resolve(landing, 'public/hero');
  mkdirSync(out, { recursive: true });
  const list = resolve(cache, 'concat.txt');
  writeFileSync(list, paths.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join('\n'));
  const slug = locale.toLowerCase();
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '128k', resolve(out, `lesson-${slug}.mp3`)]);
  const starts: number[] = [];
  let total = 0;
  for (const duration of durations) { starts.push(total); total += duration; }
  writeFileSync(resolve(out, `lesson-timings-${slug}.json`), JSON.stringify({
    locale,
    starts,
    total,
    segments: timings,
    voice: { provider: config.provider, model: config.model, voiceKey: config.voiceKey, voiceId: config.voiceId },
  }, null, 2) + '\n');
  console.log(`Saved ${total.toFixed(1)}s of ${locale} ${config.provider} speech.`);
}

async function main() {
  const landing = resolve(process.cwd(), '../landing');
  const assetPath = resolve(landing, 'src/components/hero-lesson/lessonAsset.json');
  const asset = JSON.parse(readFileSync(assetPath, 'utf8'));
  const narrations = JSON.parse(readFileSync(resolve(landing, 'src/components/hero-lesson/lessonNarration.json'), 'utf8'));
  await Promise.all((['en-GB', 'hi-IN'] as LandingLocale[]).map((locale) =>
    generateLocale(locale, asset, narrations, landing),
  ));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
