/**
 * The doubt lab's $0 precheck (`doubt-run.ts --precheck`): no server, no model.
 *
 * For each row it asks, with the functions live runs, whether the lesson's
 * figure draws and whether the doubt's (or the lesson's later) figure draws:
 *
 * - lesson figure: `selectFastVerifiedRepresentation` on the lesson's gate
 *   families, then `selectProductionScene` on the recorded selection input
 *   (the planner's candidate as recorded, the fast tier recomputed on today's
 *   dist), then `buildVerifiedDiagramPresentation` and the drawable-ink check;
 * - doubt figure: `doubtFigureNeedSkip` with the board the lesson left, then
 *   `planDoubtFigure` with stub planners that return the recorded plan and
 *   authority restamped to the composed question (or the doubt's own recorded
 *   planner documents, `--figure-plans`). The need check is a model call, so
 *   the precheck assumes "new_figure" and says so;
 * - later lesson figures: `planLessonFigures` with the row's asks.
 *
 * The recorded plan comes from a doubt round's `lessons/` (`--lessons`) or any
 * lecture-lab run JSON that carries `figureReplayInputs` (`--replay-runs`).
 * A doubt-lab lesson recorded before lane 7 has no ProblemIR: "IR unknown".
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifiedDiagramHasDrawableInk, type TutorSegment, type VerifiedDiagram } from "@heytutor/drawing";
import { normalizeTutorQuestion, type ProblemAuthorityV1Response, type TurnPlanV3Response } from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { TEXT_LAYOUT } from "../../features/tutor-session/constants";
import type { BoardLayoutState, BoardTextRect } from "../../features/tutor-session/types";
import { findWorkTextSlot, withWorkRowIdentity, workColumnMaxWidth } from "../../features/tutor-session/lib/board/boardLayout";
import { doubtTurnTitle } from "../../features/tutor-session/lib/input/askDoubt";
import { resolveDsaFrames } from "../../features/tutor-session/lib/code-lesson/dsaFrames";
import { deriveSceneGate, selectProductionScene, type ProductionSceneSelectionInput } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import type { SelectedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import {
  DOUBT_FIGURE_BUDGET_MS,
  doubtFigureNeedSkip,
  planDoubtFigure,
  selectFastFigure,
  zoneInkOccupied,
  type DoubtFigureDrawn,
  type DoubtFigurePlanners,
} from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { planLessonFigures, type LessonFigurePlanResult } from "../../features/tutor-session/lib/turn/lessonFigurePlan";
import type { DoubtFigureNeedResult } from "../../lib/llm/doubtFigureNeed";
import type { DoubtProbe } from "./doubtGrade";

// ---------------------------------------------------------------------------
// The board a lesson leaves (shared with doubt-run)
// ---------------------------------------------------------------------------

/** Lay the lesson's rows out with the live slot finder; a full page turns, as live. */
export function boardLayoutFor(lesson: { rows: readonly string[]; diagram: VerifiedDiagram | null; kind: string }): BoardLayoutState {
  const diagramActive = Boolean(lesson.diagram) && lesson.kind !== "dsa";
  let layout: BoardLayoutState = { rects: [], nextY: TEXT_LAYOUT.topY };
  for (const text of lesson.rows) {
    const place = (): boolean => {
      const width = workColumnMaxWidth(layout, diagramActive);
      const slot = findWorkTextSlot({
        layout, requestedX: TEXT_LAYOUT.marginX, requestedY: layout.nextY, width,
        height: TEXT_LAYOUT.textHeight, diagramActive, sequential: true, runtimeOwnsX: true,
      });
      if (!slot) return false;
      const rect: BoardTextRect = withWorkRowIdentity(layout, { x: slot.x, y: slot.y, width, height: TEXT_LAYOUT.textHeight, text });
      layout.rects.push(rect);
      layout.nextY = Math.max(layout.nextY, slot.y + TEXT_LAYOUT.lineHeight);
      return true;
    };
    if (!place()) {
      layout = { rects: [], nextY: TEXT_LAYOUT.topY };
      place();
    }
  }
  return layout;
}

