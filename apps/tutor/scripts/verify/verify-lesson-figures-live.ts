/**
 * Lesson figures, live (DIAGRAM_LESSON_FIGURES, lane 5).
 *
 * Mutations this gate catches (brief lane 5 table):
 * (a) allow repeat: LessonFigureSequence.advanceTo accepts an id not strictly
 *     after the current one;
 * (b) skip the erase: the executor's advance branch draws figure k over figure 1;
 * (c) prepare against the static diagram at either call site;
 * (d) print anchor coordinates in the prompt's LATER FIGURES block;
 * (e) drop `!resume` from the uQH planning condition.
 *
 * Lane 8a (round 2 review F2, N6):
 * (f) the executor does not mark the cue's row shown when the advance starts;
 * (g) advanceTo leaves nothing pending (a Stop part way is never finished);
 * (h) uQH `lesson-figure-finish` drops the finish call;
 * (i) savesCommand keeps a cue the cursor never reached;
 * (j) the live save's cut row ignores savesCommand;
 * (k) the refused advance is recorded without its reason.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import type Konva from "konva";
import { getSegmentCommands, prepareVerifiedLessonSegments, type DrawCommand, type TutorSegment, type VerifiedDiagram } from "@heytutor/drawing";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import incline from "./fixtures/lesson-figures-incline-plan.json";
import { deriveSceneGate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { selectFastFigure } from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { planLessonFigures } from "../../features/tutor-session/lib/turn/lessonFigurePlan";
import {
  LessonFigureSequence,
  finishLessonFigureAdvance,
  laterFigurePromptOf,
  lessonFigureIntroCommands,
  prepareLessonFigureSegments,
  savedCommandFilter,
  type LessonFigurePresentation,
  type PlannedLessonFigureView,
} from "../../features/tutor-session/lib/scene/lessonFigureSequence";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { parseStoredSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import { buildTurnTeachingPrompt, laterFiguresPromptAddon } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import type { useCommandExecution as CommandHook } from "../../features/tutor-session/hooks/useCommandExecution";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Fixtures: a real figure 1 (the line y = 2x + 1) and a real figure 2 planned
// by planLessonFigures (the incline's free body diagram), as lane 4 gates them.
// ---------------------------------------------------------------------------

function fastPresentation(plan: TurnPlanV3): { presentation: LessonFigurePresentation; families: string[] } {
  const gate = deriveSceneGate({ question: plan.question, turnPlan: plan, problemIR: null, conversationContext: "" });
  const fast = selectFastFigure({ question: plan.question, turnPlan: plan, authority: null, families: gate.sceneCapabilities.families });
  assert(fast, `the lesson draws a fast figure: ${plan.question.slice(0, 40)}`);
  const presentation = buildVerifiedDiagramPresentation(fast.sceneDocument, fast.renderScene, { originalQuestion: plan.question, turnPlan: plan });
  return { presentation, families: [...gate.sceneCapabilities.families] };
}

const LINE_QUESTION = "Plot the line y = 2x + 1 and find where it crosses the y axis.";
const LINE_PLAN = {
  schemaVersion: "turn-plan/v3", question: LINE_QUESTION, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
} as unknown as TurnPlanV3;

const inclinePlan = validateTurnPlanV3(incline.turnPlan, incline.turnPlan.question).plan;
assert(inclinePlan, "the recorded incline plan validates");
const lesson = fastPresentation(inclinePlan);
const first = fastPresentation(LINE_PLAN).presentation;
const planned = planLessonFigures({
  lessonQuestion: inclinePlan.question, turnPlan: inclinePlan, authority: null, families: lesson.families,
  first: first.diagram, narrationLanguage: "english", deadlineAt: Date.now() + 60_000,
  asks: [{ id: "figure_2", ask: "free body diagram of the block" }],
});
assert.equal(planned.figures.length, 1, `figure 2 draws: ${JSON.stringify(planned.misses)}`);
const view2: PlannedLessonFigureView = {
  id: "figure_2",
  diagram: planned.figures[0]!.presentation.diagram,
  introSegments: planned.figures[0]!.presentation.introSegments,
  family: planned.figures[0]!.representation.family ?? null,
};
/** A later figure that is only a copy, so a forward-only figure_3 exists. */
const view3: PlannedLessonFigureView = { ...view2, id: "figure_3" };

function committed(rest: readonly PlannedLessonFigureView[] = [view2, view3], hooks = {}): LessonFigureSequence {
  const sequence = new LessonFigureSequence();
  sequence.commit(first, rest, hooks);
  return sequence;
}

