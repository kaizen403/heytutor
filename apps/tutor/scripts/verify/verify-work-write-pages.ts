/** Captured YouTube 004: one trajectory equation must survive its page turn whole. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import {
  buildLessonSegments,
  getSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
} from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { buildLecturePlayerTimeline } from "../../lib/replay/lecturePlayer";
import { commitWorkRowInk, registerBoardAnchor } from "../../features/tutor-session/lib/board/boardLayout";
import type { useBoardLayout } from "../../features/tutor-session/hooks/useBoardLayout";

const app = path.resolve(import.meta.dirname, "../..");
const hookFile = path.join(app, "features/tutor-session/hooks/useBoardLayout.ts");
// Native React reconciliation and board I/O are the adapters; layout, viewport,
// parser, stored commands and the saved-page consumer remain the actual modules.
const react = {
  useRef: <T>(current: T) => ({ current }),
  useCallback: <T>(callback: T) => callback,
  useState: <T>(initial: T) => [initial, () => {}],
  useEffect: (effect: () => unknown) => { effect(); },
};
function loadHook(file: string): Record<string, unknown> {
  const source = file === hookFile ? process.env.WORK_WRITE_LAYOUT_SOURCE ?? file : file;
  const code = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  const requireHere = createRequire(file);
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "react") return react;
    if (name === "./useBoardViewport") return loadHook(path.join(path.dirname(file), "useBoardViewport.ts"));
    return requireHere(name);
  }, mod, mod.exports);
  return mod.exports;
}
const mountHook = loadHook(hookFile).useBoardLayout as typeof useBoardLayout;

// Source-grounded rows from q09-t1, YouTube 004 (45 degrees, wall 30 m away
// and 10 m high). No planner/model/voice calls are made by this replay.
const captured = `[STEP]Given h and d. [WRITE:Given: h = 10 m, d = 30 m,90,64][/STEP]
[STEP]Gravity. [WRITE:g = 10 m/s^2,90,130][/STEP]
[STEP]Find speed and distance. [WRITE:u_min = ?, b = ?,90,211][/STEP]
[STEP]Launch angle. [WRITE:θ = 45°,90,277][/STEP]
[STEP]Wall distance and height. [WRITE:d = 30 m, h = 10 m,90,343][/STEP]
[STEP]Beyond the wall. [WRITE:b = R - d,90,409][/STEP]
[STEP]The path equation is y equals x tan theta minus g x squared over two u squared cos squared theta.
[WRITE:ideal projectile: y = x tanθ - gx^2/(2u^2cos^2θ),90,475][/STEP]
[STEP]At the wall top. [WRITE:y(d) = h,90,541][/STEP]`;
const segments = buildLessonSegments(captured);
assert.equal(segments.length, 8);

function mountLayout() {
  let erases = 0;
  const nativeBoard = {
    captureSnapshot: () => null,
    eraseWorkInk: async () => { erases += 1; },
  } satisfies Pick<WhiteboardHandle, "captureSnapshot" | "eraseWorkInk">;
  const layout = mountHook({
    whiteboardRef: { current: nativeBoard as unknown as WhiteboardHandle },
    cancelRef: { current: false },
    fbdPhaseStartedRef: { current: true },
    liveQuestionRef: { current: "Captured wall trajectory question" },
    viewportMode: "fixed",
  });
  registerBoardAnchor(layout.boardLayoutRef.current, {
    x: 400, y: 160, width: 760, height: 380, text: "verified figure",
  });
  registerBoardAnchor(layout.boardLayoutRef.current, {
    x: 90, y: 64, width: 100, height: 47, text: "Heading",
  });
  return { layout, erases: () => erases };
}

function storedTurn(commands: DrawCommand[][]): StoredTurn {
  return {
    id: "captured-page-turn", orderIndex: 0, kind: "lesson", status: "complete",
    persistedStatus: "complete", question: "Captured wall trajectory question", rawResponse: captured,
    speedMultiplier: 1, traceId: null, sceneDocument: null, sceneEngineVersion: null,
    validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
    segments: commands.map((rows, orderIndex) => ({
      id: `row-${orderIndex}`, orderIndex, narration: segments[orderIndex]!.narration,
      spokenText: segments[orderIndex]!.narration, durationMs: 2000,
      audioUrl: "/recorded/captured.wav", timings: null,
      command: serializeSegmentCommands(rows),
    })),
  };
}

async function replayPrefix(count: number, mounted = mountLayout()) {
  const saved: DrawCommand[][] = [];
  for (const segment of segments.slice(0, count)) {
    const rows: DrawCommand[] = [];
    for (const command of getSegmentCommands(segment)) {
      rows.push(...await mounted.layout.reserveTextCommandPlacements(command));
    }
    for (const row of rows) commitWorkRowInk(mounted.layout.boardLayoutRef.current, row.text!, row.params[0]!, row.params[1]!);
    saved.push(rows);
  }
  return { ...mounted, saved };
}

async function main() {
  const replay = await replayPrefix(8);
  const timeline = buildLecturePlayerTimeline([storedTurn(replay.saved)]);
  assert.equal(timeline.workPages.length, 2);
  assert.equal(timeline.workPages[0]!.endCueIndex, 5,
    "saved page must end before the trajectory equation, not between its head and tail");
  assert.equal(timeline.workPages[0]!.endCommandCount, 1);
  const formula = timeline.cues[6]!.commands;
  assert.deepEqual(formula.map((row) => row.text), [
    "ideal projectile: y = x tanθ", "- gx^2/(2u^2cos^2θ)",
  ], "every captured term survives parser, reservation and stored timeline");
  assert.deepEqual(formula.map((row) => row.params[1]), [142, 208]);
  assert.equal(timeline.cues[7]!.commands[0]!.params[1], 274,
    "the next equation follows the whole wrapped formula on its new page");
  assert.equal(replay.erases(), 1);
  for (const text of ["Heading", "verified figure", ...formula.map((row) => row.text!)]) {
    assert.ok(replay.layout.boardLayoutRef.current.rects.some((rect) => rect.text === text),
      `the page reservation must retain ${text}`);
  }

  const fitting = await replayPrefix(5);
  await fitting.layout.reserveTextCommandPlacements(getSegmentCommands(segments[6]!)[0]!);
  assert.equal(fitting.erases(), 0, "a whole formula that still fits must not turn early");

  const oneLine = await replayPrefix(6);
  await oneLine.layout.reserveTextCommandPlacements(getSegmentCommands(segments[7]!)[0]!);
  assert.equal(oneLine.erases(), 0, "one remaining slot still accepts an ordinary row");

  const oversized = await replayPrefix(6);
  const longText = Array(80).fill("Projectile").join(" ");
  const rows = await oversized.layout.reserveTextCommandPlacements({
    type: "WRITE", params: [90, 475], text: longText, charPosition: 100, narrationBefore: "A long row",
  });
  assert.equal(rows.map((row) => row.text).join(" "), longText,
    "a WRITE larger than one page must still retain every word");
  assert.ok(oversized.erases() >= 2 && oversized.erases() < 12,
    "an oversized WRITE must finish with bounded ordinary paging");
  console.log("PASS captured trajectory equation stays whole through live reservation and recorded work pages; fitting, ordinary and oversized rows retain their paging");

}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
