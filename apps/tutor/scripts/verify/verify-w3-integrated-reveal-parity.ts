import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import {
  remainingDeferredAnnotations,
  verifiedDiagramCommandToDrawCommand,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import type { SceneDocument } from "@heytutor/scene-engine";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import {
  drawLectureTimeline,
  type ExportExecuteCommand,
} from "../../lib/lecture-export/drawLectureTimeline";
import {
  completeReplayDiagramTurn,
  drawReplayDiagramTimeline,
} from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type { useCommandExecution } from "../../features/tutor-session/hooks/useCommandExecution";
import type { useReplay } from "../../features/tutor-session/hooks/useReplay";

// Run the real executor. Only React reconciliation and the board's asynchronous
// paint adapter are replaced; no browser, provider, database or auth harness.
function loadExecutor(): typeof useCommandExecution {
  const source = fileURLToPath(
    new URL(
      "../../features/tutor-session/hooks/useCommandExecution.ts",
      import.meta.url,
    ),
  );
  const requireApp = createRequire(
    new URL("../../package.json", import.meta.url),
  );
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const mod = {
    exports: {} as { useCommandExecution: typeof useCommandExecution },
  };
  new Function("require", "module", "exports", compiled)(
    (specifier: string) =>
      specifier === "react"
        ? {
            useRef: (current: unknown) => ({ current }),
            useCallback: (fn: unknown) => fn,
          }
        : requireApp(
            specifier.startsWith(".")
              ? path.resolve(path.dirname(source), specifier)
              : specifier,
          ),
    mod,
    mod.exports,
  );
  return mod.exports.useCommandExecution;
}
const executorHook = loadExecutor();
const ref = <T>(current: T) => ({ current });
const recorded = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/w3-saved-coefficient-replay-20261006.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as StoredTurn;

function fixture(turn: StoredTurn) {
  const presentation = restoreVerifiedPresentationFromTurn(turn);
  assert(
    presentation,
    "the actual saved authority must restore without a validation bypass",
  );
  const diagram = presentation.diagram;
  const diagramRef = ref<VerifiedDiagram | null>(diagram);
  const marks: Array<{ text?: string; params: number[]; at: number }> = [];
  let now = 0;
  const board = {
    getInkSettings: () => ({
      markerColor: "#243b75",
      pencilColor: "#243b75",
      markerThickness: 1,
      pencilThickness: 1,
    }),
    setAnimationSpeed: () => {},
    flyCursorTo: async () => {},
    setCursorState: () => {},
    clearBoard: async () => {
      marks.length = 0;
    },
    writeText: async (text: string, x: number, y: number) => {
      marks.push({ text, params: [x, y], at: now });
    },
    drawShape: async () => {},
    drawDimension: async () => {},
    drawAnnotation: async () => {},
    setSpotlight: () => {},
    getTextRows: () => [],
    getPendingWriteCount: () => 0,
  } as unknown as WhiteboardHandle;
  const executor = executorHook({
    whiteboardRef: ref(board),
    cancelRef: ref(false),
    activeVerifiedDiagramRef: diagramRef,
    fbdPhaseStartedRef: ref(true),
    fbdPhaseMarkedRef: ref(false),
    boardLayoutRef: ref({ rects: [], nextY: 100 }),
    inkPaceRef: ref("follow"),
    speedRef: ref(1),
    adaptiveFactorRef: ref(1),
    forceSequentialWorkLayoutRef: ref(false),
    turnTelemetryRef: ref(null),
    notesEpochsRef: ref([]),
    narrationSinceEpochRef: ref(""),
    raceWithCancel: async (promise) => promise,
    resolveTextPlacement: async (_command, x, y) => ({ x, y }),
    cancellableDelay: async () => {},
    forgetErasedTextRects() {},
    resetBoardLayout() {},
    nowMs: () => now,
  });
  // Keep command execution instant in this pure gate; the real timeline still
  // waits on cue boundaries. No timeout is raised or simulated voice requested.
  const execute: ExportExecuteCommand = (command, options) =>
    executor.executeCommand(command, { ...options, durationScale: 0 });
  return {
    diagram,
    diagramRef,
    presentation,
    marks,
    execute,
    clock: {
      getClockMs: () => now,
      waitForAdvance: async () => {
        now += 16;
      },
    },
  };
}

// Parent integrated gate: actual missing-audio hook versus its pinned baseline.
function loadReplay(patched: boolean): typeof useReplay {
  const sourcePath = fileURLToPath(
    new URL("../../features/tutor-session/hooks/useReplay.ts", import.meta.url),
  );
  // The negative control is frozen before parent integration. The positive
  // loads the ACTUAL integrated hook, with no in-memory product patch.
  const source = patched ? readFileSync(sourcePath, "utf8") : execFileSync("git", ["show", "e67bfa1af95da7377651f4cc77ab5400d2bb988e:apps/tutor/features/tutor-session/hooks/useReplay.ts"], {cwd:fileURLToPath(new URL("../../../../",import.meta.url)),encoding:"utf8"});
  const appRoot = fileURLToPath(new URL("../../", import.meta.url));
  const requireApp = createRequire(
    new URL("../../package.json", import.meta.url),
  );
  const mod = { exports: {} as { useReplay: typeof useReplay } };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "module", "exports", compiled)(
    (specifier: string) =>
      specifier === "react"
        ? { useCallback: (fn: unknown) => fn, useEffect: () => {} }
        : requireApp(
            specifier.startsWith("@/")
              ? path.resolve(appRoot, specifier.slice(2))
              : specifier.startsWith(".")
                ? path.resolve(path.dirname(sourcePath), specifier)
                : specifier,
          ),
    mod,
    mod.exports,
  );
  return mod.exports.useReplay;
}

