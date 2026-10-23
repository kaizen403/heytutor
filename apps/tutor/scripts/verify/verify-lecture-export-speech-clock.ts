/** Recorded cue time must govern estimated ink, including notation expanded for speech. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getSegmentCommands,
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
} from "@heytutor/drawing";
import { compileSceneDocument, validateSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { findSpokenToken, getCueSpeechWindow, mathToSpeech, nextDistinctCueToken } from "@heytutor/tutor-core";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type { ExecuteCommandOptions } from "../../features/tutor-session/hooks/turn/types";
import { createVirtualWhiteboardClock } from "@heytutor/whiteboard";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { drawLectureTimeline } from "../../lib/lecture-export/drawLectureTimeline";
import { lecturePageCacheKey } from "../../lib/lecture-export/canExportLectureMp4";
import { pumpExportClock } from "../../lib/lecture-export/lectureExportTail";

async function main() {
  const narration = "Carry the result onto the fresh page. The speed is 10 m/s after 5 s. The distance is 25 m.";
  const commands = ["s = 25 m", "v = 10 m/s", "area = 25 m"].map(text => ({
    type: "WRITE" as const, text, params: [90, 145, 32], charPosition: 0, narrationBefore: "",
  }));
  for (const durationMs of [null, 6_000]) {
    const turn: StoredTurn = { id: "cue-clock", orderIndex: 0, question: "Recorded notation", rawResponse: "", speedMultiplier: 1,
      traceId: null, sceneDocument: null, sceneEngineVersion: null, validationReport: null,
      visualStatus: "text_only", sceneArtifacts: null,
      segments: [{ id: "row", orderIndex: 0, narration, spokenText: narration,
        command: { commands }, audioUrl: null, durationMs, timings: null }] };
    assert.ok(!lecturePageCacheKey([turn]).endsWith("@video3"), "older files whose speech clock truncated ink are invalidated");
    const timeline = buildReplayTimeline([turn]);
    const clock = createVirtualWhiteboardClock(0);
    const schedules: { text?: string; finalMs: number }[] = [];
    let settled = false;
    const work = drawLectureTimeline({ cues: timeline.cues, getClockMs: clock.now,
      waitForAdvance: clock.waitForAdvance, shouldCancel: () => false,
      executeCommand: async (command, options) => {
        if (options?.explanationPointing) return; // Transient pointer motion is not narrated WRITE ink.
        const schedule = options?.writeSchedule;
        assert.ok(schedule, "estimated speech still supplies a schedule");
        schedules.push({ text: command.text, finalMs: schedule.charStartOffsetsMs.at(-1)! });
      },
    }).finally(() => { settled = true; });
    for (let ms = 0; !settled && ms <= timeline.totalMs + 8_000; ms += 50) {
      clock.setNow(ms); await pumpExportClock(clock);
    }
    await work;
    assert.equal(schedules.length, commands.length);
    for (const schedule of schedules) assert.ok(schedule.finalMs <= timeline.totalMs * 1.12,
      `${durationMs ?? "estimated"}ms cue: ${schedule.text} waits until ${schedule.finalMs}ms outside the existing 12% ink allowance for its ${timeline.totalMs}ms speech window`);
  }
  console.log("verify-lecture-export-speech-clock: persisted and estimated cue windows govern expanded-notation writing");
  await recordedSarvamIntro();
}

/**
 * A recorded Hinglish figure intro, saved through the real persistence path
 * and exported on a Sarvam clock (no word timings), is drawn part by part
 * under its words, and a teaching FOCUS traces on its schedule.
 *
 * Before (19 Oct 2026, v2/p4c-t5): the export scheduler started every shape at
 * 0 ms when a cue had no timings, so all twelve parts of a 28 s intro were down
 * by 6.5 s and the board stood still for 22 s; FOCUS got no schedule.
 */
const recordedDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "recorded-intro");

