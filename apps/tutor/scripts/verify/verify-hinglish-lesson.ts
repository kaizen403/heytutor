/**
 * A Hinglish lesson changes what the student hears and nothing else.
 *
 * The voice decides the narration language; an English lesson's prompts are
 * unchanged; the Hinglish block is the last word in all three teaching
 * prompts; the opening beat is mixed script (Devanagari Hindi, Latin English)
 * with the ask kept in English; a board row in Devanagari never reaches the
 * pen; and a Sarvam sentence, which carries no alignment, reports its WAV
 * length for the rate learner and replay while the pen stays on its estimate.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDevanagariWrite, prepareVerifiedLessonSegments, type DrawCommand } from "@heytutor/drawing";
import {
  HINGLISH_NARRATION_ADDON,
  lessonOpeningLine,
  narrationLanguageForVoice,
  wavDurationSec,
} from "@heytutor/tutor-core";
import {
  buildDoubtTeachingPrompt,
  buildResumeTeachingPrompt,
  buildTurnTeachingPrompt,
} from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import { pcmToWav } from "../../lib/tts/cartesiaProtocol";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "../..");
const DEVANAGARI = /\p{Script=Devanagari}/u;

// --- the voice decides ------------------------------------------------------
assert(narrationLanguageForVoice("hi-IN") === "hinglish", "the Sarvam voice speaks Hinglish");
for (const key of ["en-IN", "en-GB", "en-US", undefined] as const) {
  assert(narrationLanguageForVoice(key) === "english", `${key ?? "no voice"} speaks English`);
}

// --- the addon itself obeys what it asks -------------------------------------
const brackets = HINGLISH_NARRATION_ADDON.match(/\[[^\]]*\]/g) ?? [];
assert(brackets.length >= 6, "the addon shows tagged example steps");
assert(
  brackets.every((tag) => !DEVANAGARI.test(tag)),
  "no Devanagari inside any tag of the addon's examples",
);
const exampleSpeech = HINGLISH_NARRATION_ADDON.split("[STEP]")
  .slice(1)
  .map((step) => step.replace(/\[[^\]]*\]/g, "").replace("[/STEP]", "").trim());
assert(exampleSpeech.length === 3, "three example steps");
for (const line of exampleSpeech) {
  assert(DEVANAGARI.test(line), `example speech mixes in Hindi: ${line}`);
  assert(!/\d/.test(line), `example speech says numbers in English words, never digits: ${line}`);
  assert(!line.includes("।"), `example speech ends sentences with "." not "।": ${line}`);
}

// --- prompts: English unchanged, Hinglish last in all three ----------------
const lessonInput = {
  question: "A ball is thrown up at 20 m/s. Find the maximum height. Take g = 10 m/s^2.",
  diagramPromptAddon: null,
  turnPlan: null,
  solverProjection: null,
  codeLesson: null,
  isDsa: false,
  familiarity: "normal" as const,
  fastMode: true,
};
const english = buildTurnTeachingPrompt(lessonInput);
const explicitEnglish = buildTurnTeachingPrompt({ ...lessonInput, narrationLanguage: "english" });
const hinglish = buildTurnTeachingPrompt({ ...lessonInput, narrationLanguage: "hinglish" });
assert(english.systemPrompt === explicitEnglish.systemPrompt, "English is the default and adds nothing");
assert(!english.systemPrompt.includes("HINGLISH NARRATION"), "an English lesson carries no Hinglish block");
assert(hinglish.runtimeAddon.endsWith(HINGLISH_NARRATION_ADDON), "Hinglish is the last block of a lesson");
assert(hinglish.continuationPrompt.includes("HINGLISH NARRATION"), "continuations stay Hinglish");
assert(
  hinglish.systemPrompt.replace(`\n\n${HINGLISH_NARRATION_ADDON}`, "").replace(hinglish.openingSegment?.narration ?? "", "") ===
    english.systemPrompt.replace(english.openingSegment?.narration ?? "", ""),
  "Hinglish adds its block and changes nothing else in the prompt",
);

const pageInput = {
  boardRows: [{ text: "Given: u = 20 m/s" }],
  rowsLeftOnPage: 3,
  nextRowY: 336,
  diagramPromptAddon: null,
  codePanelShowing: false,
  turnPlan: null,
  solverProjection: null,
  familiarity: "normal" as const,
  fastMode: false,
  lessonQuestion: lessonInput.question,
};
const doubt = buildDoubtTeachingPrompt({ ...pageInput, narrationLanguage: "hinglish" });
assert(doubt.runtimeAddon.endsWith(HINGLISH_NARRATION_ADDON), "a doubt answers in Hinglish too");
assert(!buildDoubtTeachingPrompt(pageInput).runtimeAddon.includes("HINGLISH"), "an English doubt is unchanged");
const resume = buildResumeTeachingPrompt({ ...pageInput, narrationLanguage: "hinglish" });
assert(resume.runtimeAddon.endsWith(HINGLISH_NARRATION_ADDON), "a resumed lesson stays Hinglish");

// --- the opening beat --------------------------------------------------------
const opening = hinglish.openingSegment?.narration ?? "";
assert(DEVANAGARI.test(opening), `the Hinglish opening is Hinglish: ${opening}`);
assert(/maximum height/.test(opening), `the ask stays in the question's English: ${opening}`);
assert(!opening.includes("।") && !/^चलो/.test(opening), `the opening ends on "." and does not lead with चलो: ${opening}`);
assert(!DEVANAGARI.test(english.openingSegment?.narration ?? ""), "the English opening has no Devanagari");
for (const kind of ["problem", "concept", "code"] as const) {
  for (const question of ["explain diffraction", "why does ice float", "draw a ray diagram for a concave mirror", "find x"]) {
    const line = lessonOpeningLine({ question, kind, hasBoardOpening: kind !== "concept", language: "hinglish" });
    assert(DEVANAGARI.test(line) && line.endsWith("."), `${kind} opening for "${question}" is a Hinglish sentence: ${line}`);
    assert(!/\b(ab|hum|karte|chalo|dekho)\b/i.test(line), `no Hindi in Latin letters: ${line}`);
  }
}

// --- the board stays English -------------------------------------------------
const write = (text: string): DrawCommand => ({ type: "WRITE", params: [90, 336], text, charPosition: 0, narrationBefore: "" });
assert(isDevanagariWrite(write("x = नौ")), "a Devanagari row is caught");
assert(!isDevanagariWrite(write("x^2 = 9")), "an English row passes");
const prepared = prepareVerifiedLessonSegments(
  [
    { narration: "तो x squared equals nine.", command: write("x^2 = 9") },
    { narration: "अब इसे लिखो.", command: write("x का मान = 3") },
  ],
  null,
);
assert(prepared.segments[0]?.command?.text === "x^2 = 9", "the English row is kept");
assert(prepared.segments[1]?.command === null && prepared.segments[1]?.narration === "अब इसे लिखो.", "the Devanagari row is dropped, its narration kept");
assert(prepared.blockedCommandCount === 1, "the dropped row is counted as blocked");

// --- duration without alignment ----------------------------------------------
const oneSecond = new Uint8Array(pcmToWav(Buffer.alloc(48_000)));
assert(Math.abs((wavDurationSec(oneSecond) ?? 0) - 1) < 1e-9, "a 24 kHz WAV reports its length");
assert(wavDurationSec(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0])) === null, "MP3 is not guessed at");
assert(wavDurationSec(undefined) === null, "no bytes, no duration");

const client = readFileSync(resolve(root, "../../packages/tutor-core/src/tts/streamingSpeechClient.ts"), "utf8");
assert(
  client.includes("fillDurationFromWav(job.timings, job.capturedChunks);") &&
    client.includes("fillDurationFromWav(timings, capturedChunks);"),
  "both the WebSocket final and the HTTP line fill a missing duration from the WAV",
);
assert(
  client.includes("JSON.stringify({ cancel_segment_index: staleIndex })"),
  "a dropped lookahead sentence is cancelled at the relay, so a serial voice does not speak it first",
);
assert(
  /if \(timings\.totalDuration > 0 \|\| timings\.charStartTimes\.length > 0\) return;/.test(client),
  "a provider's own timings always win over the WAV length",
);
const runner = readFileSync(resolve(root, "features/tutor-session/hooks/turn/useSegmentRunner.ts"), "utf8");
assert(
  runner.includes("if (timings.charStartTimes.length > 0) capturedTimings = timings;"),
  "duration-only timings never replace the pen's estimated schedule",
);

// --- the handler takes the language from the voice ---------------------------
const handler = readFileSync(resolve(root, "features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
assert(
  handler.includes("const turnNarrationLanguage = narrationLanguageForVoice(voicePreferencesRef?.current?.voiceKey);") &&
    (handler.match(/narrationLanguage,/g) ?? []).length >= 2,
  "every teaching prompt gets the narration language of the live voice",
);

// --- settings and voice switches never desync the lesson ----------------------
const shell = readFileSync(resolve(root, "features/tutor-session/TutorSessionShell.tsx"), "utf8");
assert(
  shell.includes("serverSettingsLoadedRef.current ? { ...rest, audioLanguage } : rest") &&
    shell.includes("serverSettingsLoadedRef.current = true;"),
  "a failed settings load cannot PATCH English over a saved Hinglish choice",
);
assert(
  shell.includes("if (switchesLanguage && turnActiveRef.current)") &&
    shell.includes("pendingVoicePreferencesRef.current = voicePreferences;"),
  "a language switch during a lesson waits for the next question",
);
assert(
  handler.indexOf("pendingVoicePreferencesRef.current = null;") > 0 &&
    handler.indexOf("pendingVoicePreferencesRef.current = null;") < handler.indexOf("narrationLanguageForVoice(voicePreferencesRef") &&
    handler.indexOf("narrationLanguageForVoice(voicePreferencesRef") < handler.indexOf("turnActiveRef.current = true;"),
  "a pending switch applies and the language is fixed before the turn goes active, so a switch mid-question waits",
);

console.log("hinglish lesson: voice-led language, prompts, opening, English board, WAV durations passed");
