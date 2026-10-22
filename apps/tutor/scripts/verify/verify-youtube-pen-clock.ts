/** Real retained lesson cues share the export/player media clock and spoken order. */
import assert from "node:assert/strict";
import { compileSceneDocument, validateSceneDocument } from "@heytutor/scene-engine";
import { getSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import { createVirtualWhiteboardClock } from "@heytutor/whiteboard";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { drawReplayDiagramTimeline } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import { pumpExportClock } from "../../lib/lecture-export/lectureExportTail";
import { lecturePageCacheKey } from "../../lib/lecture-export/canExportLectureMp4";
import type { ReplayCue } from "../../lib/replay/replayTimeline";
import type { ExecuteCommandOptions } from "../../features/tutor-session/hooks/turn/types";
import retained from "./fixtures/youtube-pen/q15.json";

function cue(narration: string, commands: DrawCommand[], durationMs: number, trusted: boolean): ReplayCue {
  return { id: "q15-retained", turnIndex: 0, segmentIndex: 0, startMs: 0, endMs: durationMs,
    durationMs, narration, commands, trustedDiagramGeometry: trusted, audioUrl: null,
    durationMsStored: durationMs, timings: null,
    segment: { id: "q15-retained", orderIndex: 0, narration, spokenText: narration,
      command: { commands, trustedDiagramGeometry: trusted }, audioUrl: null, durationMs, timings: null } };
}
function presentation() {
  const document = validateSceneDocument(retained.sceneDocument).document;
  assert.ok(document, "the retained source parses through the public scene boundary");
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, "the original captured scene still verifies");
  return buildVerifiedDiagramPresentation(document, compiled.renderScene);
}
async function run(captured: ReplayCue, cancelAtMs?: number) {
  const clock = createVirtualWhiteboardClock(0), diagram = presentation().diagram;
  const starts: Array<{ command: DrawCommand; atMs: number; options: ExecuteCommandOptions }> = [];
  let settled = false, cancelled = false;
  // The public caller used by actual MP4 export and the finished player.
  // Observe command admission; adapt only the platform's media-time clock.
  const job = drawReplayDiagramTimeline({ cues: [captured], getClockMs: clock.now,
    waitForAdvance: clock.waitForAdvance, shouldCancel: () => cancelled,
    getTurn: () => undefined, getDiagram: () => diagram,
    executeCommand: async (command, options = {}) => { starts.push({ command, atMs: clock.now(), options }); },
  }).finally(() => { settled = true; });
  for (let ms = 0; !settled && ms <= captured.durationMs + 8_000; ms += 20) {
    cancelled ||= cancelAtMs !== undefined && ms >= cancelAtMs;
    clock.setNow(ms); await pumpExportClock(clock);
  }
  assert.ok(settled, "word waits settle inside the recorded cue and bounded tail");
  await job;
  return starts;
}
async function main() {
  const introSegments = presentation().introSegments;
  const commands = introSegments.flatMap((segment) => getSegmentCommands(segment));
  assert.equal(commands.length, 8, "all original figure marks remain");
  // Main speaks this intro in beats so the pen does not idle. The launch
  // velocity is named in the first beat; the later beats keep the other marks.
  const launch = introSegments[0]!;
  const launchCommands = getSegmentCommands(launch);
  const capturedIntro = cue(launch.narration, launchCommands, retained.introDurationMs, true);
  const starts = await run(capturedIntro);
  assert.equal(starts.length, launchCommands.length, "the launch-velocity beat draws every mark it names");
  assert.ok(starts.at(-1)!.atMs > 5_000,
    "late launch-velocity words retain figure work instead of an early dump and frozen board");
  assert.ok(starts.at(-1)!.atMs < retained.introDurationMs, "the final named part starts during its voice");
  assert.ok(starts.every((entry) => entry.options.cued === true), "the real executor receives word-window budgets");
  // Original segment 8: the recorded live pen writes the early d relation
  // before tracing distance, although source FOCUS precedes WRITE.
  const focus: DrawCommand = { type: "FOCUS", params: [], text: retained.focusTarget,
    charPosition: 29, narrationBefore: "देखो d equals forty meters " };
  const write: DrawCommand = { type: "WRITE", params: [90, 406, 27], text: retained.workText,
    charPosition: 147, narrationBefore: retained.workNarration };
  const work = await run(cue(retained.workNarration, [focus, write], retained.workDurationMs, false));
  assert.deepEqual(work.map((entry) => entry.command.type), ["WRITE", "FOCUS"],
    "a figure gesture cannot hold an earlier spoken work row behind it");
  assert.ok(work[1]!.options.focusSchedule?.targets.some((target) => target.id === retained.focusTarget),
    "the real replay wrapper forwards its verified diagram to the shared FOCUS scheduler");
  const stopped = await run(capturedIntro, 1_000);
  assert.ok(stopped.length < launchCommands.length, "cancelling does not release late figure marks");
  assert.ok(stopped.every((entry) => entry.atMs < 1_000));
  assert.match(lecturePageCacheKey([]), /@render-[a-f0-9]{64}$/, "rendering source content invalidates old timing exports");
  console.log(JSON.stringify({ introStartsMs: starts.map((entry) => entry.atMs),
    workOrder: work.map((entry) => entry.command.type), providerRequests: 0 }));
  console.log("verify-youtube-pen-clock: retained figure words, WRITE/FOCUS order, diagram wiring, cancellation and cache revision");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