// ---------------------------------------------------------------------------
// Recorded planner documents
// ---------------------------------------------------------------------------

export const FIGURE_PLANS_VERSION = "doubt-lab-figure-plans/v1" as const;

/** The doubt figure's planner documents, recorded in a paid round (`doubts/<id>-<arm>-figures.json`). */
export interface DoubtFigurePlansRecord {
  schemaVersion: typeof FIGURE_PLANS_VERSION;
  probeId: string;
  arm: string;
  need: DoubtFigureNeedResult | null;
  /** The composed question both planners were asked. */
  question: string | null;
  planTurn: TurnPlanV3Response | null;
  planAuthority: ProblemAuthorityV1Response | null;
}

/** What the precheck replays a lesson from. */
export interface PrecheckSource {
  origin: "doubt_lesson" | "lecture_run";
  path: string;
  question: string;
  turnPlan: TurnPlanV3;
  /** The live selection input as recorded (`figureReplayInputs.selection`); null for a pre-lane-7 doubt lesson. */
  selection: ProductionSceneSelectionInput | null;
  authority: ProblemAuthorityV1Response | null;
  /** ProblemIR was recorded (present, or known not attempted). */
  irKnown: boolean;
  rows: string[];
}

interface ReplayInputs {
  selection: ProductionSceneSelectionInput;
  authority: Pick<ProblemAuthorityV1Response, "solverResult" | "audit" | "projection"> | null;
  authorityAttempted: boolean;
}

function authorityOf(inputs: ReplayInputs): ProblemAuthorityV1Response | null {
  // The live selection input holds the whole ProblemIR (lecturePipeline passes `problemAuthority.problemIR`).
  const problemIR = inputs.selection.problemIR as ProblemAuthorityV1Response["problemIR"] | null | undefined;
  if (!problemIR || !inputs.authority) return null;
  return { problemIR, solverResult: inputs.authority.solverResult, audit: inputs.authority.audit,
    projection: inputs.authority.projection, rawContent: "", elapsedMs: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A precheck source from a doubt-lab lesson record or a lecture-lab run JSON; null when it carries no plan. */
export function precheckSourceFrom(path: string, raw: unknown): PrecheckSource | null {
  if (!isRecord(raw)) return null;
  const inputs = isRecord(raw.figureReplayInputs) ? raw.figureReplayInputs as unknown as ReplayInputs : null;
  if (raw.schemaVersion === "doubt-lab-lesson/v1" && typeof raw.lessonQuestion === "string" && isRecord(raw.turnPlan)) {
    return {
      origin: "doubt_lesson", path, question: normalizeTutorQuestion(raw.lessonQuestion),
      turnPlan: (inputs?.selection.turnPlan ?? raw.turnPlan) as TurnPlanV3,
      selection: inputs?.selection ?? null, authority: inputs ? authorityOf(inputs) : null,
      irKnown: inputs !== null, rows: Array.isArray(raw.rows) ? raw.rows as string[] : [],
    };
  }
  if (inputs && typeof raw.question === "string") {
    const teaching = isRecord(raw.teaching) ? raw.teaching : {};
    const writes = Array.isArray(teaching.writes) ? teaching.writes as Array<{ text?: string }> : [];
    return {
      origin: "lecture_run", path, question: normalizeTutorQuestion(raw.question),
      turnPlan: inputs.selection.turnPlan, selection: inputs.selection, authority: authorityOf(inputs), irKnown: true,
      rows: [...(Array.isArray(raw.givenRows) ? raw.givenRows as string[] : []),
        ...writes.map((write) => write.text ?? "").filter((text) => text.trim().length > 0)],
    };
  }
  return null;
}

function jsonFiles(dir: string, depth: number): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory() && depth > 0) out.push(...jsonFiles(path, depth - 1));
    else if (stat.isFile() && name.endsWith(".json")) out.push(path);
  }
  return out;
}

/**
 * Sources by normalized question. Doubt-lab lessons win over lecture runs, a
 * lesson that recorded its IR over one that did not, and a later file over an
 * earlier one of the same kind.
 */