async function sequenceChecks(): Promise<void> {
  await check("sequence/forward-only", () => {
    const sequence = committed();
    assert.equal(sequence.currentId(), "figure_1");
    assert.equal(sequence.advanceTo("figure_2"), view2, "figure_1 to figure_2 returns figure 2");
    assert.equal(sequence.currentId(), "figure_2");
    assert.equal(sequence.advanceTo("figure_2"), null, "advanceTo figure_2 again is a repeat: null");
    assert.equal(sequence.advanceTo("figure_3"), view3, "figure_3 is after figure_2");
    assert.equal(sequence.advanceTo("figure_2"), null, "never back");
    assert.equal(sequence.advanceTo("figure_3"), null, "never the same figure twice");
  });
  await check("sequence/skip-a-dropped-figure", () => {
    const sequence = committed([view3]);
    assert.equal(sequence.has("figure_2"), false);
    assert.equal(sequence.advanceTo("figure_2"), null, "a dropped figure is no advance");
    assert.equal(sequence.advanceTo("figure_3"), view3, "figure_3 still follows figure_1");
  });
  await check("sequence/empty-and-reset", () => {
    const empty = new LessonFigureSequence();
    assert.equal(empty.active(), false);
    assert.equal(empty.advanceTo("figure_2"), null, "nothing committed: no advance");
    assert.equal(empty.diagramAfter(["figure_2"]), null);
    const sequence = committed();
    sequence.reset();
    assert.equal(sequence.active(), false);
    assert.equal(sequence.advanceTo("figure_2"), null, "reset drops every figure");
  });
  await check("sequence/advance-ids-exact", () => {
    const sequence = committed();
    const focus = (text: string) => ({ type: "FOCUS" as const, text, semanticRef: { entityId: text } });
    assert.equal(sequence.advanceIdOf(focus("figure_2")), "figure_2");
    assert.equal(sequence.advanceIdOf(focus("figure_2|spotlight")), "figure_2", "an emphasis suffix still names the figure");
    assert.equal(sequence.advanceIdOf(focus("figure_2,mass")), null, "an advance has exactly one target");
    assert.equal(sequence.advanceIdOf(focus("figure_1")), null, "figure 1 is never a cue");
    assert.equal(sequence.advanceIdOf({ type: "POINT", text: "figure_2", semanticRef: { entityId: "figure_2" } }), null, "only FOCUS advances");
  });
  await check("sequence/doubt-in-the-zone-refuses", () => {
    let stash = true;
    const sequence = committed([view2], { mayAdvance: () => !stash });
    assert.equal(sequence.advanceTo("figure_2"), null, "a doubt's figure in the zone refuses the advance");
    assert.equal(sequence.currentId(), "figure_1", "a refused advance does not move the cursor");
    stash = false;
    assert.equal(sequence.advanceTo("figure_2"), view2);
  });
  await check("sequence/pending-refusal-and-saved-cues", () => {
    const cue = { type: "FOCUS" as const, text: "figure_2", semanticRef: { entityId: "figure_2" } };
    const part = { type: "FOCUS" as const, text: view2.diagram.anchors[0]!.id, semanticRef: { entityId: view2.diagram.anchors[0]!.id } };
    assert.equal(savedCommandFilter(null), undefined, "no sequence: rows are saved as before");
    assert.equal(savedCommandFilter(new LessonFigureSequence()), undefined, "an inactive sequence: rows are saved as before");
    let stash = false;
    const sequence = committed([view2], { mayAdvance: () => !stash });
    const saves = savedCommandFilter(sequence)!;
    assert.equal(saves(cue as DrawCommand), false, "a cue the cursor never reached is not saved");
    assert.equal(saves(part as DrawCommand), true, "any other command is saved");
    stash = true;
    assert.equal(sequence.refusalOf("figure_2"), "zone_held");
    assert.equal(sequence.advanceTo("figure_2"), null);
    assert.equal(saves(cue as DrawCommand), false, "a refused cue is not saved either");
    stash = false;
    assert.equal(sequence.pendingIntro(), null);
    assert.equal(sequence.advanceTo("figure_2"), view2);
    assert.equal(sequence.pendingIntro(), view2, "a started advance is pending until its intro is whole");
    assert.equal(saves(cue as DrawCommand), true, "a started advance is saved");
    assert.equal(sequence.refusalOf("figure_2"), "not_forward");
    sequence.introDone(view2);
    assert.equal(sequence.pendingIntro(), null);
    sequence.advanceTo("figure_3");
    assert.equal(sequence.refusalOf("figure_3"), "not_held");
    sequence.reset();
    assert.equal(sequence.refusalOf("figure_2"), "no_sequence");
  });
  await check("sequence/diagram-after", () => {
    const sequence = committed();
    assert.equal(sequence.diagramAfter([]), first.diagram, "before any cue: figure 1");
    assert.equal(sequence.diagramAfter(["figure_2"]), view2.diagram);
    assert.equal(sequence.diagramAfter(["figure_3", "figure_2"]), view3.diagram, "forward only: a later repeat of figure_2 does not go back");
    sequence.advanceTo("figure_2");
    assert.equal(sequence.diagramAfter([]), first.diagram, "the preparation cursor is not the playback cursor");
  });
}

// ---------------------------------------------------------------------------
// Executor: the advance branch through the real executor and a real board.
// ---------------------------------------------------------------------------

