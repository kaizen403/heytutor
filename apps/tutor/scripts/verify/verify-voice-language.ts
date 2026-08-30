/**
 * Settings → voice wiring. The student picks a language and an accent; that
 * pair must collapse to one voice key, cross the wire, and resolve to the
 * right ElevenLabs voice id on the server — with Indian English as the
 * default and as the fallback for anything unconfigured.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_ACCENT,
  DEFAULT_AUDIO_LANGUAGE,
  DEFAULT_LESSON_DEPTH,
  DEFAULT_VOICE_KEY,
  isLessonDepth,
  isTutorAccent,
  isTutorAudioLanguage,
  LESSON_DEPTH_ADDONS,
  normalizeVoiceKey,
  toVoiceKey,
  TTS_LANG_HEADER,
  TTS_LANG_QUERY,
} from "@heytutor/tutor-core";
import { configuredVoiceKeys, resolveVoiceId } from "../../lib/tts/ttsProxy";

const root = resolve(import.meta.dirname, "../..");

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// --- defaults: Indian English is the product default -----------------------
assert(DEFAULT_AUDIO_LANGUAGE === "english", "default audio language is not English");
assert(DEFAULT_ACCENT === "india", "default accent is not India");
assert(DEFAULT_VOICE_KEY === "en-IN", "default voice key is not en-IN");
assert(
  toVoiceKey(DEFAULT_AUDIO_LANGUAGE, DEFAULT_ACCENT) === "en-IN",
  "the default settings pair does not resolve to Indian English",
);

// --- language + accent collapse to one wire value --------------------------
assert(toVoiceKey("english", "india") === "en-IN", "english/india should be en-IN");
assert(toVoiceKey("english", "uk") === "en-GB", "english/uk should be en-GB");
assert(toVoiceKey("english", "us") === "en-US", "english/us should be en-US");
// Hindi ships one voice, so the accent choice must not fork it.
for (const accent of ["india", "uk", "us"] as const) {
  assert(toVoiceKey("hindi", accent) === "hi-IN", `hindi/${accent} should stay hi-IN`);
}

// --- untrusted wire values fall back rather than going silent --------------
for (const bad of ["", "fr-FR", "en", null, undefined, 42, {}]) {
  assert(
    normalizeVoiceKey(bad) === "en-IN",
    `unrecognised voice key ${JSON.stringify(bad)} did not fall back to en-IN`,
  );
}
assert(normalizeVoiceKey("hi-IN") === "hi-IN", "a valid voice key was rewritten");

// --- settings type guards reject junk from localStorage --------------------
assert(isTutorAudioLanguage("hindi") && !isTutorAudioLanguage("marathi"), "language guard is wrong");
assert(isTutorAccent("uk") && !isTutorAccent("aus"), "accent guard is wrong");
assert(isLessonDepth("thorough") && !isLessonDepth("epic"), "lesson depth guard is wrong");

// --- lesson depth actually changes the teaching prompt ---------------------
assert(DEFAULT_LESSON_DEPTH === "standard", "default lesson depth changed");
assert(LESSON_DEPTH_ADDONS.standard === "", "standard depth must add no prompt text");
for (const depth of ["concise", "thorough"] as const) {
  const addon = LESSON_DEPTH_ADDONS[depth];
  assert(addon.length > 0, `${depth} depth has no prompt addon`);
  assert(
    /overrides any earlier step count/i.test(addon),
    `${depth} depth does not override the earlier step budget, so fast mode would win`,
  );
}
// The ladder from the teaching prompt must survive the shortest setting.
assert(
  /symbols mean/i.test(LESSON_DEPTH_ADDONS.concise) &&
    /substitution/i.test(LESSON_DEPTH_ADDONS.concise),
  "concise depth drops the meaning/substitution rungs instead of only trimming rows",
);

// --- wire constants are stable --------------------------------------------
assert(TTS_LANG_HEADER === "x-tts-lang", "tts language header name changed");
assert(TTS_LANG_QUERY === "lang", "tts language query param changed");

// --- server-side env resolution -------------------------------------------
const saved = {
  en: process.env.ELEVENLABS_VOICE_ID,
  hi: process.env.ELEVENLABS_VOICE_ID_HI,
  gb: process.env.ELEVENLABS_VOICE_ID_EN_GB,
  us: process.env.ELEVENLABS_VOICE_ID_EN_US,
};
process.env.ELEVENLABS_VOICE_ID = "voice_en_in";
process.env.ELEVENLABS_VOICE_ID_HI = "voice_hi_in";
delete process.env.ELEVENLABS_VOICE_ID_EN_GB;
delete process.env.ELEVENLABS_VOICE_ID_EN_US;

assert(resolveVoiceId("en-IN") === "voice_en_in", "en-IN did not resolve to its own voice");
assert(resolveVoiceId("hi-IN") === "voice_hi_in", "hi-IN did not resolve to the Hindi voice");
// An accent with no configured voice must still speak, in the default voice.
assert(
  resolveVoiceId("en-GB") === "voice_en_in" && resolveVoiceId("en-US") === "voice_en_in",
  "an unconfigured accent did not fall back to the default voice",
);
const configured = configuredVoiceKeys();
assert(
  configured.includes("en-IN") && configured.includes("hi-IN") && configured.length === 2,
  `configuredVoiceKeys is wrong: ${JSON.stringify(configured)}`,
);

// A deployment with no voice at all reports nothing rather than a bogus id.
delete process.env.ELEVENLABS_VOICE_ID;
delete process.env.ELEVENLABS_VOICE_ID_HI;
assert(resolveVoiceId("en-IN") === undefined, "resolveVoiceId invented an id with no env set");
assert(configuredVoiceKeys().length === 0, "configuredVoiceKeys reported an unset voice");

process.env.ELEVENLABS_VOICE_ID = saved.en ?? "";
process.env.ELEVENLABS_VOICE_ID_HI = saved.hi ?? "";
if (saved.gb) process.env.ELEVENLABS_VOICE_ID_EN_GB = saved.gb;
if (saved.us) process.env.ELEVENLABS_VOICE_ID_EN_US = saved.us;

// --- student-usable path: pills write, persist, and reach TTS --------------
const settingsDrawer = readFileSync(
  resolve(root, "features/tutor-session/components/SettingsDrawer.tsx"),
  "utf8",
);
assert(!settingsDrawer.includes("Soon"), "Audio Language / Accent must not ship a Soon badge");
assert(!settingsDrawer.includes("subtitleLanguage"), "dead subtitleLanguage field came back");
assert(
  settingsDrawer.includes("Lessons are still written and taught in English"),
  "language pills must not claim they translate the lesson",
);
assert(
  settingsDrawer.includes('onClick={() => update({ audioLanguage: "hindi" })}'),
  "the Hindi pill must change audioLanguage",
);
assert(
  settingsDrawer.includes("disabled={!accentApplies}"),
  "accent pills must stay enabled for English and disable only for Hindi",
);

const shell = readFileSync(
  resolve(root, "features/tutor-session/TutorSessionShell.tsx"),
  "utf8",
);
assert(!shell.includes("subtitleLanguage"), "shell must not keep a dead subtitleLanguage");
for (const key of [
  "htutor_audio_language",
  "htutor_accent",
  "htutor_speed",
  "htutor_marker_color",
] as const) {
  assert(shell.includes(key), `persisted setting ${key} is missing from the shell`);
}
assert(shell.includes("settingsHydrated"), "persist writes must wait until stored settings load");
assert(shell.includes("toVoiceKey(settings.audioLanguage, settings.accent)"), "shell must collapse language+accent");
assert(shell.includes("setVoicePreferences"), "shell must push the voice key into the TTS client");
assert(shell.includes("voicePreferencesRef"), "first TTS create must see the stored voice, not the default");

const boardSession = readFileSync(
  resolve(root, "features/tutor-session/hooks/useBoardSession.ts"),
  "utf8",
);
assert(
  boardSession.includes("voicePreferences: voicePreferencesRef.current"),
  "createTTSClient must receive the stored voice on first create",
);

const httpClient = readFileSync(
  resolve(root, "../../packages/tutor-core/src/tts/elevenLabsClient.ts"),
  "utf8",
);
assert(
  httpClient.includes("[TTS_LANG_HEADER]: voiceKey"),
  "HTTP TTS must send x-tts-lang so /api/tts can pick the voice",
);

const wsClient = readFileSync(
  resolve(root, "../../packages/tutor-core/src/tts/elevenLabsWebSocketClient.ts"),
  "utf8",
);
assert(
  wsClient.includes("${TTS_LANG_QUERY}="),
  "WebSocket TTS must send ?lang= so the relay can pick the voice",
);

const server = readFileSync(resolve(root, "server.ts"), "utf8");
assert(
  server.includes("query.lang") && server.includes("normalizeVoiceKey"),
  "the TTS WebSocket upgrade must read ?lang= and fall back instead of going silent",
);

const ttsRoute = readFileSync(resolve(root, "app/api/tts/route.ts"), "utf8");
const ttsStream = readFileSync(resolve(root, "app/api/tts/stream/route.ts"), "utf8");
assert(
  ttsRoute.includes("voiceKeyFromRequest") && ttsStream.includes("voiceKeyFromRequest"),
  "HTTP TTS routes must resolve the voice from x-tts-lang",
);

const teaching = readFileSync(
  resolve(root, "features/tutor-session/hooks/turn/useQuestionHandler.ts"),
  "utf8",
);
assert(
  !teaching.includes("audioLanguage") && !teaching.includes("toVoiceKey"),
  "teaching must not branch on audio language — voice/accent only, no lesson translation",
);

console.log("verify-voice-language: language/accent → voice key → voice id wiring is sound");
