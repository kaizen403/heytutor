import { readFileSync } from "node:fs";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { getSegmentCommands, prepareVerifiedLessonSegments } from "@heytutor/drawing";
import assert from "node:assert/strict";
import {
  recordedNarrationLanguage, findSpokenToken, mathToSpeech, isTutorAudioLanguage, normalizeVoiceKey, toVoiceKey, narrationLanguageForVoice,
  buildLessonOpeningSegment, buildGivenValueSegments,
} from "@heytutor/tutor-core";
import { ttsConfig, availableVoiceKeys } from "../../lib/tts/providerConfig";
import { sarvamConfigMessage, requestSarvamWav } from "../../lib/tts/sarvamProtocol";
import { accountSettingsPatch, parseAccountSettings } from "../../lib/account/userSettings";
import { mapAccountSettings } from "../../lib/account/mapUser";
import { buildEarlyLessonOpeningSegment, classifyEarlyLessonProgress } from "../../features/tutor-session/lib/turn/earlyLessonOpening";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

const languages = [
  ["bengali", "bn-IN", /\p{Script=Bengali}/u],
  ["gujarati", "gu-IN", /\p{Script=Gujarati}/u],
  ["kannada", "kn-IN", /\p{Script=Kannada}/u],
  ["malayalam", "ml-IN", /\p{Script=Malayalam}/u],
  ["marathi", "mr-IN", /\p{Script=Devanagari}/u],
  ["odia", "od-IN", /\p{Script=Oriya}/u],
  ["punjabi", "pa-IN", /\p{Script=Gurmukhi}/u],
  ["tamil", "ta-IN", /\p{Script=Tamil}/u],
  ["telugu", "te-IN", /\p{Script=Telugu}/u],
] as const;
const env = { SARVAM_API_KEY: "sarvam-test", CARTESIA_API_KEY: "cartesia-test" };
async function main() {
const fixture: { sceneDocument: SceneDocument; expectedDiagramCommands: unknown } = JSON.parse(readFileSync("scripts/verify/fixtures/launch-l02-primitive-tour.json", "utf8"));
const compiled = compileSceneDocument(fixture.sceneDocument);
assert.ok(compiled.ok && compiled.renderScene);
const originalFetch = globalThis.fetch;
try {
  for (const [language, locale, script] of languages) {
    assert.ok(isTutorAudioLanguage(language), `${language} must be selectable`);
    for (const accent of ["india", "uk", "us"] as const) assert.equal(toVoiceKey(language, accent), locale);
    assert.equal(normalizeVoiceKey(locale), locale);
    assert.equal(narrationLanguageForVoice(locale), language);
    assert.equal(parseAccountSettings({ audioLanguage: language }).audioLanguage, language);
    assert.equal(accountSettingsPatch({ audioLanguage: language }, { hinglishAvailable: true }).audioLanguage, language);
    assert.equal(accountSettingsPatch({ audioLanguage: language }).audioLanguage, undefined);
    assert.equal(mapAccountSettings({ ...parseAccountSettings({ audioLanguage: language }), userId: "test", updatedAt: new Date() }, false).audioLanguage, "english");
    assert.equal(mapAccountSettings({ ...parseAccountSettings({ audioLanguage: language }), userId: "test", updatedAt: new Date() }, true).audioLanguage, language);
    assert.ok(availableVoiceKeys(env).includes(locale));
    assert.ok(!availableVoiceKeys({}).includes(locale));
    const config = ttsConfig(locale, false, env);
    assert.equal(config.provider, "sarvam");
    assert.equal(config.apiKey, "sarvam-test");
    assert.equal(sarvamConfigMessage(config).data.language_code, locale);
    let body: Record<string, unknown> = {};
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ audios: [Buffer.alloc(480).toString("base64")] });
    };
    assert.ok((await requestSarvamWav(config, "x equals 9.", 1, new AbortController().signal)).ok);
    assert.equal(body.language_code, locale);
    assert.equal(body.text, "x equals nine.");
    const presentation = buildVerifiedDiagramPresentation(fixture.sceneDocument, compiled.renderScene, { narrationLanguage: language });
    assert.equal(JSON.stringify(presentation.diagram.commands), JSON.stringify(fixture.expectedDiagramCommands), "language cannot change verified geometry");
    const introText = presentation.introSegments.map((segment) => segment.narration).join(" ");
    assert.match(introText, script);
    assert.equal(recordedNarrationLanguage(introText), language, "saved figure rebuild uses its recorded language");
    for (const segment of presentation.introSegments) {
      for (const command of getSegmentCommands(segment)) {
        assert.ok(command.spokenCue?.token);
        assert.ok(findSpokenToken(mathToSpeech(segment.narration), mathToSpeech(command.spokenCue.token)) >= 0, "figure ink retains a spoken cue");
      }
    }
    const early = buildEarlyLessonOpeningSegment(language);
    const blocked = prepareVerifiedLessonSegments([{ narration: early.narration, command: { type: "WRITE", text: early.narration, params: [90, 110], charPosition: 0, narrationBefore: "" } }], null);
    assert.equal(blocked.segments[0]?.command, null, `${language} writing must stay off the English board`);
    assert.match(early.narration, script);
    assert.equal(classifyEarlyLessonProgress({ earlyOpeningStarted: true, spokenSegments: [early], figureDrawn: false }), "opening_only");
    const opening = buildLessonOpeningSegment({ question: "A body has mass m = 5 kg. Find its weight.", kind: "problem", hasBoardOpening: true, language });
    assert.match(opening!.narration, script);
    const given = buildGivenValueSegments("A body has mass m = 5 kg. Find its weight.", null, { language });
    assert.ok(given.length > 0);
    assert.match(given[0]!.narration, script);
    assert.doesNotMatch(JSON.stringify(given.flatMap((s) => s.commands ?? (s.command ? [s.command] : [])).map((command) => command.text)), script);
    const prompt = buildTurnTeachingPrompt({ question: "Explain inertia.", narrationLanguage: language, diagramPromptAddon: null, turnPlan: null, solverProjection: null, codeLesson: null, isDsa: false, familiarity: "normal", fastMode: true });
    assert.match(prompt.systemPrompt, new RegExp(language, "i"));
    assert.match(prompt.systemPrompt, /English.*math|math.*English/i);
  }
} finally { globalThis.fetch = originalFetch; }
assert.equal(ttsConfig("en-IN", false, env).provider, "cartesia");
assert.equal(ttsConfig("hi-IN", false, env).provider, "sarvam");
console.log("verify-indian-languages: all nine languages preserve settings, narration, board text and speech locales");

}
void main();