const EXECUTOR = fileURLToPath(new URL("../../features/tutor-session/hooks/useCommandExecution.ts", import.meta.url));
function loadExecutor(text = readFileSync(EXECUTOR, "utf8")): typeof CommandHook {
  const requireApp = createRequire(new URL("../../package.json", import.meta.url));
  const react = {
    useRef: (current: unknown) => ({ current }),
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
    useState: (value: unknown) => [value, () => {}],
  };
  const compiled = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as { useCommandExecution: typeof CommandHook } };
  new Function("require", "module", "exports", compiled)((specifier: string) =>
    specifier === "react" ? react : requireApp(specifier.startsWith(".")
      ? path.resolve(path.dirname(EXECUTOR), specifier) : specifier), mod, mod.exports);
  return mod.exports.useCommandExecution;
}
const hook = loadExecutor();
const ref = <T>(current: T) => ({ current });
const flush = async () => {
  for (let index = 0; index < 40; index++) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (let index = 0; index < 40; index++) await Promise.resolve();
};

function boardFixture(diagram: VerifiedDiagram | null, sequence: LessonFigureSequence | null) {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const activeVerifiedDiagramRef = ref<VerifiedDiagram | null>(diagram);
  const published: Array<VerifiedDiagram | null> = [];
  const marks: Array<{ name: string; data: Record<string, unknown> }> = [];
  const telemetry = { mark: (name: string, data: Record<string, unknown> = {}) => { marks.push({ name, data }); } };
  const executor = hook({
    whiteboardRef: ref(board), cancelRef: ref(false), activeVerifiedDiagramRef,
    fbdPhaseStartedRef: ref(false), fbdPhaseMarkedRef: ref(false),
    boardLayoutRef: ref({ rects: [], nextY: 100 }), inkPaceRef: ref("follow"),
    speedRef: ref(1), adaptiveFactorRef: ref(1), forceSequentialWorkLayoutRef: ref(false),
    turnTelemetryRef: ref(telemetry as never), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""),
    raceWithCancel: async (promise) => promise,
    resolveTextPlacement: async (_command, x, y) => ({ x, y }),
    cancellableDelay: async () => {}, forgetErasedTextRects() {}, resetBoardLayout() {},
    lessonFiguresRef: ref(sequence),
    setActiveVerifiedDiagram: (next) => { published.push(next); },
    nowMs: clock.source.now,
  } as Parameters<typeof CommandHook>[0]);
  const run = async (command: DrawCommand, options: Parameters<typeof executor.executeCommandWithCancel>[1]) => {
    let settled = false;
    const job = executor.executeCommandWithCancel(command, { ...options, isCancelled: () => false }).then(() => { settled = true; });
    await flush();
    for (let elapsed = 0; !settled && elapsed < 60_000; elapsed += 64) {
      clock.advance(64); clock.pump(); await flush();
    }
    assert(settled, `${command.type} ${command.text ?? ""} finishes`);
    await job;
  };
  /** Run `command` and cancel it (a Stop) once `stopWhen` holds; returns whether onInkStarted fired. */
  const runUntilStop = async (
    command: DrawCommand,
    options: Parameters<typeof executor.executeCommandWithCancel>[1],
    stopWhen: () => boolean,
    stop: { cancelled: boolean } = { cancelled: false },
  ) => {
    let settled = false;
    let shown = false;
    const job = executor.executeCommandWithCancel(command, {
      ...options, onInkStarted: () => { shown = true; }, isCancelled: () => stop.cancelled,
    }).then(() => { settled = true; });
    await flush();
    for (let elapsed = 0; !settled && elapsed < 60_000; elapsed += 64) {
      if (!stop.cancelled && stopWhen()) stop.cancelled = true;
      clock.advance(64); clock.pump(); await flush();
    }
    assert(settled, `${command.type} ${command.text ?? ""} stops`);
    await job;
    return { shown, stopped: stop.cancelled };
  };
  /** The next turn's finish, pumped on the virtual clock. */
  const finish = async (sequence: LessonFigureSequence) => {
    let settled = false;
    let result: PlannedLessonFigureView | null = null;
    const job = finishLessonFigureAdvance(board, null, sequence, {
      executeCommand: (next, opts) => executor.executeCommandWithCancel(next, { ...opts }),
    }).then((value) => { result = value; settled = true; });
    await flush();
    for (let elapsed = 0; !settled && elapsed < 60_000; elapsed += 64) {
      clock.advance(64); clock.pump(); await flush();
    }
    assert(settled, "the finish completes");
    await job;
    return result as PlannedLessonFigureView | null;
  };
  const stamp = async (commands: readonly DrawCommand[]) => {
    for (const command of commands) await run(command, { trustedDiagramGeometry: true, applyLayout: false, inkPace: "scene", durationScale: 0 });
  };
  const sceneInk = () => board.getDrawLayer()!.getChildren()
    .filter((node: Konva.Node) => node.getAttrs().htInk === "scene")
    .map((node: Konva.Node) => JSON.stringify(node.toObject()))
    .sort();
  const sceneData = () => new Set(board.getDrawLayer()!.getChildren()
    .filter((node: Konva.Node) => node.getAttrs().htInk === "scene")
    .map((node: Konva.Node) => String(node.getAttr("data"))));
  return { board, executor, run, runUntilStop, finish, stamp, sceneInk, sceneData, activeVerifiedDiagramRef, published, marks };
}