/** A recorded Hinglish lesson's figure intro, saved through the real persistence path. */
async function saveRecordedHinglishIntro(name: string, teaching: Array<{ narration: string; command: DrawCommand }> = []) {
  const fixture = join(recordedDir, `${name}.scene.json`);
  const validated = validateSceneDocument(JSON.parse(readFileSync(fixture, "utf8")));
  const recorded = validated.document;
  if (!recorded) throw new Error(`${name}: the recorded document no longer validates`);
  // Saved as the source-grounded representation it was taught as; the
  // planner's own "quantitative_verified" tag is not a persisted tier.
  const document: SceneDocument = {
    ...recorded,
    source: { ...recorded.source, representationTier: "qualitative_verified", nonMetric: true },
  };
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, `${name}: the recorded document compiles`);
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene, { narrationLanguage: "hinglish" });
  const question = String(document.source.question ?? "");
  const saved = await canonicalizeTurnSceneMetadata({
    question, sceneDocument: document, visualStatus: "validated",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", representationTier: "qualitative_verified", nonMetric: true,
      diagramResultStatus: "ready",
      // The lesson's recorded TurnPlanV3, which the scene's quantities cite.
      turnPlan: JSON.parse(readFileSync(join(recordedDir, `${name}.turn-plan.json`), "utf8")),
    },
    segments: [
      ...presentation.introSegments.map((segment) => ({
        narration: segment.narration,
        command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }),
      })),
      ...teaching,
    ].map((segment, orderIndex) => ({ orderIndex, spokenText: segment.narration, ...segment })),
  });
  assert.ok(saved.ok, saved.ok ? "" : `${name}: ${saved.error}`);

  // The server rebuilds the intro's ink in the recording's own voice: every
  // part is cued on a word its stored (Hinglish) sentence says. Rebuilt in
  // English, "A to B journey" was cued under a sentence that says
  // "to B journey", and those parts were drawn at the top of it.
  for (const segment of saved.value.segments) {
    if (!isStoredCommandTrustedGeometry(segment.command)) continue;
    const spoken = mathToSpeech(segment.narration);
    for (const command of parseStoredSegmentCommands(segment.command)) {
      assert.ok(command.spokenCue && findSpokenToken(spoken, mathToSpeech(command.spokenCue.token)) >= 0,
        `${name}: saved intro part ${command.type} is cued on "${command.spokenCue?.token}", a word its sentence "${segment.narration}" does not say`);
    }
  }
  return { question, saved: saved.value };
}