async function fallbackSeek(patched: boolean, ms: number) {
  const turn = structuredClone(recorded);
  const f = fixture(turn);
  const hook = loadReplay(patched)({
    whiteboardRef: ref({ clearBoard: async () => {} } as WhiteboardHandle),
    storedTurnsRef: ref([turn]),
    activeVerifiedDiagramRef: f.diagramRef,
    replayGenerationRef: ref(1),
    cancelRef: ref(false),
    resetBoardLayout: () => {},
    executeCommand: f.execute,
  } as Parameters<typeof useReplay>[0]);
  await hook.renderBoardAtTime(ms, buildReplayTimeline([turn]).cues, 1);
  return f;
}

const labelSet = (f: ReturnType<typeof fixture>) =>
  f.marks.filter((mark) => mark.params[0]! >= 400).map((mark) => mark.text);
const cues = buildReplayTimeline([recorded]).cues;
assert.equal(cues.length, 12);
assert.equal(
  cues
    .flatMap((cue) => cue.commands)
    .filter((command) => command.type === "WRITE").length,
  10,
);
assert.deepEqual(
  cues
    .flatMap((cue) => cue.commands)
    .filter((command) => command.type === "FOCUS")
    .map((command) => command.text),
  ["poly", "poly_power_2"],
);
const before = JSON.stringify(recorded);

async function coefficientRun(flush: boolean) {
  const f = fixture(recorded);
  const options = {
    // Execution captures draw-time ink settings on command objects. Each
    // replay gets its own commands, as a fresh stored-turn load does.
    cues: structuredClone(cues),
    executeCommand: f.execute,
    ...f.clock,
    shouldCancel: () => false,
    getTurn: () => recorded,
    getDiagram: () => f.diagram,
  };
  if (flush) await drawReplayDiagramTimeline(options);
  else await drawLectureTimeline(options);
  return f;
}

