/**
 * Pick the Hinglish voice by ear.
 *
 * Generates the same teaching lines with several Sarvam bulbul:v3 speakers,
 * writes one MP3 per speaker and line, and prints each line's duration and
 * latency. The durations also calibrate the pen: Sarvam returns no timings,
 * so the estimated schedule needs a speaking rate measured on Hinglish.
 *
 *   node apps/tutor/scripts/live/probe-sarvam-voices.mjs                 # default speakers
 *   node apps/tutor/scripts/live/probe-sarvam-voices.mjs ritu,priya      # chosen speakers
 *
 * Needs SARVAM_API_KEY in apps/tutor/.env.local. Every line spends Sarvam
 * credit (about Rs 3 per 1,000 characters), so keep the set small.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../..");

function readEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const fileEnv = readEnvFile(path.join(APP_ROOT, ".env.local"));
const pick = (name) => process.env[name] || fileEnv[name];

const apiKey = pick("SARVAM_API_KEY");
if (!apiKey) {
  console.error("SARVAM_API_KEY is not set in apps/tutor/.env.local");
  process.exit(1);
}
const model = pick("SARVAM_MODEL") || "bulbul:v3";

const DEFAULT_SPEAKERS = ["ritu", "priya", "neha", "kavya", "shreya", "shruti", "simran", "ishita"];
const speakers = process.argv[2] ? process.argv[2].split(",") : DEFAULT_SPEAKERS;

/** Mixed script, as Sarvam asks: English words in Latin, Hindi words in Devanagari. */
const LINES = [
  { id: "opening", text: "चलो, आज हम Newton के second law को समझते हैं।" },
  { id: "divide", text: "अब हम force को mass से divide करेंगे, तो हमें acceleration मिल जाएगा।" },
  { id: "quadratic", text: "यहाँ x squared minus 5x plus 6 equals zero है, तो roots 2 और 3 होंगे।" },
  { id: "capacitor", text: "Capacitor में stored energy होती है half C V squared, यानी half times 4 microfarad times 50 squared." },
  { id: "answer", text: "तो final answer है 5,000 joules. Simple है ना?" },
];

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "sarvam-voices-"));

function durationSeconds(file) {
  try {
    const out = execFileSync("afinfo", [file], { encoding: "utf8" });
    const match = /estimated duration:\s*([\d.]+)/.exec(out);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

const graphemes = (text) => [...new Intl.Segmenter("hi", { granularity: "grapheme" }).segment(text)].length;
const words = (text) => text.split(/\s+/).filter(Boolean).length;

const rows = [];
for (const speaker of speakers) {
  for (const line of LINES) {
    const startedAt = Date.now();
    const response = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: { "api-subscription-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text: line.text,
        language_code: "hi-IN",
        speaker,
        model,
        pace: 1,
        speech_sample_rate: 24000,
        output_audio_codec: "mp3",
      }),
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      console.error(`${speaker} ${line.id}: HTTP ${response.status} ${await response.text()}`);
      continue;
    }
    const data = await response.json();
    const audio = Buffer.concat((data.audios ?? []).map((part) => Buffer.from(part, "base64")));
    const file = path.join(outDir, `${speaker}-${line.id}.mp3`);
    fs.writeFileSync(file, audio);
    const seconds = durationSeconds(file);
    rows.push({
      speaker,
      line: line.id,
      latencyMs,
      seconds,
      jsLength: line.text.length,
      graphemes: graphemes(line.text),
      words: words(line.text),
    });
  }
}

console.table(rows);
const timed = rows.filter((row) => row.seconds);
const sum = (key) => timed.reduce((total, row) => total + row[key], 0);
const seconds = sum("seconds");
if (seconds > 0) {
  console.log(
    `rate over ${timed.length} clips: ${(sum("jsLength") / seconds).toFixed(2)} code units/s, ` +
      `${(sum("graphemes") / seconds).toFixed(2)} graphemes/s, ${(sum("words") / seconds).toFixed(2)} words/s`,
  );
  const latencies = timed.map((row) => row.latencyMs).sort((a, b) => a - b);
  console.log(`latency p50 ${latencies[Math.floor(latencies.length / 2)]}ms, max ${latencies.at(-1)}ms`);
}
console.log(`\nClips: ${outDir}\nListen:  open ${outDir}`);