export function loadPrecheckSources(lessonDirs: readonly string[], runDirs: readonly string[]): Map<string, PrecheckSource> {
  const sources = new Map<string, PrecheckSource>();
  const rank = (source: PrecheckSource) => (source.origin === "doubt_lesson" ? 2 : 0) + (source.irKnown ? 1 : 0);
  const add = (path: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return;
    }
    const source = precheckSourceFrom(path, raw);
    if (!source) return;
    const existing = sources.get(source.question);
    if (!existing || rank(source) >= rank(existing)) sources.set(source.question, source);
  };
  for (const dir of runDirs) for (const path of jsonFiles(resolve(dir), 2)) add(path);
  for (const dir of lessonDirs) for (const path of jsonFiles(resolve(dir, "lessons"), 0)) add(path);
  return sources;
}

/** Recorded doubt figure plans of a round, by `<probeId>|<arm>`. */
export function loadFigurePlans(round: string | null): Map<string, DoubtFigurePlansRecord> {
  const plans = new Map<string, DoubtFigurePlansRecord>();
  if (!round) return plans;
  const dir = resolve(round, "doubts");
  if (!existsSync(dir)) return plans;
  for (const name of readdirSync(dir).filter((file) => file.endsWith("-figures.json"))) {
    const record = JSON.parse(readFileSync(join(dir, name), "utf8")) as DoubtFigurePlansRecord;
    if (record.schemaVersion === FIGURE_PLANS_VERSION) plans.set(`${record.probeId}|${record.arm}`, record);
  }
  return plans;
}

// ---------------------------------------------------------------------------
// Stub planners
// ---------------------------------------------------------------------------

/** The plan as the planner would have returned it for `question`: the recorded plan restamped. */
export function restampedPlan(plan: TurnPlanV3, question: string): TurnPlanV3Response {
  return { turnPlan: { ...structuredClone(plan), question }, rawContent: "", elapsedMs: 0 };
}

export function restampedAuthority(authority: ProblemAuthorityV1Response, question: string): ProblemAuthorityV1Response {
  const copy = structuredClone(authority);
  return { ...copy, problemIR: { ...copy.problemIR, question } as ProblemAuthorityV1Response["problemIR"] };
}