async function recordedSarvamIntro(): Promise<void> {
  await saveRecordedHinglishIntro("track-displacement-p1c-t1");
  const focusNarration = "graph पर यह point (4, 20) है जहाँ car twenty meters per second पर पहुँचती है.";
  const { question, saved: savedValue } = await saveRecordedHinglishIntro("vt-graph-car-p4c-t5", [
    { narration: focusNarration, command: { type: "FOCUS", params: [], text: "p1", charPosition: 0, narrationBefore: "" } },
  ]);
  const saved = { value: savedValue };

  // Sarvam returns no alignment; the clip is a little slower than the default rate.
  const turn: StoredTurn = {
    ...saved.value, id: "sarvam-intro", orderIndex: 0, question, rawResponse: "", speedMultiplier: 1, traceId: null,
    segments: saved.value.segments.map((segment) => ({
      ...segment, id: `s${segment.orderIndex}`, audioUrl: null, timings: null,
      durationMs: Math.round(mathToSpeech(segment.narration).length * 95),
    })),
  } as StoredTurn;
  const diagram = restoreVerifiedDiagramFromTurn(turn);
  assert.ok(diagram, "the saved figure restores");
  const timeline = buildReplayTimeline([turn]);
  const clock = createVirtualWhiteboardClock(0);
  const waitClock = async (targetMs: number) => {
    while (clock.now() + 10 < targetMs) await clock.waitForAdvance();
  };
  type Ink = { cue: number; command: DrawCommand; startMs: number; endMs: number; options: ExecuteCommandOptions | undefined };
  const ink: Ink[] = [];
  let activeCue = -1;
  let settled = false;
  const work = drawLectureTimeline({
    cues: timeline.cues, getClockMs: clock.now, waitForAdvance: clock.waitForAdvance, shouldCancel: () => false,
    getDiagram: () => diagram,
    onCueStart: (_cue, index) => { activeCue = index; },
    executeCommand: async (command, options) => {
      const cueStartMs = timeline.cues[activeCue]!.startMs;
      const startMs = clock.now();
      // The pen is busy for the command's budget, or until a trace's last target ends.
      const focusEndMs = options?.focusSchedule?.targets.reduce((end, target) => Math.max(end, target.endMs), 0);
      await waitClock(focusEndMs !== undefined ? cueStartMs + focusEndMs : startMs + Math.max(options?.speechDurationMs ?? 120, 50));
      ink.push({ cue: activeCue, command, startMs, endMs: clock.now(), options });
    },
  }).finally(() => { settled = true; });
  for (let ms = 0; !settled && ms <= timeline.totalMs + 8_000; ms += 50) {
    clock.setNow(ms); await pumpExportClock(clock);
  }
  await work;

  const SLACK_MS = 400;
  const PEN_IDLE_MAX_MS = 6_000;
  let cuedParts = 0;
  timeline.cues.forEach((cue, cueIndex) => {
    if (!cue.trustedDiagramGeometry) return;
    const drawn = ink.filter((entry) => entry.cue === cueIndex);
    assert.equal(drawn.length, cue.commands.length, `intro cue ${cueIndex} draws every part`);
    const spokenChars = mathToSpeech(cue.narration).length;
    let cursor = 0;
    let handFreeMs = 0;
    cue.commands.forEach((command, index) => {
      const entry = drawn[index]!;
      assert.equal(entry.command, command, `intro cue ${cueIndex} keeps its spoken order`);
      const window = getCueSpeechWindow(cue.narration, command.spokenCue!, null, cue.durationMs / spokenChars, cursor,
        nextDistinctCueToken(cue.commands, index));
      cursor = window.cursor;
      const startMs = entry.startMs - cue.startMs;
      if (index > 0) {
        cuedParts += 1;
        assert.ok(startMs >= window.startMs - SLACK_MS,
          `intro cue ${cueIndex}: ${command.type} under "${command.spokenCue!.token}" starts at ${startMs} ms, before its word at ${window.startMs} ms`);
        assert.ok(startMs <= Math.max(window.startMs, handFreeMs) + SLACK_MS,
          `intro cue ${cueIndex}: ${command.type} under "${command.spokenCue!.token}" starts at ${startMs} ms, after its word at ${window.startMs} ms`);
      }
      handFreeMs = entry.endMs - cue.startMs;
    });
    // The pen is never idle long while this sentence is spoken.
    let idleFromMs = cue.startMs;
    let longestIdleMs = 0;
    for (const entry of drawn) {
      longestIdleMs = Math.max(longestIdleMs, entry.startMs - idleFromMs);
      idleFromMs = Math.max(idleFromMs, entry.endMs);
    }
    longestIdleMs = Math.max(longestIdleMs, cue.endMs - idleFromMs);
    assert.ok(longestIdleMs <= PEN_IDLE_MAX_MS,
      `intro cue ${cueIndex} (${cue.durationMs} ms): the pen is idle for ${longestIdleMs} ms while "${cue.narration}" is spoken`);
  });
  assert.ok(cuedParts >= 10, `only ${cuedParts} cued intro parts were checked`);

  const focus = ink.find((entry) => entry.command.type === "FOCUS");
  assert.ok(focus, "the teaching FOCUS is drawn");
  assert.ok(focus.options?.focusSchedule && focus.options.focusSchedule.targets.length > 0,
    "a recorded FOCUS traces on its schedule, as it does live");
  assert.equal(typeof focus.options.getAudioPositionMs, "function", "a recorded FOCUS follows the recording's clock");
  assert.equal(typeof focus.options.waitUntilAudioMs, "function", "a recorded FOCUS waits on the pumped export clock");
  console.log(`verify-lecture-export-speech-clock: Sarvam intro, ${cuedParts} parts on their words, FOCUS on its schedule`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