const advanceCue = (id = "figure_2"): DrawCommand => ({
  type: "FOCUS", params: [], text: id, semanticRef: { entityId: id }, charPosition: 0, narrationBefore: "",
});

async function executorChecks(): Promise<void> {
  const introOf = (presentation: LessonFigurePresentation) => lessonFigureIntroCommands(presentation);
  assert(introOf(view2).length > 0 && introOf(first).length > 0, "both figures have intro ink");

  // Figure 2 alone on a clean board: the ink the zone must hold after the advance.
  const alone = boardFixture(null, null);
  let expected: string[];
  let expectedData: Set<string>;
  try {
    await alone.stamp(introOf(view2));
    expected = alone.sceneInk();
    expectedData = alone.sceneData();
  } finally { alone.board.cancelAnimations(); await flush(); unmountTestWhiteboard(alone.board); }
  assert(expected.length > 0, "figure 2's intro draws scene ink");

  for (const mode of ["stamp", "live"] as const) {
    await check(`executor/advance-${mode}`, async () => {
      const advanced: string[] = [];
      const sequence = committed([view2], { onAdvanced: (view: PlannedLessonFigureView) => advanced.push(view.id) });
      const f = boardFixture(first.diagram, sequence);
      try {
        await f.stamp(introOf(first));
        assert(f.sceneInk().length > 0, "figure 1 is on the board");
        const figureOneOnly = [...f.sceneData()].filter((data) => !expectedData.has(data));
        assert(figureOneOnly.length > 0, "figure 1 has ink figure 2 does not");
        await f.run(advanceCue(), mode === "stamp" ? { durationScale: 0 } : { speechDurationMs: 4000 });
        if (mode === "stamp") {
          assert.deepEqual(f.sceneInk(), expected, "the zone holds exactly figure 2's intro ink: figure 1 erased, nothing else drawn");
        } else {
          // Live ink is the same geometry with the live pen's own strokes beside it.
          const after = f.sceneData();
          assert.deepEqual([...expectedData].filter((data) => !after.has(data)), [], "every stroke of figure 2's intro is drawn");
          assert.deepEqual(figureOneOnly.filter((data) => after.has(data)), [], "no stroke of figure 1 is left");
        }
        assert.equal(f.activeVerifiedDiagramRef.current, view2.diagram, "the active diagram is figure 2");
        assert.equal(f.published.at(-1), view2.diagram, "figure 2 is published to React");
        assert.deepEqual(advanced, ["figure_2"], "the page is told once");
        assert.equal(sequence.currentId(), "figure_2");
        // A repeat cue draws nothing and is not checked as a part.
        const settled = f.sceneInk();
        await f.run(advanceCue(), { durationScale: 0 });
        assert.deepEqual(f.sceneInk(), settled, "a repeated advance draws nothing");
        assert.deepEqual(advanced, ["figure_2"]);
      } finally { f.board.cancelAnimations(); await flush(); unmountTestWhiteboard(f.board); }
    });
  }
  // Review F2: a Stop part way through an advance. The cue's row counts as
  // shown (saved with the cue, so replay stands figure 2 whole); figure 2 is
  // pending, and the next turn's finish leaves the zone exactly figure 2.
  const savedCue = (sequence: LessonFigureSequence, shown: boolean) => {
    const registry = new LiveTurnSaveRegistry({
      transport: { checkpoint: () => new Promise(() => {}), close: () => new Promise(() => {}) },
      setTimer: () => 0, clearTimer: () => {}, now: () => 0, isOnline: () => false, mintId: () => "t1",
    });
    const owner = {};
    const handle = registry.begin({ owner, generation: 1, boardId: "b1", traceId: "tr", kind: "lesson", question: "q", preview: "q", speedMultiplier: 1, continuesBoard: false });
    const saves = savedCommandFilter(sequence);
    const prepared = registry.prepareSegment(owner, 1, {
      orderIndex: 0, narration: "Now the forces.", spokenText: "Now the forces.",
      command: serializeSegmentCommands([advanceCue(), { ...advanceCue(view2.diagram.anchors[0]!.id) }]), audioBytes: null, durationMs: null, timings: null,
    }, { intro: false, ...(saves ? { savesCommand: saves } : {}) })!;
    if (shown) prepared.markShown();
    registry.captureShown(owner);
    return handle.submittedRows().flatMap((one) => parseStoredSegmentCommands(one.command))
      .filter((command) => command.type === "FOCUS").map((command) => command.text ?? "");
  };
  for (const at of ["erase", "intro"] as const) {
    await check(`executor/stop-in-the-${at}-finishes-figure-2`, async () => {
      const advanced: string[] = [];
      const sequence = committed([view2], { onAdvanced: (view: PlannedLessonFigureView) => advanced.push(view.id) });
      const f = boardFixture(first.diagram, sequence);
      try {
        await f.stamp(introOf(first));
        const stop = { cancelled: false };
        const figureOne = f.sceneInk();
        if (at === "erase") {
          // Stop lands inside the zone erase: figure 1 stays, nothing of figure 2 is drawn.
          const erase = f.board.eraseSceneInk.bind(f.board);
          f.board.eraseSceneInk = ((duration: number, cancel?: () => boolean) => { stop.cancelled = true; return erase(duration, cancel); }) as typeof f.board.eraseSceneInk;
        }
        const drawn = () => [...expectedData].filter((data) => f.sceneData().has(data)).length;
        const run = await f.runUntilStop(advanceCue(), { speechDurationMs: 4000 },
          () => at === "intro" && f.activeVerifiedDiagramRef.current === view2.diagram && drawn() > 0, stop);
        assert(run.stopped, "the Stop landed");
        assert(run.shown, "the advance marked its row shown before the erase");
        assert.equal(sequence.pendingIntro(), view2, "figure 2 is pending");
        assert.equal(sequence.currentId(), "figure_2", "the cursor moved when the advance started");
        if (at === "intro") {
          assert(drawn() > 0 && drawn() < expectedData.size, `figure 2 is part drawn (${drawn()} of ${expectedData.size})`);
        } else {
          assert.equal(f.activeVerifiedDiagramRef.current, first.diagram, "the zone still reads figure 1");
          assert.notDeepEqual(f.sceneInk(), expected, "figure 2 is not on the board");
          assert(figureOne.length > 0);
        }
        assert.deepEqual(savedCue(sequence, run.shown), ["figure_2", view2.diagram.anchors[0]!.id], "the cut row is saved with its cue: replay stands figure 2");
        assert.deepEqual(advanced, at === "erase" ? [] : ["figure_2"], at === "erase" ? "the page was never told" : "the page was told when the zone cleared");
        const finished = await f.finish(sequence);
        assert.equal(finished, view2, "the next turn finishes figure 2");
        assert.deepEqual(f.sceneInk(), expected, "the zone holds exactly figure 2's intro, as replay draws it");
        assert.equal(sequence.pendingIntro(), null, "nothing pending after the finish");
        assert.equal(advanced.at(-1), "figure_2", "the page knows figure 2 holds the zone");
        assert.equal(await f.finish(sequence), null, "a second finish draws nothing");
      } finally { f.board.cancelAnimations(); await flush(); unmountTestWhiteboard(f.board); }
    });
  }
  await check("executor/whole-advance-leaves-nothing-pending", async () => {
    const sequence = committed([view2]);
    const f = boardFixture(first.diagram, sequence);
    try {
      await f.stamp(introOf(first));
      await f.run(advanceCue(), { durationScale: 0 });
      assert.equal(sequence.pendingIntro(), null, "an advance drawn whole is done");
      const before = f.sceneInk();
      assert.equal(await f.finish(sequence), null);
      assert.deepEqual(f.sceneInk(), before, "the finish touches nothing");
    } finally { f.board.cancelAnimations(); await flush(); unmountTestWhiteboard(f.board); }
  });
  await check("executor/stop-before-the-cue-saves-no-cue", () => {
    // Voice started (row shown) but the cue never ran: live stays on figure 1, so must the save.
    assert.deepEqual(savedCue(committed([view2]), true), [view2.diagram.anchors[0]!.id], "the unreached cue is dropped, the rest kept");
    assert.deepEqual(savedCue(new LessonFigureSequence(), true), ["figure_2", view2.diagram.anchors[0]!.id], "no sequence: the row is saved as before");
  });
  // Review N6: a refused advance is recorded with its reason and never saved.
  await check("executor/refused-advance-is-recorded-and-not-saved", async () => {
    const sequence = committed([view2], { mayAdvance: () => false });
    const f = boardFixture(first.diagram, sequence);
    try {
      await f.stamp(introOf(first));
      const before = f.sceneInk();
      await f.run(advanceCue(), { durationScale: 0 });
      assert.deepEqual(f.sceneInk(), before, "the zone keeps figure 1");
      assert.equal(f.activeVerifiedDiagramRef.current, first.diagram);
      const refused = f.marks.filter((mark) => mark.name === "lesson-figure-advance-refused");
      assert.deepEqual(refused.map((mark) => mark.data), [{ figure_id: "figure_2", reason: "zone_held" }], "recorded with its reason");
      assert.equal(sequence.pendingIntro(), null);
      assert.deepEqual(savedCue(sequence, true), [view2.diagram.anchors[0]!.id], "the refused cue is not saved: replay stays on figure 1");
    } finally { f.board.cancelAnimations(); await flush(); unmountTestWhiteboard(f.board); }
  });
  await check("executor/no-sequence-is-a-stale-focus", async () => {
    const f = boardFixture(first.diagram, new LessonFigureSequence());
    try {
      await f.stamp(introOf(first));
      const before = f.sceneInk();
      await f.run(advanceCue(), { durationScale: 0 });
      assert.deepEqual(f.sceneInk(), before, "flag off: the cue is an unknown FOCUS and draws nothing");
      assert.equal(f.activeVerifiedDiagramRef.current, first.diagram);
    } finally { f.board.cancelAnimations(); await flush(); unmountTestWhiteboard(f.board); }
  });
}

