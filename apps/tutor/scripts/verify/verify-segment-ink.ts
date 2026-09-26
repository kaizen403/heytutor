/**
 * The live lesson and its replay pace a sentence's ink with one function.
 *
 * Replay used to run its own loop: figure parts were given a share of the
 * clip instead of waiting for their cue words, and a FOCUS traced every part
 * at once instead of each on its name. This drives `drawSegmentInk` on a
 * recorded clock with a stored alignment, as replay does, and checks the
 * live behaviour arrives: each figure part starts on its word, and a FOCUS
 * carries a per-part schedule.
 */
import assert from "node:assert/strict";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { getSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import { mathToSpeech, type AudioTimings } from "@heytutor/tutor-core";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { drawSegmentInk, planSegmentInk } from "../../features/tutor-session/lib/turn/segmentInk";
import type { ExecuteCommandOptions } from "../../features/tutor-session/hooks/turn/types";

const question = "A particle's velocity changes from 3 m/s east to 3 m/s west.";
const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "velocity reversal" },
  source: { question, representationTier: "qualitative_verified", nonMetric: true },
  quantities: [],
  entities: [
    { id: "particle", kind: "point", role: "body", label: "m" },
    { id: "vi_end", kind: "point", role: "construction helper" },
    { id: "vf_end", kind: "point", role: "construction helper" },
    { id: "vi_vec", kind: "vector", role: "initial_velocity", label: "v_i" },
    { id: "vf_vec", kind: "vector", role: "final_velocity", label: "v_f" },
  ],
  constructions: [
    { id: "c_particle", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["particle"] },
    { id: "c_vi_end", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "world" }, outputs: ["vi_end"] },
    { id: "c_vf_end", operator: "point", inputs: { x: -3, y: 1, coordinateSpace: "world" }, outputs: ["vf_end"] },
    { id: "c_vi_vec", operator: "vector", inputs: { start: "particle", end: "vi_end" }, outputs: ["vi_vec"] },
    { id: "c_vf_vec", operator: "vector", inputs: { start: "particle", end: "vf_end" }, outputs: ["vf_vec"] },
  ],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["particle", "vi_vec", "vf_vec"],
  revealGroups: [{ id: "setup", entityIds: ["particle", "vi_vec", "vf_vec"], dependsOn: [], narrationCue: "reveal scene" }],
  teachingTimeline: [
    { id: "t1", action: "reveal", targetId: "particle", dependsOn: [], narrationIntent: "reveal particle" },
    { id: "t2", action: "reveal", targetId: "vi_vec", dependsOn: [], narrationIntent: "reveal vi_vec" },
    { id: "t3", action: "reveal", targetId: "vf_vec", dependsOn: [], narrationIntent: "reveal vf_vec" },
  ],
};

/** An alignment at a steady rate, the shape a stored segment carries. */
function steadyTimings(narration: string, msPerChar: number): AudioTimings {
  const spoken = mathToSpeech(narration.trim());
  return {
    charStartTimes: [...spoken].map((_, index) => (index * msPerChar) / 1000),
    charDurations: [...spoken].map(() => msPerChar / 1000),
    totalDuration: (spoken.length * msPerChar) / 1000,
  };
}

/** A recorded clip playing at `speed` times real time, so the check runs quickly. */
function fastClock(speed: number) {
  const startedAt = performance.now();
  return () => (performance.now() - startedAt) * speed;
}

async function main(): Promise<void> {
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, "fixture scene must compile");
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  const intro = presentation.introSegments[0];
  assert.ok(intro, "fixture must have a figure intro");
  const introCommands = getSegmentCommands(intro);
  const narration = intro.narration.trim();
  const plan = planSegmentInk({ commands: introCommands, verifiedDiagramIntro: true, hasNarration: true });
  assert.ok(plan.cuedIntro, "every figure part names the word it is drawn under");

  const msPerChar = 70;
  const timings = steadyTimings(narration, msPerChar);
  const spoken = mathToSpeech(narration);
  const position = fastClock(12);
  const started: Array<{ command: DrawCommand; atMs: number; options: ExecuteCommandOptions }> = [];
  await drawSegmentInk({
    plan,
    verifiedDiagramIntro: true,
    clock: {
      narration,
      getTimings: () => timings,
      totalSpeechMs: timings.totalDuration * 1000,
      estimatedSpeechMs: timings.totalDuration * 1000,
      getAudioPositionMs: position,
      getPlaybackRate: () => 1,
    },
    getDiagram: () => presentation.diagram,
    isCancelled: () => false,
    waitWhilePaused: async () => true,
    execute: async (command, options) => {
      started.push({ command, atMs: position(), options });
    },
    commandOptions: () => ({ applyLayout: false, trustedDiagramGeometry: true }),
  });

  assert.equal(started.length, introCommands.length, "every figure part is drawn");
  let cursor = 0;
  let previousAtMs = -1;
  for (const [index, entry] of started.entries()) {
    const token = entry.command.spokenCue?.token;
    assert.ok(token, "each figure part carries its cue word");
    const wordAt = spoken.toLowerCase().indexOf(mathToSpeech(token).toLowerCase(), cursor);
    assert.ok(wordAt >= 0, `cue word "${token}" is in the sentence`);
    cursor = wordAt;
    const wordStartMs = wordAt * msPerChar;
    assert.ok(entry.atMs >= previousAtMs, "figure parts run in spoken order");
    previousAtMs = entry.atMs;
    if (index === 0) continue;
    assert.ok(
      entry.atMs + 25 >= wordStartMs,
      `"${token}" part started at ${Math.round(entry.atMs)} ms, before its word at ${wordStartMs} ms`,
    );
    assert.equal(entry.options.cued, true, "a part on its word keeps its window instead of the scene ceiling");
  }

  const focusNarration = "the arrow v i points east, and the arrow v f points west.";
  const focusCommand: DrawCommand = {
    type: "FOCUS",
    params: [],
    text: "vi_vec,vf_vec",
    charPosition: 0,
    narrationBefore: focusNarration,
  };
  const focusTimings = steadyTimings(focusNarration, msPerChar);
  let focusOptions: ExecuteCommandOptions | null = null;
  await drawSegmentInk({
    plan: planSegmentInk({ commands: [focusCommand], verifiedDiagramIntro: false, hasNarration: true }),
    verifiedDiagramIntro: false,
    clock: {
      narration: focusNarration,
      getTimings: () => focusTimings,
      totalSpeechMs: focusTimings.totalDuration * 1000,
      estimatedSpeechMs: focusTimings.totalDuration * 1000,
      getAudioPositionMs: fastClock(12),
      getPlaybackRate: () => 1,
    },
    getDiagram: () => presentation.diagram,
    isCancelled: () => false,
    waitWhilePaused: async () => true,
    execute: async (_command, options) => {
      focusOptions = options;
    },
    commandOptions: () => ({ applyLayout: false }),
  });
  const schedule = (focusOptions as ExecuteCommandOptions | null)?.focusSchedule;
  assert.ok(schedule, "a FOCUS on a replayed figure gets the per-part schedule live builds");
  assert.deepEqual(schedule.targets.map((target) => target.id), ["vi_vec", "vf_vec"]);
  assert.ok(
    schedule.targets[1]!.startMs > schedule.targets[0]!.startMs,
    "each part is traced on its own name, not all at the top of the sentence",
  );

  console.log("verify-segment-ink: replayed figures follow their cue words like the live lesson");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
