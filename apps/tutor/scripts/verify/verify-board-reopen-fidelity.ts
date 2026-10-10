/**
 * A completed page must reopen with the entire engine figure, including
 * measurements teaching never named. Runs the save boundary, production
 * restore hook and command executor against real Konva ink (no paid calls).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import {
  getSegmentCommands,
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  remainingDeferredAnnotations,
  serializeSegmentCommands,
  verifiedDiagramCommandToDrawCommand,
  type DrawCommand,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { boardContinuationArtifacts, pageTurnsEndingAt, storedTurnContinuesBoard } from "../../lib/boards/boardContinuation";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { drawReplayDiagramTimeline } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";

const hooksDir = fileURLToPath(new URL("../../features/tutor-session/hooks/", import.meta.url));
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const ref = <T>(current: T) => ({ current });
const react = {
  useRef: ref, useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(),
  useEffect: () => {}, useLayoutEffect: () => {},
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (value: unknown) => [typeof value === "function" ? value() : value, () => {}],
};
// Hooks are transpiled with inert React reconciliation; their actual bodies,
// dependencies, scene validation, layout, executor and board remain in use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HookResult = Record<string, any>;
const modules = new Map<string, HookResult>();
function hook(file: string): HookResult {
  if (modules.has(file)) return modules.get(file)!;
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as HookResult };
  modules.set(file, mod.exports);
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return react;
    if (specifier.startsWith("@/")) return requireApp(path.resolve(appRoot, specifier.slice(2)));
    if (specifier.startsWith(".")) {
      const target = path.resolve(path.dirname(file), specifier);
      return path.dirname(target) === hooksDir.replace(/\/$/, "") ? hook(`${target}.ts`) : requireApp(target);
    }
    return requireApp(specifier);
  }, mod, mod.exports);
  return mod.exports;
}

function documentFor(question: string, vertical: boolean): SceneDocument {
  const ids = ["a", "b", "edge", "length"];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-grounded measured span" },
    source: { question, nonMetric: true, representationTier: "qualitative_verified" }, quantities: [],
    entities: [
      { id: "a", kind: "point", role: "span start" }, { id: "b", kind: "point", role: "span end" },
      { id: "edge", kind: "segment", role: "measured edge" },
      { id: "length", kind: "dimension", role: "distance", label: "L" },
    ],
    constructions: [
      { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "make_b", operator: "point", inputs: vertical ? { x: 0, y: 4 } : { x: 4, y: 0 }, outputs: ["b"] },
      { id: "make_edge", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["edge"] },
      { id: "make_length", operator: "dimension", inputs: { start: "a", end: "b" }, outputs: ["length"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Here is the segment." }],
    teachingTimeline: [],
  };
}

function ink(board: WhiteboardHandle): string[] {
  const layer = board.getDrawLayer();
  assert(layer, "native board has a draw layer");
  return layer.getChildren().map((node) => {
    const object = node.toObject();
    // Node ids and animation bookkeeping do not describe permanent ink.
    const attrs = Object.fromEntries(Object.entries(object.attrs)
      .filter(([key, value]) => !key.startsWith("ht") && key !== "id" &&
        // Konva serializes a solid stroke as either absent dash or [] after
        // paced drawing has reset its temporary animation dash.
        !(key === "dash" && Array.isArray(value) && value.length === 0))
      .sort(([a], [b]) => a.localeCompare(b)));
    return JSON.stringify({ className: object.className, attrs });
  }).sort();
}

type ContinuationCase = "resume" | "resume-after-doubt" | "absent-scene" | "doubt" | "stopped-resume" | "wrong-page" | "changed-scene" | "changed-then-absent" | "invalid-scene";
async function scenario(vertical: boolean, status: "complete" | "stopped", continuation?: ContinuationCase): Promise<void> {
  const question = vertical ? "A rod has length L. Show the vertical span." : "A segment has length L. Show the horizontal span.";
  const document = documentFor(question, vertical);
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  const withheld = presentation.diagram.deferredAnnotations?.flatMap((entry) => entry.commands) ?? [];
  assert(withheld.some((command) => command.type === "LABEL"), "fixture exercises an unnamed compiled measurement label");
  const saved = await canonicalizeTurnSceneMetadata({
    question, sceneDocument: document, visualStatus: "validated",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", representationTier: "qualitative_verified", nonMetric: true,
      diagramResultStatus: "ready", turnPlan: {
        schemaVersion: "turn-plan/v3", question, givens: [], derived: [], unknowns: [],
        qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
      },
    },
    segments: [...presentation.introSegments, { narration: "The segment is shown.", command: null }].map((segment, orderIndex) => ({
      orderIndex, narration: segment.narration, spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: segment.verifiedDiagramIntro === true }),
    })),
  });
  assert(saved.ok, saved.ok ? "" : saved.error);
  const turn: StoredTurn = {
    ...saved.value, id: "fidelity-turn", orderIndex: 0, status, kind: "lesson", question, rawResponse: "",
    speedMultiplier: 1, traceId: null,
    segments: saved.value.segments.map((segment) => ({
      ...segment, id: `s${segment.orderIndex}`, audioUrl: null, durationMs: null, timings: null,
      command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command), {
        trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command),
      }),
    })),
  };
  // Serialize the admitted turn before the consumer sees it, as reload does.
  const reloaded: StoredTurn = JSON.parse(JSON.stringify(turn));
  const pageTurns = [reloaded];
  if (continuation) {
    const continued = await canonicalizeTurnSceneMetadata({
      question, sceneDocument: document, visualStatus: "validated",
      sceneArtifacts: { ...saved.value.sceneArtifacts, ...boardContinuationArtifacts(continuation === "wrong-page" ? "Another lesson" : question) },
      segments: [{ orderIndex: 0, narration: "We finish the lesson.", spokenText: "We finish the lesson.", command: null }],
    });
    assert(continued.ok, continued.ok ? "" : continued.error);
    const resume: StoredTurn = {
      ...reloaded, ...continued.value, id: "fidelity-continuation", orderIndex: 1,
      kind: continuation === "doubt" ? "doubt" : "resume", status: continuation === "stopped-resume" ? "stopped" : "complete",
      segments: [{ ...reloaded.segments.at(-1)!, id: "continued-speech", command: null }],
    };
    if (continuation === "changed-scene" || continuation === "changed-then-absent") {
      const changed = structuredClone(document);
      changed.constructions.find((item) => item.id === "make_b")!.inputs = { x: 3, y: 3 };
      resume.sceneDocument = changed;
    }
    if (continuation === "absent-scene") resume.sceneDocument = null;
    if (continuation === "invalid-scene") resume.sceneDocument = { schemaVersion: "invalid" };
    if (continuation === "resume-after-doubt") {
      pageTurns.push({ ...resume, id: "intervening-doubt", kind: "doubt", sceneDocument: null, visualStatus: "text_only" });
      resume.orderIndex = 2;
    }
    pageTurns.push(JSON.parse(JSON.stringify(resume)));
    if (continuation === "changed-then-absent") {
      pageTurns.push({ ...resume, id: "absent-scene-after-change", orderIndex: 2, sceneDocument: null });
    }
  }
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const pump = setInterval(() => { clock.advance(1000); clock.pump(); }, 1);
  const whiteboardRef = ref(board);
  const cancelRef = ref(false);
  const activeVerifiedDiagramRef = ref<VerifiedDiagram | null>(presentation.diagram);
  const fbdPhaseStartedRef = ref(true);
  const layout = hook(path.join(hooksDir, "useBoardLayout.ts")).useBoardLayout({ whiteboardRef, cancelRef, fbdPhaseStartedRef, liveQuestionRef: ref(question) });
  const executor = hook(path.join(hooksDir, "useCommandExecution.ts")).useCommandExecution({
    whiteboardRef, cancelRef, speedRef: ref(1), boardLayoutRef: layout.boardLayoutRef,
    forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef, fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef,
    activeVerifiedDiagramRef, turnTelemetryRef: ref(null), notesEpochsRef: layout.notesEpochsRef,
    narrationSinceEpochRef: layout.narrationSinceEpochRef, cancellableDelay: async () => {},
    forgetErasedTextRects: layout.forgetErasedTextRects, resetBoardLayout: layout.resetBoardLayout,
    resolveTextPlacement: layout.resolveTextPlacement, raceWithCancel: async <T>(value: Promise<T>) => value,
    inkPaceRef: ref("follow"), adaptiveFactorRef: ref(1), nowMs: clock.source.now,
  });
  const execute = executor.executeCommand as (command: DrawCommand, options: Record<string, unknown>) => Promise<void>;
  const options = { durationScale: 0, trustedDiagramGeometry: true, applyLayout: false };
  try {
    // The compiled command set is the end-of-lesson ink oracle, independent
    // of intro/reveal scheduling and the persistence consumer.
    for (const command of presentation.diagram.commands) await execute(verifiedDiagramCommandToDrawCommand(command), options);
    const expected = ink(board);
    await board.clearBoard();
    layout.resetBoardLayout(false, false);
    let syncedTurnIndex = -1;
    for (const segment of presentation.introSegments) {
      for (const command of getSegmentCommands(segment)) await execute(command, options);
    }
    const unfinished = ink(board);
    assert(unfinished.length < expected.length, "the gate must expose deferred compiled ink");
    const completesPage = status === "complete" || continuation === "resume" || continuation === "resume-after-doubt" || continuation === "absent-scene";
    if (completesPage) {
      for (const command of remainingDeferredAnnotations(presentation.diagram)) await execute(verifiedDiagramCommandToDrawCommand(command), options);
      assert.deepEqual(ink(board), expected, "live end flush matches all compiled ink");
    }
    const expectedReopen = completesPage ? expected : unfinished;
    const session = hook(path.join(hooksDir, "useBoardSession.ts")).useBoardSession({
      sessionId: "fidelity-board", router: { push() {} }, phase: "idle", speedMultiplier: 1,
      whiteboardRef, cancelRef, activeVerifiedDiagramRef, fbdPhaseStartedRef,
      notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef,
      liveQuestionRef: ref(question), captureNotesEpoch: () => true, ttsClientRef: ref(null),
      voicePreferencesRef: ref({}), speedRef: ref(1), stopTurnRef: ref(null), replayAudioRef: ref(null),
      replayAudioPreloadRef: ref(new Map()), setNarrationText() {}, setCurrentSegmentText() {},
      resetBoardLayout: layout.resetBoardLayout, executeCommand: execute,
    });
    assert(await session.refreshBoardFromTurns("fidelity-board", pageTurns, () => true), "the real reopen consumer finishes");
    const reopened = ink(board);
    assert.deepEqual(reopened, expectedReopen, `${continuation ?? status} ${vertical ? "vertical" : "horizontal"} reopen must preserve its live end ink`);
    await board.clearBoard();
    layout.resetBoardLayout(false, false);
    await drawReplayDiagramTimeline({
      cues: buildReplayTimeline(pageTurns).cues,
      executeCommand: (command, replayOptions) => execute(command, { ...replayOptions, durationScale: 0 }),
      getClockMs: () => Number.MAX_SAFE_INTEGER, waitForAdvance: async () => {}, shouldCancel: () => false,
      getTurn: (turnIndex) => pageTurns[turnIndex],
      getPageTurns: (turnIndex) => pageTurnsEndingAt(pageTurns, turnIndex),
      getDiagram: () => activeVerifiedDiagramRef.current,
      onCueStart: (cue) => {
        if (cue.turnIndex === syncedTurnIndex) return;
        syncedTurnIndex = cue.turnIndex;
        const cueTurn = pageTurns[cue.turnIndex]!;
        if (!storedTurnContinuesBoard(cueTurn)) activeVerifiedDiagramRef.current = restoreVerifiedDiagramFromTurn(cueTurn);
      },
    });
    const replayed = ink(board);
    console.log(JSON.stringify({ orientation: vertical ? "vertical" : "horizontal", status, continuation, compiledNodes: expected.length, liveNodes: expectedReopen.length, reopenedNodes: reopened.length, replayedNodes: replayed.length, withheldCommands: withheld.length }));
    assert.deepEqual(replayed, expectedReopen, `${continuation ?? status} replay timeline must preserve the page's live end ink`);
  } finally {
    clearInterval(pump);
    unmountTestWhiteboard(board);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--resume-only")) {
    await scenario(false, "stopped", "resume");
    return;
  }
  for (const vertical of [false, true]) {
    await scenario(vertical, "complete");
    await scenario(vertical, "stopped");
  }
  for (const continuation of ["resume", "resume-after-doubt", "absent-scene", "doubt", "stopped-resume", "wrong-page", "changed-scene", "changed-then-absent", "invalid-scene"] as const) {
    await scenario(false, "stopped", continuation);
  }
  console.log("board reopen fidelity: complete pages retain compiled ink; stopped pages retain their partial reveal");
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
