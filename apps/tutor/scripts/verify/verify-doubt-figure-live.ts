/**
 * DIAGRAM_DOUBT_FIGURES, live: a doubt that needs a new figure plans,
 * verifies and draws one; every miss teaches on the old figure.
 *
 * Behaviour (planDoubtFigure with stub planners, no paid call):
 *   planTurnV3 and ProblemIR both start on the composed question; the fast
 *   tier is the only figure source; a figure equal to the zone's is refused;
 *   the 20 s budget falls back; a plan with unchecked numbers draws nothing.
 * Source (useQuestionHandler, both slice anchors guarded):
 *   flag off and "point" run no planner; the stash is set before swapFigureIn;
 *   the swapped figure's intro is the one the lesson enqueues; a resume
 *   returns the lesson's figure before it reads the zone's figure, and empties
 *   the zone's ref before the return awaits.
 * Behaviour (returnZoneStash): the stash leaves the page records only once the
 * lesson's figure is back; a Stop or doubt mid return, or no board, keeps it.
 * A reference picture (lane 3) is snapshotted where it installs
 * (`reference-picture-zone`) and returns as the same picture, parts and all.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProblemAuthorityV1Response, TurnPlanV3Response } from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { composeDoubtFigureQuestion, doubtFigureOf } from "../../lib/boards/doubtFigure";
import {
  DOUBT_FIGURE_BUDGET_MS,
  doubtFigurePlannedScene,
  planDoubtFigure,
  sameFigureAsZone,
  type DoubtFigurePlanners,
} from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { consumedDeferredIds, returnZoneStash, type ZoneStash } from "../../features/tutor-session/lib/scene/figureSwap";
import type { DrawCommand, VerifiedDiagram } from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { doubtFigureTurnScene } from "../../features/tutor-session/lib/turn/doubtTurn";
import { snapshotPresentation } from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { buildReferencePicturePresentation, isReferencePictureDiagram } from "../../features/tutor-session/lib/scene/referencePicturePresentation";
import partFocusFixture from "./fixtures/reference-picture-part-focus-off.json";

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");
function between(source: string, file: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert(from >= 0, `${file}: start anchor "${start}" is gone. Repoint this gate; do not relax it.`);
  const to = source.indexOf(end, from + start.length);
  assert(to > from, `${file}: end anchor "${end}" is gone after "${start}". Repoint this gate; do not relax it.`);
  return source.slice(from, to + end.length);
}

const lessonQuestion = "Derive the formula for the range of a projectile on level ground.";
const doubtTitle = "Doubt: show me the path when it is launched higher";
const composed = composeDoubtFigureQuestion(lessonQuestion, doubtTitle);
const planFor = (question: string, overrides: Partial<TurnPlanV3> = {}): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3",
  question,
  givens: [],
  unknowns: [{ id: "range", symbol: "R" }],
  derived: [],
  qualitativeClaims: [
    { id: "range", claim: "R = u^2 sin(2 theta) / g", expected: "u^2 sin(2 theta) / g", relatedQuantityIds: ["range"] },
  ],
  lawIds: ["constant-acceleration"],
  assumptions: ["Air resistance is negligible"],
  visualRequirement: "required",
  ...overrides,
});

interface Calls { turn: string[]; authority: string[]; authorityStartedBeforeTurnSettled: boolean }
function planners(options: {
  plan?: (question: string) => TurnPlanV3 | null;
  turnDelayMs?: number;
  authority?: ProblemAuthorityV1Response | null;
}, calls: Calls): DoubtFigurePlanners {
  let turnSettled = false;
  return {
    planTurn: async (question, run) => {
      calls.turn.push(question);
      assert(run.timeoutMs > 0 && run.timeoutMs <= DOUBT_FIGURE_BUDGET_MS, "the turn plan is bounded by the doubt budget");
      if (options.turnDelayMs) await new Promise((done) => setTimeout(done, options.turnDelayMs));
      turnSettled = true;
      const plan = (options.plan ?? planFor)(question);
      return plan ? { turnPlan: plan, rawContent: "", elapsedMs: 0 } satisfies TurnPlanV3Response : null;
    },
    planAuthority: async (question) => {
      calls.authority.push(question);
      calls.authorityStartedBeforeTurnSettled = !turnSettled;
      return options.authority ?? null;
    },
  };
}
const freshCalls = (): Calls => ({ turn: [], authority: [], authorityStartedBeforeTurnSettled: false });
const run = (planner: DoubtFigurePlanners, extra: Partial<Parameters<typeof planDoubtFigure>[0]> = {}) => planDoubtFigure({
  lessonQuestion, doubtTitle, zoneFigure: null,
  deadlineAt: Date.now() + DOUBT_FIGURE_BUDGET_MS,
  signal: new AbortController().signal,
  planners: planner,
  ...extra,
});

async function main(): Promise<void> {
  // 1. "new_figure": both planners run on the composed question, in parallel,
  // and the fast verified tier draws the figure.
  const calls = freshCalls();
  const drawn = await run(planners({}, calls));
  assert.deepEqual(calls.turn, [composed], "planTurnV3 runs on the composed question, never the doubt title");
  assert.deepEqual(calls.authority, [composed], "ProblemIR runs on the same composed question");
  assert(calls.authorityStartedBeforeTurnSettled, "ProblemIR starts beside the turn plan, not after it");
  assert.equal(drawn.status, "drawn", `the fixture doubt draws a fast figure (${drawn.status === "miss" ? drawn.reason : ""})`);
  if (drawn.status !== "drawn") throw new Error("unreachable");
  assert.equal(drawn.representation.figureSource, "fast_family", "v1 doubts draw from the fast tier only");
  assert.equal(drawn.question, composed, "the drawn figure carries the composed question the server recomputes");
  assert(drawn.presentation.introSegments.length > 0, "the figure has intro segments for enqueueVerifiedIntro");

  // 2. The doubt's saved scene: validated, the marker, the continuation, the plan.
  {
    const scene = doubtFigureTurnScene(doubtFigurePlannedScene(drawn), lessonQuestion, "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b");
    assert.equal(scene.visualStatus, "validated", "the doubt row is a validated scene");
    const artifacts = scene.sceneArtifacts as Record<string, unknown>;
    assert.deepEqual(doubtFigureOf(artifacts)?.replacedTurnId, "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", "the marker names the figure it replaced");
    assert(artifacts.boardContinuation, "the doubt stays on the lesson's page");
    assert.equal(artifacts.turnPlan, drawn.turnPlan, "the reconciled plan the figure came from is saved with it");
  }

  // 3. A figure equal to the one already in the zone is a redraw: refused.
  {
    const again = await run(planners({}, freshCalls()), { zoneFigure: drawn.presentation.diagram });
    assert(sameFigureAsZone(drawn.presentation.diagram, drawn.presentation.diagram), "a figure equals itself");
    assert.equal(again.status, "miss", "a figure equal to the zone's figure is never swapped in");
    assert.equal(again.status === "miss" ? again.reason : null, "same_figure", "the redraw is refused as same_figure");
  }

  // 4. The budget: a turn plan that lands after the deadline falls back.
  {
    const late = await run(planners({ turnDelayMs: 120 }, freshCalls()), { deadlineAt: Date.now() + 30 });
    assert.equal(late.status === "miss" ? late.reason : late.status, "budget_exhausted", "past the budget the doubt teaches on the old figure");
    const spent = await run(planners({}, freshCalls()), { deadlineAt: Date.now() - 1 });
    assert.equal(spent.status === "miss" ? spent.reason : spent.status, "budget_exhausted", "a budget already spent draws nothing");
  }

  // 5. Rule 4: a plan whose numbers need the solver draws nothing without it.
  {
    const numericQuestion = "A projectile is launched at 20 m/s and an angle of 30 degrees on level ground. Find its range.";
    const numeric = await planDoubtFigure({
      lessonQuestion: numericQuestion, doubtTitle, zoneFigure: null,
      deadlineAt: Date.now() + DOUBT_FIGURE_BUDGET_MS, signal: new AbortController().signal,
      planners: planners({ plan: (question) => planFor(question, {
        givens: [
          { id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given" },
          { id: "theta", symbol: "theta", value: 30, unit: "deg", provenance: "given" },
          { id: "g", symbol: "g", value: 9.8, unit: "m/s^2", provenance: "given" },
        ],
        unknowns: [{ id: "range", symbol: "R", unit: "m" }],
        derived: [{ id: "range", symbol: "R", value: 99, unit: "m", provenance: "derived", sourceText: "R = 99" }],
        qualitativeClaims: [],
      }) }, freshCalls()),
    });
    assert.equal(numeric.status, "miss", "a planner scalar the solver never checked cannot reach a figure");
  }

  // 6. No turn plan, no figure.
  {
    const none = await run(planners({ plan: () => null }, freshCalls()));
    assert.equal(none.status === "miss" ? none.reason : none.status, "turn_plan_unavailable", "a failed turn plan teaches on the old figure");
  }

  // 7. The live deferred state the stash hands returnPageFigure.
  {
    const fresh = { ...drawn.presentation.diagram, deferredAnnotations: [
      { entityId: "a", commands: [] }, { entityId: "b", commands: [] }, { entityId: "c", commands: [], revealAfterLesson: true },
    ] };
    const live = { ...fresh, deferredAnnotations: [{ entityId: "b", commands: [] }, { entityId: "c", commands: [], revealAfterLesson: true }] };
    assert.deepEqual(consumedDeferredIds(fresh, live), ["a"], "only the marks the student already saw come back drawn");
  }

  // 8. The resume's return of the stash: cleared only once the figure is back.
  {
    const line: DrawCommand = { type: "DRAW_LINE", params: [500, 200, 600, 200], charPosition: 0, narrationBefore: "" };
    const lessonFigure = { id: "verified_scene", anchors: [], deferredAnnotations: [] } as unknown as VerifiedDiagram;
    const stash: ZoneStash = {
      diagram: lessonFigure,
      presentation: { diagram: lessonFigure, introSegments: [{ narration: "", command: null, commands: [line, line, line], verifiedDiagramIntro: true }] },
      turnId: "11111111-1111-4111-8111-111111111111",
    };
    const wb = { eraseSceneInk: async () => {}, erasePinnedInk: () => {} } as unknown as WhiteboardHandle;
    const layout = { rects: [], nextY: 120 } as unknown as Parameters<typeof returnZoneStash>[1];
    const records = () => [{ zoneStash: stash as ZoneStash | null }, { zoneStash: null as ZoneStash | null }];

    // Stop (or a doubt) after the first stamped command.
    let cancelled = false;
    let stamped = 0;
    const stopped = records();
    const cut = await returnZoneStash(wb, layout, stash, stopped, {
      shouldCancel: () => cancelled,
      executeCommand: async () => { stamped += 1; cancelled = true; },
    });
    assert.deepEqual(cut, { cancelled: true, diagram: null }, "a return cancelled mid stamp returns no figure");
    assert(stamped >= 1, "the cancel landed while the return was stamping");
    assert(stopped.every((record) => record.zoneStash === stash),
      "a cancelled return keeps the stash on the doubt's record and on the resume's, for the next Continue");
    const noBoard = records();
    assert.deepEqual(await returnZoneStash(null, layout, stash, noBoard, { executeCommand: async () => {} }), { cancelled: true, diagram: null },
      "no board returns no figure");
    assert(noBoard.every((record) => record.zoneStash === stash), "no board keeps the stash");
    const done = records();
    let whole = 0;
    const back = await returnZoneStash(wb, layout, stash, done, { shouldCancel: () => false, executeCommand: async () => { whole += 1; } });
    // Replay stamps the stopped lesson's stored rows, which the server
    // completed (verify-doubt-figure-persist), so live returns every beat too.
    assert.equal(whole, 3, "a whole return stamps every beat of the stashed intro, as replay does");
    assert(!back.cancelled && back.diagram && back.diagram !== lessonFigure, "a whole return resolves a copy of the lesson's figure");
    assert(done.every((record) => record.zoneStash === null), "a whole return clears the stash on both records");
  }

  // 8b. A stashed reference picture comes back as the same picture: its own
  // DRAW_PICTURE passes stamped at once, and the anchors (part focus on or
  // off) it was presented with, so FOCUS after the resume points as before.
  for (const testCase of partFocusFixture.cases) {
    const record = testCase.record as Parameters<typeof buildReferencePicturePresentation>[0];
    for (const partFocus of [false, true]) {
      const picture = buildReferencePicturePresentation(record, { partFocus });
      const snapshot = snapshotPresentation(picture);
      assert(snapshot, `a picture presentation can be snapshotted (${testCase.name}, part focus ${partFocus})`);
      const stash: ZoneStash = { diagram: picture.diagram, presentation: snapshot, turnId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
      const wb = { eraseSceneInk: async () => {}, erasePinnedInk: () => {} } as unknown as WhiteboardHandle;
      const stamped: Array<{ type: string; text?: string; durationScale?: number }> = [];
      const back = await returnZoneStash(wb, { rects: [], nextY: 120 } as unknown as Parameters<typeof returnZoneStash>[1], stash, [], {
        shouldCancel: () => false,
        executeCommand: async (command, options) => { stamped.push({ type: command.type, text: command.text, durationScale: options?.durationScale }); },
      });
      assert(!back.cancelled && back.diagram && isReferencePictureDiagram(back.diagram), "the resume returns a picture diagram");
      assert.deepEqual(back.diagram.anchors, picture.diagram.anchors, "the returned picture has the anchors it was presented with");
      assert.equal(stamped.length, picture.introSegments.length, "every picture pass is stamped back, and nothing else");
      assert(stamped.every((entry) => entry.type === "DRAW_PICTURE" && entry.text === record.id && entry.durationScale === 0),
        "the stored picture's own passes land at once");
    }
  }

  // 9. The live turn, from source.
  {
    const file = "features/tutor-session/hooks/turn/useQuestionHandler.ts";
    const handler = read(file);
    const plan = between(handler, file, "if (doubt && doubtFiguresGranted) {\n        // doubt-figure-plan:begin", "// doubt-figure-plan:end");
    assert(handler.includes("const doubtFiguresGranted = billed.doubtFigures === true;"), "flag off is the begin-turn grant");
    const askIndex = plan.indexOf("requestDoubtFigureNeed(");
    const skipIndex = plan.indexOf("const need = skip\n          ? { decision: \"point\" as const, reason: skip }");
    assert(skipIndex >= 0 && askIndex > skipIndex, "a skipped need check answers point without asking");
    const onNeed = plan.indexOf("if (need.decision === \"new_figure\") {");
    assert(onNeed > askIndex && plan.indexOf("planDoubtFigure(") > onNeed, "only new_figure plans; point runs no planner");
    assert(plan.indexOf("doubtFigureHoldingSegment(") > onNeed && plan.indexOf("doubtFigureHoldingSegment(") < plan.indexOf("planDoubtFigure("),
      "the holding line is spoken once, before the figure plans");
    assert(/deadlineAt: doubtStartedAt \+ DOUBT_FIGURE_BUDGET_MS/.test(plan), "the budget runs from the doubt's start");
    assert(!/planScene|requestReferencePicture|selectProductionScene\(\{[^}]*candidateValidation/.test(plan),
      "no LLM scene planner and no reference picture in a doubt");

    const swap = between(handler, file, "// doubt-figure-swap:begin", "// doubt-figure-swap:end");

    // Lane 3: the picture is snapshotted where it installs, on the object the zone holds.
    const pictureZone = between(handler, file, "// reference-picture-zone:begin", "// reference-picture-zone:end");
    assert(pictureZone.includes("rememberZonePresentation(picture, billed.doubtFigures === true);"),
      "a shown reference picture is remembered as the zone's presentation, under the doubt figures grant");
    const pictureInstall = between(handler, file, "referencePictureShown = picture.stored;", "setActiveVerifiedDiagram?.(activeDiagram);");
    const pictureActive = pictureInstall.indexOf("activeDiagram = picture.diagram;");
    const pictureRemember = pictureInstall.indexOf("// reference-picture-zone:begin");
    const pictureRef = pictureInstall.indexOf("activeVerifiedDiagramRef.current = activeDiagram;");
    assert(pictureActive >= 0 && pictureRemember > pictureActive && pictureRef > pictureRemember,
      "the snapshot's live object is the picture diagram the zone's ref then holds");
    const stashSet = swap.indexOf("page.zoneStash = stash;");
    const swapCall = swap.indexOf("await swapFigureIn(");
    assert(stashSet >= 0 && swapCall > stashSet, "the zone's figure is stashed on the page before the zone is cleared");
    assert(swap.indexOf("sceneV2IntroSegments = drawn.presentation.introSegments;") > swapCall,
      "the swapped figure's intro is the one the lesson's enqueueVerifiedIntro draws");
    assert(swap.indexOf("page.zoneStash = previousStash;") > swapCall, "a refused swap leaves the stash as it was");

    // An empty zone and a restored board (lane 2), inside the same anchors.
    assert(plan.includes("const zoneEmpty = !zoneFigure && !codeBoard && Boolean(doubtPage?.continuesBoard);"),
      "an empty zone is one with no figure, no code board, on the lesson's page");
    assert(plan.includes("zoneOccupied: zoneEmpty && zoneInkOccupied(boardLayoutRef.current),"),
      "the occupancy guard reads the board's layout, on an empty zone only");
    const liveStash = plan.indexOf("(zoneFigure && zoneEntry ? { diagram: zoneFigure, presentation: zoneEntry.snapshot");
    const storedStash = plan.indexOf("(zoneFigure && !codeBoard ? storedPageZoneStash(storedTurnsRef.current, zoneFigure) : null)");
    const emptyStash = plan.indexOf("(zoneEmpty ? { ...EMPTY_ZONE_STASH } : null)");
    assert(plan.indexOf("page.zoneStash") >= 0 && plan.indexOf("page.zoneStash") < liveStash && liveStash < storedStash && storedStash < emptyStash,
      "the stash is the page's, else the live snapshot, else the stored turns (restored board), else the empty zone");
    assert(plan.includes("zoneReturnable: zoneStash !== null,"), "a zone is returnable exactly when a stash could be built");
    assert(plan.indexOf("doubtZoneStash = zoneStash ? { zone: zoneFigure, stash: zoneStash } : null;") > plan.indexOf("doubtFigureNeedSkip("),
      "the plan hands its stash, with the zone it read, to the swap");
    assert(/zone: zoneFigure \? \(isReferencePictureDiagram\(zoneFigure\) \? "picture" : "figure"\) : "empty",/.test(plan),
      "the need telemetry names the zone kind");
    assert(swap.includes(": doubtZoneStash && doubtZoneStash.zone === zoneLive ? doubtZoneStash.stash : null);"),
      "the plan's stash is used only for the zone it was read against");
    const inkFree = swap.indexOf("const inkFree = zoneLive !== null || !zoneInkOccupied(boardLayoutRef.current);");
    assert(inkFree >= 0 && inkFree < swapCall && swap.includes("const cleared = wb && stash && inkFree"),
      "an empty zone is checked for ink again before the swap clears it");

    const resume = between(handler, file, "} else if (resume) {", "diagramSource = activeDiagram ? (isReferencePictureDiagram(activeDiagram)");
    const returnCall = resume.indexOf("await returnZoneStash(");
    const refRead = resume.indexOf("activeDiagram = figureReturned || resume.figureDrawn || resume.codeLesson ? activeVerifiedDiagramRef.current : null;");
    assert(returnCall >= 0, "a resume with a zone stash returns the lesson's figure");
    assert(refRead > returnCall, "the resume returns the lesson's figure before it reads the zone's ref");
    // The stash is cleared by returnZoneStash after a whole return (behaviour
    // above), never by the resume before it awaits.
    assert(!/zoneStash = null/.test(resume), "the resume never clears the stash itself, before or after the return");
    const stashReturn = resume.indexOf("await returnZoneStash(whiteboardRef.current, boardLayoutRef.current, zoneStash, [pageRecord, page],");
    assert(stashReturn >= 0, "the resume returns the stash through returnZoneStash, holding it on the doubt's record and its own");
    assert(resume.indexOf("{ shouldCancel: () => !isCurrentTurn(), executeCommand: executeCommandWithCancel });", stashReturn) > stashReturn,
      "the return gets the board's executor and the turn's cancel");
    const refCleared = resume.indexOf("activeVerifiedDiagramRef.current = null;");
    assert(refCleared >= 0 && refCleared < stashReturn, "the zone's ref is emptied before the return awaits, so a cancel never leaves it on the doubt's figure");
    const reload = resume.indexOf("returnFigureToZone(");
    assert(reload > returnCall && refRead > reload, "after a reload, returnsFigure redraws the stored figure before the ref is read");
    // Lane 6: figure 1's stored ink, or the lesson's later figure it had moved to.
    assert(resume.includes('source ? storedLessonFigurePresentation(source, back.figureId ?? "figure_1") : { diagram: null, introSegments: [] }'), "the stored turn's own figure ink comes back");
    assert(swap.includes("page.figureDrawn = false;"), "the swap clears figureDrawn; enqueueVerifiedIntro sets it on commit");
    assert(swap.includes("page.turn.scene = doubtFigureTurnScene(doubtFigurePlannedScene(drawn), page.lessonQuestion, page.zoneStash?.turnId ?? null);"),
      "the doubt row is its own scene, planned on the composed question, marked with the stashed figure");
    assert(!/page\.turnPlan = |page\.solverProjection = /.test(swap), "the record keeps the lesson's plan and projection");
    assert(resume.includes("activeDiagram && !figureReturned && !resume.codeLesson && resume.remainingIntro?.length"),
      "a returned figure comes back whole: the stopped intro remainder is dropped");
  }
}

main().then(() => console.log("doubt figure live verification passed"), (error: unknown) => {
  console.error(error);
  process.exit(1);
});