// ---------------------------------------------------------------------------
// Preparation cursor: segments are checked against the figure each cue moves
// to, not the figure on screen when the response streams.
// ---------------------------------------------------------------------------

const SOURCE_ROOT = fileURLToPath(new URL("../../features/tutor-session/", import.meta.url));
const stripComments = (raw: string) => raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
function anchoredSlice(file: string, name: string): string {
  const source = readFileSync(path.join(SOURCE_ROOT, file), "utf8");
  // Whole anchor lines only: "// x:end" must not match "// x:ended".
  const begin = source.indexOf(`// ${name}:begin\n`);
  const end = source.indexOf(`// ${name}:end\n`, begin);
  assert(begin >= 0, `slice anchor: ${name}:begin in ${file}`);
  assert(end > begin, `slice anchor: ${name}:end after its begin in ${file}`);
  assert.equal(source.split(`// ${name}:begin`).length, 2, `one ${name}:begin in ${file}`);
  assert.equal(source.split(`// ${name}:end`).length, 2, `one ${name}:end in ${file}`);
  return stripComments(source.slice(begin, end));
}

const focus = (id: string, at = 0): DrawCommand => ({
  type: "FOCUS", params: [], text: id, semanticRef: { entityId: id }, charPosition: at, narrationBefore: "",
});
const write = (text: string, at = 0): DrawCommand => ({ type: "WRITE", params: [40, 200], text, charPosition: at, narrationBefore: "" });
const segment = (narration: string, commands: DrawCommand[]): TutorSegment => ({ narration, command: commands[0] ?? null, commands });
const keptIds = (segments: readonly TutorSegment[]) => segments.flatMap(getSegmentCommands)
  .map((command) => command.type === "FOCUS" ? command.semanticRef?.entityId ?? command.text ?? "" : command.type);

