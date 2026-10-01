/** Executor-level FOCUS regressions: real Whiteboard, Konva nodes and VirtualCursor. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import type Konva from "konva";
import type { DrawCommand, VerifiedDiagram } from "@heytutor/drawing";
import { clearSpotlight, type SpotlightSpec } from "../../features/tutor-session/lib/board/spotlight";
import type { useCommandExecution as CommandHook } from "../../features/tutor-session/hooks/useCommandExecution";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";

// Only React reconciliation is replaced. Load the actual production executor,
// including its forwarding adapters; its board methods and cursor are real.
function loadExecutor(): typeof CommandHook {
  const source = fileURLToPath(new URL("../../features/tutor-session/hooks/useCommandExecution.ts", import.meta.url));
  const requireApp = createRequire(new URL("../../package.json", import.meta.url));
  const react = {
    useRef: (current: unknown) => ({ current }),
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
    useState: (value: unknown) => [value, () => {}],
  };
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as { useCommandExecution: typeof CommandHook } };
  new Function("require", "module", "exports", compiled)((specifier: string) =>
    specifier === "react" ? react : requireApp(specifier.startsWith(".")
      ? path.resolve(path.dirname(source), specifier) : specifier), mod, mod.exports);
  return mod.exports.useCommandExecution;
}
const hook = loadExecutor();
const ref = <T>(current: T) => ({ current });
const flush = async () => {
  for (let index = 0; index < 40; index++) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (let index = 0; index < 40; index++) await Promise.resolve();
};
function fixture() {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const diagram: VerifiedDiagram = {
    id: "verified_scene", layout: "standard", name: "offline focus",
    anchors: [
      { id: "B", labels: ["B"], x: 700, y: 200, width: 80, height: 80 },
      { id: "C", labels: ["C"], x: 900, y: 300, width: 80, height: 80 },
    ],
    groups: [], reveals: [], promptAddon: "",
    commands: [
      { type: "DRAW_LINE", params: [700, 200, 780, 280], semanticRef: { entityId: "B" } },
      { type: "DRAW_LINE", params: [900, 300, 980, 380], semanticRef: { entityId: "C" } },
    ], deferredAnnotations: [],
  };
  const executor = hook({
    whiteboardRef: ref(board), cancelRef: ref(false), activeVerifiedDiagramRef: ref(diagram),
    fbdPhaseStartedRef: ref(false), fbdPhaseMarkedRef: ref(false),
    boardLayoutRef: ref({ rects: [], nextY: 100 }), inkPaceRef: ref("follow"),
    speedRef: ref(1), adaptiveFactorRef: ref(1), forceSequentialWorkLayoutRef: ref(false),
    turnTelemetryRef: ref(null), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""),
    raceWithCancel: async (promise) => promise,
    resolveTextPlacement: async (_command, x, y) => ({ x, y }),
    cancellableDelay: async () => {}, forgetErasedTextRects() {}, resetBoardLayout() {},
    nowMs: clock.source.now,
  });
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 16) {
      clock.advance(16); clock.pump(); await flush();
    }
  };
  const focus = (id = "B|spotlight"): DrawCommand => ({
    type: "FOCUS", params: [], text: id, semanticRef: { entityId: id },
    charPosition: 0, narrationBefore: "",
  });
  const schedule = (ids = ["B"]) => ({
    focusSchedule: {
      targets: ids.map((id, index) => ({ id, startMs: index * 1200, endMs: index * 1200 + 1000, anchor: "label" as const })),
      matchedCount: ids.length, source: "estimated" as const,
    },
    getAudioPositionMs: () => 1_000_000,
  });
  const veils = () => board.getDrawLayer()!.getStage()!.getChildren()
    .flatMap((layer) => layer.getChildren())
    .filter((node) => node.getClassName() === "Rect" && (node as Konva.Node).getAttr("fill") === "#1A1A1A");
  return { board, diagram, executor, advance, focus, schedule, veils };
}

async function cancellationFlight(mode: "unscheduled" | "code-tour" | "code-spoken-walk" | "deferred-label") {
  const f = fixture();
  if (mode.startsWith("code-")) f.diagram.layout = "code_lesson";
  if (mode === "deferred-label") f.diagram.deferredAnnotations = [{
    entityId: "B", commands: [{
      type: "LABEL", params: [720, 200, 20], text: "B", semanticRef: { entityId: "B" },
    }],
  }];
  let cancelled = false;
  let settled = false;
  const flights: Parameters<typeof f.board.flyCursorTo>[] = [];
  const nativeFly = f.board.flyCursorTo;
  f.board.flyCursorTo = (...args) => { flights.push(args); return nativeFly(...args); };
  const job = f.executor.executeCommandWithCancel(f.focus(mode === "code-spoken-walk" ? "C|spotlight" : undefined), {
    isCancelled: () => cancelled,
    ...(mode === "code-spoken-walk" ? { spokenClock: {
      narration: "B then C", estimatedTotalMs: 4000, getTimings: () => null,
      getAudioPositionMs: () => 0, getPlaybackRate: () => 1,
    } } : {}),
  }).then(() => { settled = true; });
  try {
    await flush();
    assert.equal(flights.length, 1, `${mode}: reach the actual executor flight`);
    if (mode === "deferred-label") assert.equal(flights[0]![3], -35, "lettering keeps its nib rotation");
    f.board.setPaused(true); cancelled = true;
    await f.advance(64);
    console.log(JSON.stringify({ case: mode, predicate: typeof flights[0]![4], settledWhilePaused: settled }));
    assert(settled, `${mode}: focus cancellation joins the real cursor without unpausing`);
    assert.equal(typeof flights[0]![4], "function", `${mode}: cancellation reaches Whiteboard`);
    assert.equal(f.veils().length, 0, `${mode}: cancelled focus removes its own veil`);
  } finally {
    cancelled = true; f.board.cancelAnimations(); await flush(); await job;
    unmountTestWhiteboard(f.board);
  }
}

const SUCCESSOR: SpotlightSpec = {
  veil: { x: 400, y: 100, width: 700, height: 500 },
  hole: { x: 1000, y: 400, width: 60, height: 60 }, opacity: 0.36,
};
type OwnershipCase = "successor-release" | "committed-lease" | "null-spec" | "later-retargeted-lease" | "clear-new-focus" | "code-committed-lease";
async function ownershipCase(kind: OwnershipCase) {
  const f = fixture();
  if (kind === "code-committed-lease") f.diagram.layout = "code_lesson";
  const root = kind.includes("committed") ? f.board.beginDrawTransaction() : null;
  let cancelled = false;
  let successorCancelled = false;
  let settled = false;
  let successorSettled = false;
  let successorJob = Promise.resolve();
  let raises = 0;
  const nativeSpotlight = f.board.setSpotlight;
  f.board.setSpotlight = (spec) => { if (spec) raises++; return nativeSpotlight(spec); };
  const job = f.executor.executeCommandWithCancel(
    f.focus(kind === "null-spec" ? "B|trace" : kind === "later-retargeted-lease" ? "B,C|spotlight" : undefined),
    { ...(kind === "code-committed-lease" ? {} : f.schedule(kind === "later-retargeted-lease" ? ["B", "C"] : undefined)),
      isCancelled: () => cancelled },
  ).then(() => { settled = true; });
  try {
    await flush();
    assert(!settled, "old focus is still executing on the real cursor");
    if (kind === "later-retargeted-lease") {
      for (let elapsed = 0; raises < 3 && elapsed < 3000; elapsed += 16) await f.advance(16);
      assert.equal(raises, 3, "reach the second target's own spotlight installation");
      assert(!settled, "cancel while the later target is still executing");
    }
    const old = f.veils();
    if (kind !== "null-spec") assert(old.length > 0, "old focus installs a veil");
    else assert.equal(old.length, 0, "trace focus owns no veil");
    cancelled = true;
    if (root) f.board.commitDrawTransaction(root);
    if (kind === "clear-new-focus") {
      clearSpotlight(f.board);
      assert.equal(f.veils().length, 0, "explicit teardown remains a deliberate global clear");
      successorJob = f.executor.executeCommandWithCancel(f.focus("C|spotlight"), {
        ...f.schedule(["C"]), isCancelled: () => successorCancelled,
      }).then(() => { successorSettled = true; });
      await flush();
    } else if (!root) {
      f.board.setSpotlight(SUCCESSOR);
    }
    const successor = root ? old : f.veils();
    assert(successor.length > 0, "install the veil that must survive old finally");
    if (!root) assert(!old.some((node) => successor.includes(node)), "successor has independent node identities");
    // Pump a cancelled paused flight. The successor's cursor must stay paused,
    // so the only completed command here is the stale old focus.
    f.board.setPaused(true);
    await f.advance(64);
    assert(settled, "old focus joins cancellation while paused");
    assert(!successorSettled, "successor focus remains active");
    const retained = successor.filter((node) => node.getParent() !== null).length;
    console.log(JSON.stringify({ case: kind, raises, before: successor.length, afterOldFinally: retained }));
    assert.equal(retained, successor.length, `${kind}: stale finally cannot clear successor/committed veil`);
    clearSpotlight(f.board);
    assert.equal(f.veils().length, 0, "global teardown still removes a kept veil");
  } finally {
    cancelled = true; successorCancelled = true;
    f.board.cancelAnimations(); await flush(); await job; await successorJob;
    unmountTestWhiteboard(f.board);
  }
}

const cases: Record<string, () => Promise<void>> = {
  "successor-release": () => ownershipCase("successor-release"),
  "committed-lease": () => ownershipCase("committed-lease"),
  "code-committed-lease": () => ownershipCase("code-committed-lease"),
  "null-spec": () => ownershipCase("null-spec"),
  "later-retargeted-lease": () => ownershipCase("later-retargeted-lease"),
  "clear-new-focus": () => ownershipCase("clear-new-focus"),
  "normal-latest-target": async () => {
    const f = fixture();
    let raises = 0;
    let globalClears = 0;
    let settled = false;
    const nativeSpotlight = f.board.setSpotlight;
    f.board.setSpotlight = (spec) => {
      if (spec) raises++; else globalClears++;
      return nativeSpotlight(spec);
    };
    const job = f.executor.executeCommandWithCancel(f.focus("B,C|spotlight"), { ...f.schedule(["B", "C"]), isCancelled: () => false })
      .then(() => { settled = true; });
    try {
      await flush(); await f.advance(5000);
      assert(settled, "two-target focus finishes normally");
      assert.equal(raises, 3, "union plus both target installations");
      console.log(JSON.stringify({ case: "normal-latest-target", raises, globalClears, remainingVeils: f.veils().length }));
      assert.equal(f.veils().length, 0, "cleanup releases the latest target, not just the union");
      assert.equal(globalClears, 0, "production leases never fall back to global null cleanup");
    } finally { f.board.cancelAnimations(); await flush(); await job; unmountTestWhiteboard(f.board); }
  },
  "unscheduled-flight-cancellation": () => cancellationFlight("unscheduled"),
  "code-tour-flight-cancellation": () => cancellationFlight("code-tour"),
  "code-spoken-walk-flight-cancellation": () => cancellationFlight("code-spoken-walk"),
  "deferred-label-flight-cancellation": () => cancellationFlight("deferred-label"),
  "flight-cancellation": async () => {
    const f = fixture();
    let cancelled = false;
    let settled = false;
    const flights: Parameters<typeof f.board.flyCursorTo>[] = [];
    const fly = f.board.flyCursorTo;
    f.board.flyCursorTo = (...args) => { flights.push(args); return fly(...args); };
    const job = f.executor.executeCommandWithCancel(f.focus(), {
      ...f.schedule(), isCancelled: () => cancelled,
    }).then(() => { settled = true; });
    try {
      await flush();
      assert.equal(flights.length, 1, "reach the actual scheduled executor flight");
      assert(!settled, "the real cursor flight must still be pending");
      f.board.setPaused(true); cancelled = true;
      await f.advance(64);
      console.log(JSON.stringify({ case: "flight-cancellation", predicate: typeof flights[0]![4], settledWhilePaused: settled }));
      assert(settled, "executor forwards cancellation so the real cursor joins while paused");
      assert.equal(typeof flights[0]![4], "function", "the fifth argument reaches Whiteboard");
      assert.equal(f.veils().length, 0, "cancelled focus removes its own veil");
    } finally {
      cancelled = true; f.board.cancelAnimations(); await flush(); await job;
      unmountTestWhiteboard(f.board);
    }
  },
};

async function main() {
  const selected = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7);
  const names = selected ? [selected] : Object.keys(cases);
  for (const name of names) {
    assert(cases[name], `unknown regression: ${name}`);
    await cases[name]!();
    console.log(`PASS ${name}`);
  }
  console.log(`verify-focus-executor-integration: ${names.length} executor regressions passed`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