// Baseline reproduces the exact screenshot omission through saved timeline +
// actual FOCUS executor, despite the stored scene containing all three rows.
async function main() {
  const broken = await coefficientRun(false);
  assert(!labelSet(broken).includes("64") && !labelSet(broken).includes("192"));
  assert(labelSet(broken).includes("[240]"));
  const missing =
    broken.diagram.deferredAnnotations?.flatMap((entry) => entry.commands) ??
    [];
  assert.deepEqual(
    missing.map((command) => command.text),
    ["0", "64", "1", "192"],
  );

  const fixed = await coefficientRun(true);
  assert.deepEqual(
    labelSet(fixed)
      .filter((text) => ["0", "64", "1", "192", "2", "[240]"].includes(text!))
      .sort(),
    ["0", "1", "192", "2", "64", "[240]"],
  );
  assert(
    fixed.marks
      .filter((mark) => mark.text === "64" || mark.text === "192")
      .every((mark) => mark.at >= cues.at(-1)!.endMs - 10),
    "omitted rows wait for the last cue's speech to finish",
  );
  assert(
    fixed.marks.find((mark) => mark.text === "[240]")!.at <
      cues.at(-1)!.startMs,
    "narrated FOCUS keeps its original position before completion",
  );
  assert.equal(fixed.diagram.deferredAnnotations?.length, 0);
  assert.equal(
    JSON.stringify(recorded),
    before,
    "source document, full caller IR/Plan and stored timeline stay byte-equivalent",
  );

  const fallbackBefore = await fallbackSeek(false, cues.at(-1)!.endMs);
  assert(
    labelSet(fallbackBefore).includes("[240]") &&
      !labelSet(fallbackBefore).includes("64"),
  );
  const fallbackAfter = await fallbackSeek(true, cues.at(-1)!.endMs);
  assert.deepEqual(
    labelSet(fallbackAfter).sort(),
    labelSet(fixed).sort(),
    "parent hook restores the complete diagram through the actual fallback seek",
  );
  const partialSeek = await fallbackSeek(true, cues[9]!.endMs);
  assert(
    !labelSet(partialSeek).includes("64") &&
      !labelSet(partialSeek).includes("192"),
    "seeking within teaching does not flush unmentioned rows",
  );
  assert(
    labelSet(partialSeek).includes("(2+x)^6"),
    "catch-up retains the earlier FOCUS's permanent source labels",
  );
  assert(
    !labelSet(partialSeek).includes("[240]"),
    "catch-up does not advance a later FOCUS",
  );
  assert.equal(
    restoreVerifiedPresentationFromTurn({
      ...recorded,
      question: "A different source question",
    }),
    null,
    "completion has no path around source authority",
  );

  const twoTurns = [
    structuredClone(recorded),
    { ...structuredClone(recorded), id: "next-page", orderIndex: 1 },
  ];
  const multi = fixture(twoTurns[0]!);
  let page = multi;
  const allCues = buildReplayTimeline(twoTurns).cues;
  const started: number[] = [];
  await drawReplayDiagramTimeline({
    cues: allCues,
    executeCommand: (command, options) => page.execute(command, options),
    ...multi.clock,
    shouldCancel: () => false,
    getTurn: (index) => twoTurns[index],
    getDiagram: () => page.diagram,
    onCueStart: (cue, index) => {
      started.push(index);
      if (cue.turnIndex === 1 && cue.segmentIndex === 0) {
        assert(
          labelSet(multi).includes("64") && labelSet(multi).includes("192"),
          "complete the first turn before the next page's first cue",
        );
        page = fixture(twoTurns[1]!);
      }
    },
  });
  assert.deepEqual(
    started,
    allCues.map((_, index) => index),
    "original cue indices and spoken order survive turn completion",
  );
  assert.deepEqual(
    labelSet(page).sort(),
    labelSet(fixed).sort(),
    "each page completes independently",
  );

  // Live completion is the existing public after-turn flush. Compare exact text
  // and coordinates, rather than accepting a command count or a generic ok flag.
  for (const command of remainingDeferredAnnotations(broken.diagram))
    await broken.execute(verifiedDiagramCommandToDrawCommand(command), {
      trustedDiagramGeometry: true,
    });
  assert.deepEqual(
    fixed.marks.map(({ text, params }) => ({ text, params })),
    broken.marks.map(({ text, params }) => ({ text, params })),
  );
  const count = fixed.marks.length;
  await completeReplayDiagramTurn({
    cue: cues.at(-1)!,
    turn: recorded,
    diagram: fixed.diagram,
    executeCommand: fixed.execute,
    shouldCancel: () => false,
  });
  assert.equal(
    fixed.marks.length,
    count,
    "completion is idempotent and does not reletter FOCUS marks",
  );

  for (const mode of ["partial", "cancelled", "doubt", "no-diagram"] as const) {
    const f = fixture(recorded);
    const deferredCount = f.diagram.deferredAnnotations!.length;
    await completeReplayDiagramTurn({
      cue: mode === "partial" ? cues[2]! : cues.at(-1)!,
      nextCue: mode === "partial" ? cues[3] : undefined,
      turn:
        mode === "doubt"
          ? {
              ...recorded,
              segments: recorded.segments.slice(1),
              sceneArtifacts: boardContinuationArtifacts(recorded.question),
            }
          : recorded,
      diagram: mode === "no-diagram" ? null : f.diagram,
      executeCommand: f.execute,
      shouldCancel: () => mode === "cancelled",
    });
    assert.equal(f.marks.length, 0, `${mode} must not release unseen marks`);
    assert.equal(f.diagram.deferredAnnotations!.length, deferredCount);
  }

  // Ordinary geometry uses exactly the same completion: restore and compile two
  // named points and a line, then keep the unnamed point's label until the end.
  const geometryDoc: SceneDocument = {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "two points" },
    source: { question: "Show the segment joining A and B." },
    quantities: [],
    entities: [
      { id: "A", kind: "point", label: "A", role: "endpoint" },
      { id: "B", kind: "point", label: "B", role: "endpoint" },
      { id: "AB", kind: "segment", role: "joining segment" },
    ],
    constructions: [
      { id: "a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["A"] },
      { id: "b", operator: "point", inputs: { x: 4, y: 3 }, outputs: ["B"] },
      {
        id: "ab",
        operator: "segment",
        inputs: { start: "A", end: "B" },
        outputs: ["AB"],
      },
    ],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: ["A", "B", "AB"],
    revealGroups: [
      {
        id: "setup",
        entityIds: ["A", "B", "AB"],
        dependsOn: [],
        narrationCue: "Show the segment.",
      },
    ],
    teachingTimeline: [
      {
        id: "later_name",
        action: "annotate",
        targetId: "B",
        dependsOn: [],
        narrationIntent: "Name the second endpoint later.",
      },
    ],
  };
  const geometry: StoredTurn = {
    ...recorded,
    id: "geometry",
    question: "Show the segment joining A and B.",
    sceneDocument: geometryDoc,
    sceneArtifacts: null,
    segments: [],
  };
  const g = fixture(geometry);
  assert(g.diagram.commands.some((command) => command.type === "DRAW_LINE"));
  assert(
    g.diagram.deferredAnnotations!.some((entry) => entry.entityId === "B"),
    JSON.stringify(g.diagram.deferredAnnotations),
  );
  for (const segment of g.presentation.introSegments) {
    for (const command of segment.commands ?? [])
      await g.execute(command, { trustedDiagramGeometry: true });
  }
  await g.execute({
    type: "FOCUS",
    text: "A",
    params: [],
    charPosition: 0,
    narrationBefore: "",
  });
  assert(labelSet(g).includes("A") && !labelSet(g).includes("B"));
  await completeReplayDiagramTurn({
    cue: cues.at(-1)!,
    turn: geometry,
    diagram: g.diagram,
    executeCommand: g.execute,
    shouldCancel: () => false,
    durationScale: 0,
  });
  assert.deepEqual(labelSet(g).sort(), ["A", "B"]);

  // Cancelling between marks cannot let a stale generation write on a new page.
  const stale = fixture(recorded);
  let writes = 0;
  await completeReplayDiagramTurn({
    cue: cues.at(-1)!,
    turn: recorded,
    diagram: stale.diagram,
    executeCommand: async () => {
      writes++;
    },
    shouldCancel: () => writes > 0,
  });
  assert.equal(writes, 1);

  console.log(
    "verify-w3-integrated-reveal-parity: PASS — actual omission reproduced; exact live/replay marks, end ordering, geometry, FOCUS seek, idempotence and cancellation controls",
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