async function preparationChecks(): Promise<void> {
  const figureOneIds = new Set(first.diagram.anchors.map((anchor) => anchor.id));
  const part = view2.diagram.anchors.find((anchor) => !figureOneIds.has(anchor.id))?.id;
  assert(part, "figure 2 has a part figure 1 does not");
  const figureOnePart = first.diagram.anchors.find((anchor) => !view2.diagram.anchors.some((other) => other.id === anchor.id))!.id;

  await check("prepare/after-the-advance-keeps-figure-2-parts", () => {
    const run = [
      segment("Now look at the forces on the block.", [focus("figure_2")]),
      segment("This one acts along the slope.", [focus(part)]),
    ];
    const cues: string[] = [];
    assert.deepEqual(keptIds(prepareLessonFigureSegments(run, first.diagram, committed([view2]), cues).segments), ["figure_2", part]);
    assert.deepEqual(cues, ["figure_2"], "the cursor moved");
  });
  await check("prepare/before-the-advance-filters-figure-2-parts", () => {
    const run = [
      segment("This one acts along the slope.", [focus(part)]),
      segment("Now look at the forces on the block.", [focus("figure_2")]),
      segment("Back to the line.", [focus(figureOnePart)]),
    ];
    const prepared = prepareLessonFigureSegments(run, first.diagram, committed([view2]), []);
    assert.deepEqual(keptIds(prepared.segments), ["figure_2"], "figure 2's part before the cue and figure 1's after it are filtered");
    assert.equal(prepared.blockedCommandCount, 2, "the advance itself is never counted as blocked");
  });
  await check("prepare/streamed-one-at-a-time", () => {
    const sequence = committed([view2]);
    const cues: string[] = [];
    const streamed = [
      segment("First the line.", [write("y = 2x + 1"), focus(figureOnePart)]),
      segment("Now look at the forces on the block.", [focus("figure_2")]),
      segment("This one acts along the slope.", [focus(part)]),
      segment("Again the forces.", [focus("figure_2")]),
    ].flatMap((one) => prepareLessonFigureSegments([one], first.diagram, sequence, cues).segments);
    assert.deepEqual(keptIds(streamed), ["WRITE", figureOnePart, "figure_2", part], "the cursor carries across calls; a repeat cue is filtered");
    assert.equal(sequence.currentId(), "figure_1", "preparation never moves the playback cursor");
  });
  await check("prepare/advance-runs-first-in-its-sentence", () => {
    const prepared = prepareLessonFigureSegments([
      segment("Here the slope force acts on the block.", [focus(part, 5), focus("figure_2", 20)]),
    ], first.diagram, committed([view2]), []);
    assert.deepEqual(keptIds(prepared.segments), ["figure_2", part], "the sentence's other commands resolve on the figure it moves to");
    const bare = prepareLessonFigureSegments([segment("", [focus("figure_2")])], first.diagram, committed([view2]), []);
    assert.deepEqual(keptIds(bare.segments), ["figure_2"], "a cue with no words still moves");
  });
  await check("prepare/no-sequence-is-byte-identical", () => {
    const run = [
      segment("First the line.", [write("y = 2x + 1"), focus(figureOnePart)]),
      segment("Now look at the forces on the block.", [focus("figure_2")]),
      segment("This one acts along the slope.", [focus(part)]),
    ];
    const reference = JSON.stringify(prepareVerifiedLessonSegments(structuredClone(run), first.diagram));
    assert.equal(JSON.stringify(prepareLessonFigureSegments(structuredClone(run), first.diagram, null, [])), reference, "flag off: no sequence");
    assert.equal(JSON.stringify(prepareLessonFigureSegments(structuredClone(run), first.diagram, new LessonFigureSequence(), [])), reference, "no later figure: the same bytes");
  });
  await check("prepare/both-call-sites-use-the-cursor", () => {
    const stream = anchoredSlice("hooks/turn/useQuestionHandler.ts", "lesson-figures-prepare");
    assert(/const lessonFigurePrep = !doubt && !resume && !codeLesson && lessonFiguresRef\?\.current\?\.active\(\)/.test(stream), "the stream prepares with the lesson's sequence only on a lesson turn");
    assert(/prepareLessonFigureSegments\(\[bufferedSegment\], activeDiagram, lessonFigurePrep, lessonFigureCues\)/.test(stream), "the stream prepares each segment through the cursor");
    assert(!/prepareVerifiedLessonSegments\(/.test(stream), "never against the static diagram");
    const batch = anchoredSlice("hooks/turn/useTurnControl.ts", "lesson-figures-prepare");
    assert(/prepareLessonFigureSegments\(rawLlmSegments, activeDiagram, options\?\.lessonFigures \?\? null, \[\]\)/.test(batch), "the batch path prepares through the cursor");
    assert(!/prepareVerifiedLessonSegments\(/.test(batch), "never against the static diagram");
    const uqh = stripComments(readFileSync(path.join(SOURCE_ROOT, "hooks/turn/useQuestionHandler.ts"), "utf8"));
    assert(/errorQuestion: question, lessonFigures: lessonFigurePrep \}/.test(uqh), "the batch call passes the same sequence");
    assert(!/prepareVerifiedLessonSegments\(/.test(uqh), "uQH prepares nothing against the static diagram");
    assert(/lessonFigureCues\.length = 0;/.test(anchoredSlice("hooks/turn/useQuestionHandler.ts", "lesson-figures-retry")), "a startup retry starts the cursor again");
  });
}

// ---------------------------------------------------------------------------
// Prompt: ids, kinds, part ids and drawn labels; never geometry.
// ---------------------------------------------------------------------------

async function promptChecks(): Promise<void> {
  const base = {
    question: inclinePlan!.question,
    diagramPromptAddon: first.diagram.promptAddon,
    turnPlan: inclinePlan!,
    solverProjection: null,
    codeLesson: null,
    isDsa: false,
    familiarity: "normal" as const,
    fastMode: false,
  };
  const off = buildTurnTeachingPrompt(base);
  await check("prompt/flag-off-same-bytes", () => {
    assert.equal(JSON.stringify(buildTurnTeachingPrompt({ ...base, laterFigures: [] })), JSON.stringify(off), "no later figures: the same bytes");
    assert.equal(laterFiguresPromptAddon(undefined), "");
    assert(!off.systemPrompt.includes("LATER FIGURES") && !off.systemPrompt.includes("figure_2"));
  });
  const view = laterFigurePromptOf(view2);
  const on = buildTurnTeachingPrompt({ ...base, laterFigures: [view] });
  await check("prompt/lists-ids-and-parts", () => {
    assert.deepEqual(Object.keys(view).sort(), ["id", "kind", "parts"], "the prompt view carries no geometry field");
    assert(view.parts.every((part) => Object.keys(part).sort().join() === "id,label"), "a part is its id and its drawn label only");
    assert.deepEqual(view.parts.map((part) => part.id), view2.diagram.anchors.map((anchor) => anchor.id));
    assert(view.parts.some((part) => part.label), "drawn labels are named");
    const block = laterFiguresPromptAddon([view]);
    assert(on.systemPrompt.includes(block) && on.continuationPrompt.includes(block), "the block reaches both prompts");
    assert(block.includes("figure_2") && /\[FOCUS:figure_k\] in the sentence that moves to it/.test(block) && /never go back/i.test(block));
    for (const anchor of view2.diagram.anchors) {
      assert(block.includes(`[FOCUS:${anchor.id}]`), `part ${anchor.id} is listed`);
      for (const value of [anchor.x, anchor.y, anchor.width, anchor.height]) {
        assert(!block.includes(String(value)), `no coordinate (${value}) of ${anchor.id} is printed`);
      }
    }
    assert(!/\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/.test(block), "no coordinate pair");
    const withheld = new Set((view2.diagram.deferredAnnotations ?? []).flatMap((entry) => entry.commands.map((command) => command.text?.trim()).filter(Boolean)));
    assert(view.parts.every((part) => !part.label || !withheld.has(part.label) || lessonFigureIntroCommands(view2).some((command) => command.text?.trim() === part.label)),
      "a withheld label is never listed");
  });
  await check("prompt/uqh-plans-only-on-a-granted-lesson", () => {
    const plan = anchoredSlice("hooks/turn/useQuestionHandler.ts", "lesson-figures-plan");
    const guard = plan.indexOf("billed.lessonFigures === true && !doubt && !resume && !codeLesson");
    assert(guard >= 0, "planning is guarded by the grant, no doubt, no resume, no code lesson");
    assert(plan.indexOf("planLessonFigures(") > guard, "planLessonFigures runs under that guard");
    assert(/if \(!doubt && !resume\) lessonFiguresRef\?\.current\?\.reset\(\);/.test(plan), "every new lesson drops the last lesson's figures");
    assert(/families: lessonSceneFamilies/.test(plan), "the lesson's own scene families");
    assert(/deadlineAt: plannerStartedAt \+ SCENE_PLANNER_DEADLINE_MS/.test(plan), "the scene deadline");
    assert(/lessonFigures: lessonFiguresArtifact\(lessonPlanned\.figures\)/.test(plan), "the artifact is stored");
    assert(/mayAdvance: \(\) => !lessonPage\.zoneStash/.test(plan), "a doubt's figure in the zone refuses an advance");
    assert(/rememberZonePresentation\(view, billed\.doubtFigures === true\)/.test(plan), "the advance is the zone's figure for a later doubt");
    const uqh = stripComments(readFileSync(path.join(SOURCE_ROOT, "hooks/turn/useQuestionHandler.ts"), "utf8"));
    assert.equal(uqh.split("planLessonFigures(").length - 1, 1, "planLessonFigures is called in one place");
    const ask = anchoredSlice("hooks/turn/useQuestionHandler.ts", "lesson-figures-ask");
    assert(/lessonFigures: billed\.lessonFigures === true && !doubt && !resume && !dsaClassification\.isDsa/.test(ask), "the planner is asked for figures only on a granted lesson");
    assert(/lessonSceneFamilies = sceneCapabilities\.families;/.test(anchoredSlice("hooks/turn/useQuestionHandler.ts", "lesson-figures-families")));
    assert(/\.\.\.\(laterFigures\.length > 0 \? \{ laterFigures \} : \{\}\)/.test(uqh), "the prompt gets the block only when a figure drew");
  });
}

async function finishSourceChecks(): Promise<void> {
  await check("source/finish-runs-before-the-zone-is-read", () => {
    const raw = readFileSync(path.join(SOURCE_ROOT, "hooks/turn/useQuestionHandler.ts"), "utf8");
    const slice = anchoredSlice("hooks/turn/useQuestionHandler.ts", "lesson-figure-finish");
    assert(/if \(\(doubt \|\| resume\) && lessonFiguresRef\?\.current\?\.pendingIntro\(\)\)/.test(slice), "a doubt or resume finishes a pending advance");
    assert(/const finished = await finishLessonFigureAdvance\(whiteboardRef\.current, boardLayoutRef\.current, lessonFiguresRef\.current, \{/.test(slice), "through finishLessonFigureAdvance");
    assert(/if \(finished\) \{/.test(slice), "and the zone is set only from a finished figure");
    assert(/activeVerifiedDiagramRef\.current = finished\.diagram;/.test(slice), "the zone's figure is the finished one");
    const finishAt = raw.indexOf("// lesson-figure-finish:begin");
    const refAt = raw.indexOf("const pointsAtFigure = doubt");
    const returnAt = raw.indexOf("// doubt-figure-return:begin");
    assert(finishAt >= 0 && refAt >= 0 && returnAt >= 0, "all three anchors are present");
    assert(finishAt < refAt && finishAt < returnAt, "the finish runs before the doubt names its figure and before the resume reads the zone");
  });
  await check("source/saves-only-reached-cues", () => {
    const runner = anchoredSlice("hooks/turn/useSegmentRunner.ts", "lesson-figure-saved-cues");
    assert(/const savesCommand = savedCommandFilter\(lessonFiguresRef\?\.current\);/.test(runner));
    const raw = stripComments(readFileSync(path.join(SOURCE_ROOT, "hooks/turn/useSegmentRunner.ts"), "utf8"));
    assert(/\.\.\.\(savesCommand \? \{ savesCommand \} : \{\}\)/.test(raw), "the cut row is saved through the filter");
    assert(/serializeSegmentCommands\(savesCommand \? segmentCommands\.filter\(savesCommand\) : segmentCommands,/.test(raw), "and the completed row");
    const cut = anchoredSlice("lib/turn/liveTurnSave.ts", "live-cut-saves-command");
    assert(/pending\.savesCommand \? parsed\.filter/.test(cut));
  });
}

async function main(): Promise<void> {
  await sequenceChecks();
  await preparationChecks();
  await promptChecks();
  await executorChecks();
  await finishSourceChecks();
  console.log(`verify-lesson-figures-live: ${passed} checks passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
