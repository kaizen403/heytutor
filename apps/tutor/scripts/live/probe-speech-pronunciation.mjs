/**
 * What the student actually hears.
 *
 * Generates each line with the live tutor voice and dials, transcribes the
 * audio back, and prints the two side by side. Pronunciation is the one part
 * of the lesson no unit test can see, so the rules in
 * `packages/tutor-core/src/tts/speechNotation.ts` were all set from this, and
 * the "heard as" notes in `verify-speech-notation` come from its output.
 *
 *   node apps/tutor/scripts/live/probe-speech-pronunciation.mjs            # the default set
 *   node apps/tutor/scripts/live/probe-speech-pronunciation.mjs lines.json # [{id, text}, ...]
 *
 * Needs ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID and optionally
 * ELEVENLABS_STT_API_KEY in apps/tutor/.env.local. It spends ElevenLabs
 * credit, one generation and one transcription per line, so keep the set small.
 *
 * The transcriber writes a spelled letter run as one token, so "m g" comes
 * back as "mg". Read a clean run as "the letters survived", and read a word
 * that is not in the input ("milligrams", "maximum", "mong") as the voice
 * having guessed at an abbreviation.
 */
import fs from "node:fs";
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

const TTS_KEY = pick("ELEVENLABS_API_KEY");
const STT_KEY = pick("ELEVENLABS_STT_API_KEY") || TTS_KEY;
const VOICE_ID = pick("ELEVENLABS_VOICE_ID");
const MODEL_ID = pick("ELEVENLABS_MODEL") || "eleven_multilingual_v2";

if (!TTS_KEY || !VOICE_ID) {
  console.error("set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID (apps/tutor/.env.local)");
  process.exit(1);
}

/** Mirrors TUTOR_VOICE_SETTINGS; a probe on other dials measures another voice. */
const VOICE_SETTINGS = {
  stability: 0.4,
  similarity_boost: 0.75,
  style: 0.35,
  use_speaker_boost: true,
  speed: 0.88,
};

/** The lines that were breaking, taken verbatim from stored lecture transcripts. */
const DEFAULT_LINES = [
  { id: "weight", text: "this arrow is mg sinθ, the part of the weight pulling along the slope." },
  { id: "components", text: "the components mg sinθ and mg cosθ split the weight along and perpendicular to the plane." },
  { id: "cancel", text: "So 4μ mg cosθ equals 2mg sinθ, and mg cancels." },
  { id: "spring", text: "the upward spring force kx must balance the downward weight mg." },
  { id: "units", text: "so v = 20 m/s and the acceleration a = 2 m/s^2." },
  { id: "constant", text: "Here k_e is Coulomb's constant, about 8.99e9 newton meter squared per coulomb squared." },
  { id: "planck", text: "Planck's constant is 6.626e-34 joule seconds." },
  { id: "speeds", text: "the root mean square speed v_rms is larger than the average speed v_avg." },
  { id: "mean", text: "the mean speed <v> depends on temperature, and the magnitude |q| sets the field." },
];

async function synthesize(text, file) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": TTS_KEY, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
  });
  if (!response.ok) {
    throw new Error(`tts ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

async function transcribe(file) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "audio/mpeg" }), path.basename(file));
  form.append("model_id", "scribe_v1");
  form.append("language_code", "eng");
  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": STT_KEY },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`stt ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return ((await response.json()).text || "").trim();
}

const inputPath = process.argv[2];
const lines = inputPath
  ? JSON.parse(fs.readFileSync(inputPath, "utf8")).map((entry, index) =>
      typeof entry === "string" ? { id: String(index), text: entry } : entry)
  : DEFAULT_LINES;

const outDir = path.join(APP_ROOT, ".speech-probe");
fs.mkdirSync(outDir, { recursive: true });

const results = [];
for (const [index, line] of lines.entries()) {
  const file = path.join(outDir, `${String(index).padStart(2, "0")}-${line.id ?? index}.mp3`);
  console.log(`\n[${line.id ?? index}]`);
  console.log(`  said  : ${line.text}`);
  try {
    await synthesize(line.text, file);
    const heard = await transcribe(file);
    console.log(`  heard : ${heard}`);
    results.push({ ...line, heard });
  } catch (error) {
    console.log(`  error : ${error.message}`);
    results.push({ ...line, error: error.message });
  }
}

fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
console.log(`\naudio and results in ${outDir}`);
