/**
 * Settings → voice wiring. The student picks a language and an accent; that
 * pair must collapse to one voice key, cross the wire, and resolve to the
 * right ElevenLabs voice id on the server — with Indian English as the
 * default and as the fallback for anything unconfigured.
 */
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

console.log("verify-voice-language: language/accent → voice key → voice id wiring is sound");