/** Planners that answer from records: the doubt's own documents when recorded, else the lesson's restamped. */
export function recordedPlanners(source: Pick<PrecheckSource, "turnPlan" | "authority"> | null, plans: DoubtFigurePlansRecord | null): DoubtFigurePlanners {
  return {
    planTurn: async (question) => plans
      ? (plans.planTurn ? { ...structuredClone(plans.planTurn), turnPlan: { ...structuredClone(plans.planTurn.turnPlan), question } } : null)
      : source ? restampedPlan(source.turnPlan, question) : null,
    planAuthority: async (question) => plans
      ? (plans.planAuthority ? restampedAuthority(plans.planAuthority, question) : null)
      : source?.authority ? restampedAuthority(source.authority, question) : null,
  };
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export interface FigureCheck {
  status: "drawn" | "none" | "picture" | "not_asked" | "unknown";
  /** One line: the family and tier drawn, or why none. */
  detail: string;
}

export interface LessonFigureReplay {
  check: FigureCheck;
  representation: SelectedRepresentation | null;
  presentation: { diagram: VerifiedDiagram; introSegments: TutorSegment[] } | null;
  families: string[];
}

/** The lesson's figure as live selects it, from the recorded selection input. */
export function replayLessonFigure(source: PrecheckSource): LessonFigureReplay {
  const { question, turnPlan } = source;
  const problemIR = source.selection?.problemIR ?? null;
  const gate = deriveSceneGate({ question, turnPlan, problemIR, conversationContext: "" });
  const families = [...gate.sceneCapabilities.families];
  const fast = selectFastFigure({ question, turnPlan, authority: source.authority, families });
  const base: ProductionSceneSelectionInput = source.selection
    ? { ...source.selection, sceneCapabilities: gate.sceneCapabilities, fastRepresentation: fast }
    : {
        question, turnPlan, problemIR: null, conversationContext: "", sceneCapabilities: gate.sceneCapabilities,
        candidateValidation: null, fastRepresentation: fast, exactFigureSource: "planner", solverAuthorityBlocked: false,
        requiredRetryEnabled: true, completionEnabled: false, policy: { preferPlanner: false },
      };
  const selection = selectProductionScene(base);
  const representation = selection.representation;
  if (!representation || representation.sceneDocument.visualDecision.mode !== "scene") {
    return { check: { status: "none", detail: `${selection.visualStatus}: ${String(selection.reason).slice(0, 140)}` }, representation: null, presentation: null, families };
  }
  const presentation = buildVerifiedDiagramPresentation(representation.sceneDocument, representation.renderScene, {
    originalQuestion: question, turnPlan, ...(representation.family ? { figureFamily: representation.family } : {}),
  });
  if (!verifiedDiagramHasDrawableInk(presentation.diagram)) {
    return { check: { status: "none", detail: "no drawable ink" }, representation: null, presentation: null, families };
  }
  return {
    check: { status: "drawn", detail: `${representation.figureSource}/${representation.family ?? "?"}/${representation.tier}` },
    representation, presentation: { diagram: presentation.diagram, introSegments: presentation.introSegments }, families,
  };
}

export interface PrecheckRow {
  probe: DoubtProbe;
  source: PrecheckSource | null;
  lesson: LessonFigureReplay;
  doubt: FigureCheck;
  doubtDrawn: DoubtFigureDrawn | null;
  extra: LessonFigurePlanResult | null;
  irUnknown: boolean;
  /** The row's figures match its expectation offline (a paid round may take it). */
  matches: boolean;
  why: string;
}

const NO_LESSON: LessonFigureReplay = { check: { status: "unknown", detail: "no recorded plan" }, representation: null, presentation: null, families: [] };

function lessonCheckFor(probe: DoubtProbe, source: PrecheckSource | null): LessonFigureReplay {
  if (probe.lane === "dsa") {
    const frames = resolveDsaFrames(probe.lessonQuestion);
    return { ...NO_LESSON, check: frames && frames.frames.length > 0
      ? { status: "drawn", detail: `dsa ${frames.algorithmId}, ${frames.frames.length} frames` }
      : { status: "none", detail: "no worked example frames" } };
  }
  if (!source) return NO_LESSON;
  const replay = replayLessonFigure(source);
  // As live: the picture tier runs only at the text only point.
  if (probe.referencePicture && replay.check.status === "none") {
    return { ...replay, check: { status: "picture", detail: "verified none; picture tier not checked offline (Commons + judge)" } };
  }
  return replay;
}

export async function precheckRow(
  probe: DoubtProbe,
  sources: Map<string, PrecheckSource>,
  figurePlans: Map<string, DoubtFigurePlansRecord>,
): Promise<PrecheckRow> {
  const source = sources.get(normalizeTutorQuestion(probe.lessonQuestion)) ?? null;
  const lesson = lessonCheckFor(probe, source);
  const irUnknown = source !== null && !source.irKnown;
  const zoneFigure = lesson.presentation?.diagram ?? null;
  let doubt: FigureCheck = { status: "not_asked", detail: "" };
  let doubtDrawn: DoubtFigureDrawn | null = null;
  let extra: LessonFigurePlanResult | null = null;

  if (probe.lane === "lesson_figures") {
    if (!source || !zoneFigure || !lesson.representation) {
      doubt = { status: "none", detail: "no first figure, so no later figure" };
    } else {
      extra = planLessonFigures({
        lessonQuestion: source.question, turnPlan: source.turnPlan, authority: source.authority, families: lesson.families,
        first: zoneFigure, narrationLanguage: "english", deadlineAt: Date.now() + 60_000, asks: probe.lessonFigureAsks,
      });
      doubt = extra.figures.length > 0
        ? { status: "drawn", detail: extra.figures.map((figure) => `${figure.ask.id} ${figure.representation.family ?? "?"}/${figure.representation.tier}`).join(", ") +
            (extra.misses.length ? `; miss ${extra.misses.map((miss) => `${miss.id}:${miss.reason}`).join(", ")}` : "") }
        : { status: "none", detail: extra.misses.map((miss) => `${miss.id}:${miss.reason}`).join(", ") || "no asks" };
    }
  } else if (probe.lane !== "dsa") {
    const layout = boardLayoutFor({ rows: source?.rows ?? [], diagram: zoneFigure, kind: "scene" });
    const skip = doubtFigureNeedSkip({
      granted: true, codeBoard: false, markedFigureIds: [], zoneFigure,
      zoneReturnable: Boolean(zoneFigure), zoneEmpty: !zoneFigure, zoneOccupied: !zoneFigure && zoneInkOccupied(layout),
    });
    const plans = figurePlans.get(`${probe.id}|figures`) ?? figurePlans.get(`${probe.id}|lesson-figures`) ?? null;
    if (lesson.check.status === "picture") {
      doubt = { status: "unknown", detail: "zone holds a picture only live; doubt figure not checked offline" };
    } else if (skip) {
      doubt = { status: "none", detail: `skip ${skip}` };
    } else if (!source && !plans) {
      doubt = { status: "unknown", detail: "no recorded plan" };
    } else if (plans && plans.need && plans.need.decision !== "new_figure") {
      doubt = { status: "none", detail: `need (recorded): ${plans.need.decision}` };
    } else {
      const outcome = await planDoubtFigure({
        lessonQuestion: probe.lessonQuestion, doubtTitle: doubtTurnTitle(probe.doubt), zoneFigure,
        deadlineAt: Date.now() + DOUBT_FIGURE_BUDGET_MS, signal: new AbortController().signal,
        planners: recordedPlanners(source, plans), debug: () => {},
      });
      const via = plans ? "recorded doubt plans" : "lesson plan restamped";
      if (outcome.status === "drawn") {
        doubtDrawn = outcome;
        doubt = { status: "drawn", detail: `${outcome.representation.family ?? "?"}/${outcome.representation.tier} (${via}${plans?.need ? "" : ", need assumed"})` };
      } else {
        doubt = { status: "none", detail: `${outcome.reason} (${via})` };
      }
    }
  }

  const verdict = matchExpectation(probe, lesson.check, doubt, irUnknown);
  return { probe, source, lesson, doubt, doubtDrawn, extra, irUnknown, ...verdict };
}

/** A row may go to a paid round only when its figures draw offline as it expects, or it expects text only. */
export function matchExpectation(probe: DoubtProbe, lesson: FigureCheck, doubt: FigureCheck, irUnknown: boolean): { matches: boolean; why: string } {
  const problems: string[] = [];
  const wantLesson = probe.expect.lessonFigure;
  if (wantLesson === "drawn" && lesson.status !== "drawn") problems.push(`lesson figure ${lesson.status}, expected drawn`);
  if (wantLesson === "none" && lesson.status !== "none") problems.push(`lesson figure ${lesson.status}, expected none`);
  if (wantLesson === "picture" && lesson.status !== "picture") problems.push(`lesson figure ${lesson.status}, expected a picture`);
  const wantsDoubtFigure = probe.expect.newFigure !== null && probe.expect.newFigureInScope;
  if (probe.lane === "lesson_figures" && doubt.status !== "drawn") problems.push("no later figure draws offline");
  else if (probe.lane !== "lesson_figures" && wantsDoubtFigure && doubt.status !== "drawn" && !(lesson.status === "picture" && doubt.status === "unknown")) {
    problems.push(`doubt figure ${doubt.status}, expected drawn`);
  }
  const textOnly = wantLesson !== "drawn" && !wantsDoubtFigure && probe.lane !== "lesson_figures";
  if (irUnknown && !textOnly) problems.push("IR unknown");
  if (probe.offlineOnly) return { matches: problems.length === 0, why: problems.length ? problems.join("; ") : "offline row ($0)" };
  return { matches: problems.length === 0, why: problems.length ? problems.join("; ") : textOnly ? "expects text only" : "draws as expected" };
}
