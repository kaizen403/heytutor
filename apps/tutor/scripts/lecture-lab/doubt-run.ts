/**
 * Lecture lab doubt harness: a lesson, then a doubt asked on its page.
 *
 * The lab ran lessons only (`lecturePipeline.ts`); a doubt is a different
 * turn with its own prompt, its own ink filter and its own save. This runner
 * replays the live doubt path for each row of `data/doubt-probes/doubts-v1.jsonl`:
 *
 * 1. The lesson. A physics, maths, chemistry or picture row runs the whole
 *    lesson through `runLecture` (paid, once per distinct lesson question in a
 *    round, or $0 from a prior round's `lessons/` with `--lessons`). A DSA row
 *    builds its worked example frames with `resolveDsaFrames` ($0, offline).
 * 2. The board. The lesson's rows are laid out with the live slot finder, so
 *    `workColumnRows` and `workColumnRoom` give the doubt prompt the rows and
 *    the room the live board would.
 * 3. The doubt. `buildDoubtPrompt` (or `buildMarkedDoubtPrompt` when the row
 *    circles a part or a row), `buildDoubtTeachingPrompt`, the dev server's
 *    `/api/chat` with live's continuation loop, then per segment
 *    `prepareVerifiedLessonSegments`, the streamed FOCUS fold and
 *    `doubtSegment` with the arm's pointing policy, as live.
 * 4. The pointing check. Every FOCUS / ANNOTATE that survives resolves with
 *    `resolveVerifiedDiagramFocusTargets` against the figure in the zone.
 * 5. The save. `doubtFigureRefFor` and `doubtTurnScene` build the doubt's
 *    artifacts, and `canonicalizeTurnSceneMetadata` runs in process with an
 *    in-memory `loadPageFigure` that returns the lesson's figure.
 *
 * Arms (`--arms`, default `today,pointing`): `today` grants nothing; `pointing`
 * grants DIAGRAM_DOUBT_POINTING to the turn (lane B's begin-turn
 * `doubtPointing`); `figures` also grants DIAGRAM_DOUBT_FIGURES (phase 2). The
 * grants are built by the lab, as live builds them from begin-turn, so they are
 * harmless against a server that knows neither flag.
 *
 * Usage (dev server must be up for a paid round; never build during one):
 *   cd apps/tutor
 *   # offline: parse the set, print the plan, smoke the doubt path on DSA frames and a fixture figure
 *   pnpm exec tsx scripts/lecture-lab/doubt-run.ts --dry-run
 *   # synthetic checks of doubtGrade
 *   pnpm exec tsx scripts/lecture-lab/doubt-run.ts --check
 *   # the paid round: both arms, live --max-usd cap
 *   caffeinate -i pnpm exec tsx scripts/lecture-lab/doubt-run.ts --max-usd 5 --concurrency 2 --out .lecture-lab/doubts-01
 *   # regrade a finished round with judgments.jsonl, no model calls
 *   pnpm exec tsx scripts/lecture-lab/doubt-run.ts --regrade .lecture-lab/doubts-01
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  IncrementalTagParser,
  getSegmentCommands,
  lessonNarrationText,
  parseStoredSegmentCommands,
  prepareVerifiedLessonSegments,
  resolveVerifiedDiagramFocusTargets,
  serializeSegmentCommands,
  verifiedDiagramHasDrawableInk,
  type DrawCommand,
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import {
  classifyDsaQuestion,
  compactConversationHistory,
  streamLLMResponse,
  type DiagramSubject,
  type SubjectFamiliarity,
} from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { DOUBT_FIGURE_REF_VERSION, type DoubtPointingPolicy } from "../../lib/boards/doubtFigureRef";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { resolveLlmEndpoint } from "../../lib/llm/llmProvider";
import { buildLabModelProfile, type LabModelProfile } from "../../lib/llm/labModelProfile";
import { LECTURE_LAB_STANDARD_MODEL_HEADER } from "../../lib/billing/flags";
import { MAX_LLM_CONTINUATIONS, TEXT_LAYOUT } from "../../features/tutor-session/constants";
import type { BoardLayoutState, BoardTextRect } from "../../features/tutor-session/types";
import {
  findWorkTextSlot,
  withWorkRowIdentity,
  workColumnMaxWidth,
  workColumnRoom,
  workColumnRows,
} from "../../features/tutor-session/lib/board/boardLayout";
import {
  buildMarkedDoubtPrompt,
  collectMarkCandidates,
  summarizeMarks,
  type BoardMark,
} from "../../features/tutor-session/lib/board/boardMarking";
import { buildDoubtPrompt, doubtTurnTitle } from "../../features/tutor-session/lib/input/askDoubt";
import { buildDoubtPointingPolicy, doubtActiveFigure } from "../../features/tutor-session/lib/turn/doubtPointing";
import { resolveDsaFrames } from "../../features/tutor-session/lib/code-lesson/dsaFrames";
import { repairLectureMarkup } from "../../features/tutor-session/lib/turn/lectureCueRepair";
import { createStreamedFocusFold } from "../../features/tutor-session/lib/turn/streamedFocusFold";
import { isTeachingResponseIncomplete } from "../../features/tutor-session/lib/turn/segmentPlanning";
import {
  buildDoubtTeachingPrompt,
  type DoubtTeachingPromptInput,
} from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import {
  doubtFigureRefFor,
  doubtSegment,
  doubtTurnScene,
  type BoardPageRecord,
} from "../../features/tutor-session/lib/turn/doubtTurn";
import { applyLectureLabHeaders } from "./labAuth";
import { labArtifactSlug, labUsesStandardModelHeader, PlannerUsageTracker } from "./diagramEval";
import { budgetedVisualNeedFetch } from "./labVisualNeed";
import { budgetedReferencePictureFetch, labReferencePicturePolicy } from "./labReferencePicture";
import {
  assertLabBudgetPreflight,
  labRequestBudgetDecision,
  LabSpendCap,
  reserveLabRequest,
  runBudgetedLabRows,
  type LabBudgetServerConfig,
} from "./run";
import type { LectureRun } from "./lecturePipeline";
import {
  DOUBT_ARMS,
  DOUBT_PROBE_LANES,
  doubtGradeSelfCheck,
  gradeDoubt,
  judgmentKey,
  parseDoubtJudgments,
  parseDoubtProbes,
  partMatchesTerms,
  summarizeDoubtGrades,
  type DoubtArm,
  type DoubtEvidence,
  type DoubtGrade,
  type DoubtProbe,
  type DoubtProbeLane,
  type PointedPart,
} from "./doubtGrade";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Low on purpose: the paid round is small, and the cap is enforced per request. */
const DEFAULT_MAX_USD = 5;
const DEFAULT_CONCURRENCY = 2;

interface Options {
  probes: string;
  lanes: DoubtProbeLane[] | null;
  only: string[] | null;
  limit: number | null;
  arms: DoubtArm[];
  out: string;
  origin: string;
  maxUsd: number;
  concurrency: number;
  model: "fast" | "standard";
  familiarity: SubjectFamiliarity;
  /** Prior doubt round whose `lessons/` are reused at $0. */
  lessons: string | null;
  /** Skip the lesson's teaching stream (cheaper; the board then holds only the given rows). */
  figureOnlyLessons: boolean;
  referencePicturePartFocus: boolean;
  productionStrictSubjects: DiagramSubject[] | null;
  dryRun: boolean;
  check: boolean;
  regrade: string | null;
}

function parseOptions(argv: string[]): Options {
  const flags = new Map<string, string>();
  const booleans = new Set(["dry-run", "check", "figure-only-lessons", "reference-picture-part-focus", "doubt-pointing", "doubt-figures"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > 0) {
      flags.set(token.slice(2, eq), token.slice(eq + 1));
      continue;
    }
    const name = token.slice(2);
    const next = argv[index + 1];
    if (booleans.has(name) || next === undefined || next.startsWith("--")) {
      flags.set(name, "true");
    } else {
      flags.set(name, next);
      index += 1;
    }
  }
  const list = (name: string): string[] | null => {
    const raw = flags.get(name);
    return raw ? raw.split(",").map((entry) => entry.trim()).filter(Boolean) : null;
  };
  const lanes = list("lanes");
  if (lanes?.some((lane) => !DOUBT_PROBE_LANES.includes(lane as DoubtProbeLane))) {
    throw new Error(`--lanes takes ${DOUBT_PROBE_LANES.join(", ")}`);
  }
  // --doubt-pointing and --doubt-figures are the flag names as switches: each adds its arm.
  const arms = new Set<DoubtArm>((list("arms") ?? ["today", "pointing"]) as DoubtArm[]);
  if (flags.get("doubt-pointing") === "true") arms.add("pointing");
  if (flags.get("doubt-figures") === "true") arms.add("figures");
  if ([...arms].some((arm) => !DOUBT_ARMS.includes(arm))) throw new Error(`--arms takes ${DOUBT_ARMS.join(", ")}`);
  const maxUsd = Number.parseFloat(flags.get("max-usd") ?? String(DEFAULT_MAX_USD));
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("--max-usd must be a positive number");
  const concurrency = Number.parseInt(flags.get("concurrency") ?? String(DEFAULT_CONCURRENCY), 10);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error("--concurrency takes 1 to 4");
  const model = flags.get("model") ?? "fast";
  if (model !== "fast" && model !== "standard") throw new Error("--model takes fast or standard");
  const strict = list("production-strict-subjects");
  if (strict && (!strict.includes("maths") || strict.some((entry) => entry !== "maths" && entry !== "physics"))) {
    throw new Error("--production-strict-subjects takes maths or maths,physics");
  }
  const limitRaw = flags.get("limit");
  return {
    probes: flags.get("probes") ?? "../../data/doubt-probes/doubts-v1.jsonl",
    lanes: lanes as DoubtProbeLane[] | null,
    only: list("only"),
    limit: limitRaw ? Number.parseInt(limitRaw, 10) : null,
    arms: DOUBT_ARMS.filter((arm) => arms.has(arm)),
    out: flags.get("out") ?? `.lecture-lab/doubts-${Date.now()}`,
    origin: flags.get("origin") ?? "http://127.0.0.1:3000",
    maxUsd,
    concurrency,
    model,
    familiarity: (flags.get("familiarity") as SubjectFamiliarity | undefined) ?? "normal",
    lessons: flags.get("lessons") ?? null,
    figureOnlyLessons: flags.get("figure-only-lessons") === "true",
    referencePicturePartFocus: flags.get("reference-picture-part-focus") === "true",
    productionStrictSubjects: strict as DiagramSubject[] | null,
    dryRun: flags.get("dry-run") === "true",
    check: flags.get("check") === "true",
    regrade: flags.get("regrade") ?? null,
  };
}

function loadProbes(options: Options): DoubtProbe[] {
  const all = parseDoubtProbes(readFileSync(resolve(process.cwd(), options.probes), "utf8"));
  const selected = all
    .filter((probe) => !options.lanes || options.lanes.includes(probe.lane))
    .filter((probe) => !options.only || options.only.includes(probe.id));
  return options.limit ? selected.slice(0, options.limit) : selected;
}

// ---------------------------------------------------------------------------
// The lesson and the board it leaves
// ---------------------------------------------------------------------------

const LESSON_RECORD_VERSION = "doubt-lab-lesson/v1" as const;

/** What a doubt needs from the lesson before it; stored so later rounds pay nothing. */
interface LessonRecord {
  schemaVersion: typeof LESSON_RECORD_VERSION;
  key: string;
  lessonQuestion: string;
  kind: "scene" | "picture" | "dsa" | "none";
  /** The figure in the zone when the lesson ended. DSA rows hold the chosen frame. */
  diagram: VerifiedDiagram | null;
  /** Turn.id the lab gives the lesson; the doubt's `pointsAtFigure` names it. */
  figureTurnId: string;
  dsa: { algorithmId: string; frameIndex: number; frameIds: string[]; frameCount: number } | null;
  turnPlan: TurnPlanV3 | null;
  solverProjection: unknown;
  /** Rows the lesson wrote down the left, in order: the runtime's givens, then the teaching's WRITE rows. */
  rows: string[];
  /** The lesson's spoken answer, for the doubt's conversation history. */
  lessonResponse: string;
  summary: {
    committed: boolean;
    figureSource: string | null;
    family: string | null;
    referencePicture: string | null;
    error: string | null;
    svg: string | null;
  };
  planner: LectureRun["planner"] | null;
}

function lessonKey(probe: DoubtProbe, options: Pick<Options, "referencePicturePartFocus" | "figureOnlyLessons" | "model" | "productionStrictSubjects">): string {
  const identity = JSON.stringify({
    q: probe.lessonQuestion,
    picture: probe.referencePicture,
    partFocus: options.referencePicturePartFocus,
    figureOnly: options.figureOnlyLessons,
    model: options.model,
    strict: options.productionStrictSubjects,
  });
  const words = probe.lessonQuestion.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return `${words}-${createHash("sha1").update(identity).digest("hex").slice(0, 10)}`;
}

/** A DSA lesson's walk-through, built offline exactly as live builds it before the code plan arrives. */
function dsaLesson(probe: DoubtProbe, key: string): LessonRecord {
  const frames = resolveDsaFrames(probe.lessonQuestion);
  const count = frames?.frames.length ?? 0;
  const wanted = probe.dsaFrame ?? -1;
  const frameIndex = count === 0 ? -1 : Math.min(Math.max(wanted < 0 ? count + wanted : wanted, 0), count - 1);
  const frame = frameIndex >= 0 ? frames!.frames[frameIndex]! : null;
  return {
    schemaVersion: LESSON_RECORD_VERSION,
    key,
    lessonQuestion: probe.lessonQuestion,
    kind: frame ? "dsa" : "none",
    diagram: frame?.presentation.diagram ?? null,
    figureTurnId: randomUUID(),
    dsa: frames && frame ? { algorithmId: frames.algorithmId, frameIndex, frameIds: frames.frames.map((entry) => entry.id), frameCount: count } : null,
    turnPlan: null,
    solverProjection: null,
    rows: [],
    lessonResponse: "",
    summary: { committed: Boolean(frame), figureSource: frame ? `dsa_${frames!.frameSource}` : null, family: frames?.algorithmId ?? null,
      referencePicture: null, error: frames ? null : "no worked example frames", svg: null },
    planner: null,
  };
}

/** Lay the lesson's rows out with the live slot finder; a full page turns, as live. */
function boardLayoutFor(lesson: LessonRecord): BoardLayoutState {
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
// The doubt
// ---------------------------------------------------------------------------

/** One streamed teaching request; the paid round uses the dev server, the dry run a script. */
type TeachingStream = (input: {
  systemPrompt: string;
  userPrompt: string;
  conversationHistory: { user: string; assistant: string }[];
  hasAuthoritativePlan: boolean;
  noReasoning: boolean;
  traceId: string;
  question: string;
}) => Promise<{ text: string; ttftMs: number | null; reasoningChars: number }>;

interface DoubtRecord {
  probeId: string;
  arm: DoubtArm;
  lessonKey: string;
  grants: { doubtPointing: boolean; doubtFigures: boolean };
  traceId: string;
  userPrompt: string;
  systemPromptChars: number;
  mark: { asked: DoubtProbe["mark"]; placed: boolean; summary: string | null };
  rawText: string;
  continuations: number;
  /** What the board was handed, segment by segment, after the live doubt filter. */
  segments: { narration: string; commands: string[] }[];
  evidence: DoubtEvidence;
  planner: LectureRun["planner"] | null;
  elapsedMs: number;
}

function focusModifiers(command: DrawCommand): string[] {
  return (command.semanticRef?.entityId ?? command.text ?? "").split("|").slice(1).map((entry) => entry.trim().toLowerCase());
}

function targetIds(command: DrawCommand): string[] {
  return (command.semanticRef?.entityId ?? command.text ?? "").split("|")[0]!.split(",").map((id) => id.trim()).filter(Boolean);
}

/** Lane B's `segmentWithoutFocusKeep`: a ring the turn was not offered is never drawn or saved. */
function withoutKeep(segment: TutorSegment): TutorSegment {
  const commands = getSegmentCommands(segment);
  let changed = false;
  const stripped = commands.map((command) => {
    if (command.type !== "FOCUS" || !focusModifiers(command).includes("keep")) return command;
    changed = true;
    const raw = command.semanticRef?.entityId ?? command.text ?? "";
    const [ids, ...modifiers] = raw.split("|");
    const target = [ids, ...modifiers.filter((entry) => entry.trim().toLowerCase() !== "keep")].join("|");
    return { ...command, text: target, ...(command.semanticRef ? { semanticRef: { ...command.semanticRef, entityId: target } } : {}) };
  });
  if (!changed) return segment;
  const next: TutorSegment = { ...segment, command: stripped[0] ?? null };
  if (stripped.length > 1) next.commands = stripped;
  else delete next.commands;
  return next;
}

/** The student's circle, built from the board's own mark candidates as the marking layer builds it. */
function markFor(probe: DoubtProbe, layout: BoardLayoutState, figure: VerifiedDiagram | null): BoardMark | null {
  if (!probe.mark) return null;
  const candidates = collectMarkCandidates(layout.rects, figure);
  const hit = candidates.find((candidate) => probe.mark === "figure_part"
    ? candidate.kind === "diagram" && candidate.entityId !== undefined &&
      partMatchesTerms({ id: candidate.entityId, labels: [candidate.text] }, probe.markTerms)
    : candidate.kind === "work" && probe.markTerms.some((term) =>
      candidate.text.replace(/\s+/g, "").toLowerCase().includes(term.replace(/\s+/g, "").toLowerCase())));
  if (!hit) return null;
  const target = { kind: hit.kind, text: hit.text, rect: hit.rect, workId: hit.workId, entityId: hit.entityId, meaning: hit.meaning };
  const { x, y, width, height } = hit.rect;
  return { id: `mark-${probe.id}`, gesture: "circle", points: [{ x, y }, { x: x + width, y: y + height }], bounds: hit.rect, target, targets: [target] };
}

export async function runDoubt(
  probe: DoubtProbe,
  lesson: LessonRecord,
  arm: DoubtArm,
  stream: TeachingStream,
  options: Pick<Options, "familiarity" | "model">,
): Promise<DoubtRecord> {
  const startedAt = Date.now();
  const traceId = randomUUID();
  const doubtPointing = arm !== "today";
  const doubtFigures = arm === "figures";
  const codeBoard = lesson.kind === "dsa";
  const zoneFigure = lesson.diagram;
  const codeFigureVisible = codeBoard && Boolean(zoneFigure) && verifiedDiagramHasDrawableInk(zoneFigure!);
  // The live helpers: a code board points at its frame only with the flag.
  const activeDiagram = doubtActiveFigure({ granted: doubtPointing, codeBoard, codeFigureVisible, zoneFigure });
  const frameIds = lesson.dsa?.frameIds ?? [];
  const policy: DoubtPointingPolicy = buildDoubtPointingPolicy({
    granted: doubtPointing,
    figure: activeDiagram,
    codeBoard,
    frameIds,
  });
  const layout = boardLayoutFor(lesson);
  const room = workColumnRoom(layout, Boolean(zoneFigure) && !codeBoard);
  const boardRows = workColumnRows(layout);
  const fastMode = options.model === "fast";

  // A variable, not a literal: `doubtFigures` is a phase 2 field the prompt
  // ignores until it lands, which is exactly a server that knows no such flag.
  const promptInput = {
    lessonQuestion: lesson.lessonQuestion,
    boardRows,
    rowsLeftOnPage: room.rowsLeft,
    nextRowY: room.nextRowY,
    diagramPromptAddon: activeDiagram?.promptAddon ?? null,
    codePanelShowing: false,
    codePanelText: null,
    codeLessonBoard: codeBoard,
    codeFigureVisible,
    turnPlan: lesson.turnPlan,
    solverProjection: lesson.solverProjection,
    familiarity: options.familiarity,
    fastMode,
    teachingNote: "",
    alwaysShowUnits: false,
    alwaysStateLawFirst: false,
    narrationLanguage: "english" as const,
    doubtPointing,
    doubtFigures,
    ...(codeBoard && doubtPointing && activeDiagram ? {
      codeFrameCells: activeDiagram.anchors
        .filter((anchor) => anchor.id.trim() && !frameIds.map((id) => id.toLowerCase()).includes(anchor.id.toLowerCase()))
        .map((anchor) => ({ id: anchor.id, labels: [...anchor.labels] })),
    } : {}),
  };
  const teachingPrompt = buildDoubtTeachingPrompt(promptInput as DoubtTeachingPromptInput);

  const mark = markFor(probe, layout, zoneFigure);
  const userPrompt = mark
    ? buildMarkedDoubtPrompt([mark], probe.doubt, lesson.lessonQuestion)
    : buildDoubtPrompt(probe.doubt || "explain this part again", lesson.lessonQuestion);
  const title = doubtTurnTitle(probe.doubt, mark ? summarizeMarks([mark]) : null);
  const history = compactConversationHistory(lesson.lessonResponse
    ? [{ user: lesson.lessonQuestion, assistant: lessonNarrationText(lesson.lessonResponse) }]
    : []);
  const hasAuthoritativePlan = Boolean(lesson.turnPlan && (lesson.turnPlan.givens.length > 0 || lesson.turnPlan.derived.length > 0 ||
    lesson.turnPlan.qualitativeClaims.length > 0 || lesson.turnPlan.lawIds.length > 0));

  const evidence: DoubtEvidence = {
    probeId: probe.id, arm, figurePresent: Boolean(zoneFigure), pointed: [], liveFocusIds: [], liveAnnotateIds: [],
    savedFocusIds: [], savedAnnotateIds: [], saveOk: false, saveError: null, pointsAtFigureUnresolved: false,
    newFigure: doubtFigures ? { drawn: false, summary: null } : null, ttftMs: null, error: null,
  };
  const record: DoubtRecord = {
    probeId: probe.id, arm, lessonKey: lesson.key, grants: { doubtPointing, doubtFigures }, traceId, userPrompt,
    systemPromptChars: teachingPrompt.systemPrompt.length,
    mark: { asked: probe.mark, placed: Boolean(mark), summary: mark ? summarizeMarks([mark]) : null },
    rawText: "", continuations: 0, segments: [], evidence, planner: null, elapsedMs: 0,
  };

  try {
    // Live's continuation loop, without the hedge and the startup retry reason.
    let fullResponse = "";
    let previousChunk = "";
    let continueCount = 0;
    let reasoningOnlyRetry = false;
    while (continueCount <= MAX_LLM_CONTINUATIONS) {
      const isContinuation = continueCount > 0 && !reasoningOnlyRetry;
      const requestStartedAt = Date.now();
      const result = await stream({
        systemPrompt: isContinuation ? teachingPrompt.continuationPrompt : teachingPrompt.systemPrompt,
        userPrompt: isContinuation ? "continue" : userPrompt,
        conversationHistory: compactConversationHistory(isContinuation
          ? [...history, { user: userPrompt, assistant: lessonNarrationText(fullResponse) }]
          : history),
        hasAuthoritativePlan,
        noReasoning: reasoningOnlyRetry,
        traceId,
        question: userPrompt,
      });
      if (evidence.ttftMs === null && result.ttftMs !== null) evidence.ttftMs = requestStartedAt - startedAt + result.ttftMs;
      fullResponse += result.text;
      if (result.text.trim().length === 0 && result.reasoningChars > 0 && !reasoningOnlyRetry && continueCount < MAX_LLM_CONTINUATIONS) {
        reasoningOnlyRetry = true;
        continueCount += 1;
        continue;
      }
      reasoningOnlyRetry = false;
      if (!isTeachingResponseIncomplete(result.text, fullResponse, previousChunk)) break;
      previousChunk = result.text;
      continueCount += 1;
    }
    record.continuations = continueCount;
    record.rawText = repairLectureMarkup(fullResponse);

    // Segment by segment, as the live hook hands them to the board.
    const parsed: TutorSegment[] = [];
    const parser = new IncrementalTagParser({ onSegmentReady: (segment) => parsed.push(segment) });
    parser.push(record.rawText);
    parser.flush();
    const fold = createStreamedFocusFold(activeDiagram, { codeLesson: false });
    const outgoing: TutorSegment[] = [];
    let lessonStarted = false;
    const queue = (segments: readonly TutorSegment[]) => {
      for (const segment of segments) {
        const kept = doubtSegment(segment, { codePanelShowing: false, boardRows, pointing: policy });
        if (!kept) continue;
        outgoing.push(doubtPointing && !codeBoard ? kept : withoutKeep(kept));
      }
    };
    for (const segment of parsed) {
      const prepared = prepareVerifiedLessonSegments([segment], activeDiagram);
      queue(fold.take(prepared.segments, { lessonStarted }));
      if (prepared.segments.some((entry) => /[\p{L}\p{N}]/u.test(entry.narration))) lessonStarted = true;
    }
    queue(fold.finish());

    for (const segment of outgoing) {
      const commands = getSegmentCommands(segment);
      record.segments.push({ narration: segment.narration, commands: commands.map((command) => `${command.type}${command.text !== undefined ? `:${command.text}` : ""}`) });
      for (const command of commands) {
        if (command.type !== "FOCUS" && command.type !== "ANNOTATE") continue;
        (command.type === "FOCUS" ? evidence.liveFocusIds : evidence.liveAnnotateIds).push(...targetIds(command));
        const kept = command.type === "FOCUS" && focusModifiers(command).includes("keep");
        for (const anchor of resolveVerifiedDiagramFocusTargets(command, activeDiagram)) {
          if (evidence.pointed.some((part) => part.id === anchor.id && part.via === command.type && part.kept === kept)) continue;
          evidence.pointed.push({ id: anchor.id, labels: [...anchor.labels], via: command.type, kept } satisfies PointedPart);
        }
      }
    }

    // The save, in process, with the lesson's figure as the page figure.
    const pageRecord: BoardPageRecord = {
      boardId: "doubt-lab-board",
      lessonQuestion: lesson.lessonQuestion,
      turnPlan: lesson.turnPlan,
      solverProjection: lesson.solverProjection,
      figureDrawn: Boolean(zoneFigure),
      figureTurnId: zoneFigure ? lesson.figureTurnId : null,
      turn: { kind: "doubt", question: title, continuesBoard: true, scene: null, saved: false },
    };
    const ref = doubtFigureRefFor({
      record: pageRecord, boardId: pageRecord.boardId, afterReplay: false, figureOnPage: Boolean(zoneFigure),
      storedTurns: [], activeDiagram: zoneFigure, codeLessonFrameIndex: lesson.dsa?.frameIndex ?? null,
    });
    const scene = doubtTurnScene(lesson.lessonQuestion, true, undefined, ref);
    const metadata: SubmittedTurnSceneMetadata = {
      question: title,
      visualStatus: "text_only",
      sceneArtifacts: scene.sceneArtifacts,
      segments: outgoing.map((segment, index) => {
        const commands = getSegmentCommands(segment);
        return {
          orderIndex: index,
          narration: segment.narration,
          spokenText: segment.narration,
          command: commands.length > 0 ? serializeSegmentCommands(commands, { trustedDiagramGeometry: false }) : null,
        };
      }),
    };
    const saved = await canonicalizeTurnSceneMetadata(metadata, {
      loadPageFigure: async (requested) =>
        zoneFigure && requested.schemaVersion === DOUBT_FIGURE_REF_VERSION && requested.turnId === lesson.figureTurnId
          ? structuredClone(zoneFigure) : null,
    });
    evidence.saveOk = saved.ok;
    if (saved.ok) {
      for (const segment of saved.value.segments) {
        for (const command of parseStoredSegmentCommands(segment.command)) {
          if (command.type === "FOCUS") evidence.savedFocusIds.push(...targetIds(command));
          if (command.type === "ANNOTATE") evidence.savedAnnotateIds.push(...targetIds(command));
        }
      }
      const telemetry = (saved.value.sceneArtifacts as { failureTelemetry?: { pointsAtFigureStatus?: string } } | null)?.failureTelemetry;
      evidence.pointsAtFigureUnresolved = telemetry?.pointsAtFigureStatus === "unresolved";
    } else {
      evidence.saveError = `${saved.error}`;
    }
  } catch (error) {
    evidence.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  record.elapsedMs = Date.now() - startedAt;
  return record;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function transcript(probe: DoubtProbe, lesson: LessonRecord, record: DoubtRecord, grade: DoubtGrade): string {
  const lines = [
    `# ${probe.id} (${record.arm})`,
    "",
    `**Lesson.** ${lesson.lessonQuestion}`,
    `**Figure.** ${lesson.kind}${lesson.summary.family ? ` (${lesson.summary.family})` : ""}${lesson.dsa ? `, frame ${lesson.dsa.frameIndex + 1} of ${lesson.dsa.frameCount}` : ""}${lesson.summary.svg ? `, ${lesson.summary.svg}` : ""}`,
    `**Doubt.** ${probe.doubt || "(nothing typed)"}${probe.mark ? ` (marked ${probe.mark}: ${record.mark.placed ? record.mark.summary : "NOT PLACED, no matching part"})` : ""}`,
    `**Expected.** point: ${probe.expect.point ?? "none"}; new figure: ${probe.expect.newFigure ?? "none"}${probe.expect.newFigureInScope ? "" : " (out of scope: must not draw)"}`,
    "",
    `pointing **${grade.pointing}** | new figure **${grade.newFigure}** | saved equals live ${grade.savedEqualsLive} | ttft ${record.evidence.ttftMs ?? "?"} ms${grade.needsHuman ? " | NEEDS HUMAN" : ""}`,
    "",
    `Pointed: ${record.evidence.pointed.map((part) => `${part.id}${part.labels.length ? ` [${part.labels.join(", ")}]` : ""}${part.kept ? " (kept)" : ""}`).join("; ") || "nothing"}`,
    ...(grade.reasons.length ? ["", ...grade.reasons.map((reason) => `- ${reason}`)] : []),
    ...(record.evidence.error ? ["", `Error: ${record.evidence.error}`] : []),
    "",
    "## What the board was handed",
    "",
    ...record.segments.map((segment, index) => `${index + 1}. ${segment.narration.trim()}${segment.commands.length ? `  \`${segment.commands.join(" ")}\`` : ""}`),
    "",
    "## Prompt",
    "",
    "```",
    record.userPrompt,
    "```",
  ];
  return `${lines.join("\n")}\n`;
}

function writeReports(outDir: string, probes: readonly DoubtProbe[], records: readonly DoubtRecord[], spend: unknown): ReturnType<typeof summarizeDoubtGrades> {
  const judgmentsPath = `${outDir}/judgments.jsonl`;
  const judgments = existsSync(judgmentsPath) ? parseDoubtJudgments(readFileSync(judgmentsPath, "utf8")) : new Map();
  const byId = new Map(probes.map((probe) => [probe.id, probe]));
  const graded = records.flatMap((record) => {
    const probe = byId.get(record.probeId);
    return probe ? [{ record, probe, grade: gradeDoubt(probe, record.evidence, judgments.get(judgmentKey(record.probeId, record.arm))) }] : [];
  });
  const summary = summarizeDoubtGrades(graded.map((row) => row.grade), graded.map((row) => row.record.evidence));
  writeFileSync(`${outDir}/grades.jsonl`, graded.map((row) => JSON.stringify(row.grade)).join("\n") + (graded.length ? "\n" : ""));
  const queue = graded.filter((row) => row.grade.needsHuman).map((row) => ({
    id: row.probe.id, arm: row.record.arm, lane: row.probe.lane, lessonQuestion: row.probe.lessonQuestion, doubt: row.probe.doubt,
    expect: row.probe.expect, pointed: row.record.evidence.pointed, grade: { pointing: row.grade.pointing, newFigure: row.grade.newFigure, wrongPins: row.grade.wrongPins },
    figure: `lessons/${row.record.lessonKey}.json`, transcript: `transcripts/${labArtifactSlug(row.probe.id)}-${row.record.arm}.md`,
    reasons: row.grade.reasons,
  }));
  writeFileSync(`${outDir}/judge-queue.jsonl`, queue.map((row) => JSON.stringify(row)).join("\n") + (queue.length ? "\n" : ""));
  writeFileSync(`${outDir}/summary.json`, `${JSON.stringify({ arms: summary, spend, judged: judgments.size, needsHuman: queue.length }, null, 1)}\n`);
  return summary;
}

function printSummary(summary: ReturnType<typeof summarizeDoubtGrades>): void {
  for (const arm of summary) {
    console.log(`\narm ${arm.arm}: ${arm.rows} rows, ${arm.errors} errors, ${arm.needsHuman} need a human`);
    console.log(`  pointing   ${JSON.stringify(arm.pointing)}`);
    console.log(`  new figure ${JSON.stringify(arm.newFigure)}`);
    console.log(`  wrong figures ${arm.wrongFigures}, wrong parts ${arm.wrongParts}, wrong pins ${arm.wrongPins}, saved equals live ${arm.savedEqualsLive.equal}/${arm.savedEqualsLive.rows}, ttft p50 ${arm.ttftP50Ms ?? "?"} ms`);
    console.log(`  bar: ${Object.entries(arm.bar).map(([name, value]) => `${name}=${value === null ? "n/a" : value ? "pass" : "FAIL"}`).join(" ")}`);
  }
}

// ---------------------------------------------------------------------------
// Offline modes
// ---------------------------------------------------------------------------

function runCheck(): void {
  const { checks, failures } = doubtGradeSelfCheck();
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.log(`doubtGrade: ${checks - failures.length}/${checks} checks pass`);
  if (failures.length > 0) process.exitCode = 1;
}

/** A scripted answer that points at the figure's first part and rings it, plus one unknown id. */
function scriptedStream(diagram: VerifiedDiagram | null): TeachingStream {
  const first = diagram?.anchors[0]?.id ?? "ghost_part";
  return async () => ({
    text: `[STEP] Look at this part of the figure. [FOCUS:${first}|keep] [/STEP]\n[STEP] And not this one. [FOCUS:ghost_part] [/STEP]\n[STEP] [WRITE:90,142:the part we looked at] So that is the answer to your doubt. [/STEP]`,
    ttftMs: 1,
    reasoningChars: 0,
  });
}

async function runDryRun(options: Options, probes: readonly DoubtProbe[]): Promise<void> {
  const byLane = new Map<string, DoubtProbe[]>();
  for (const probe of probes) byLane.set(probe.lane, [...(byLane.get(probe.lane) ?? []), probe]);
  console.log(`doubt set ${options.probes}: ${probes.length} rows, arms ${options.arms.join(", ")}`);
  for (const [lane, rows] of byLane) {
    const point = rows.filter((row) => row.expect.point !== null).length;
    const figure = rows.filter((row) => row.expect.newFigure !== null).length;
    const marked = rows.filter((row) => row.mark !== null).length;
    console.log(`  ${lane.padEnd(18)} ${String(rows.length).padStart(2)} rows: ${point} point, ${figure} new figure, ${rows.length - point - figure} neither, ${marked} marked`);
  }

  const keys = new Map<string, DoubtProbe[]>();
  for (const probe of probes) {
    if (probe.lane === "dsa") continue;
    const key = lessonKey(probe, options);
    keys.set(key, [...(keys.get(key) ?? []), probe]);
  }
  const recorded = options.lessons ? new Set(readdirSync(resolve(options.lessons, "lessons")).map((name) => name.replace(/\.json$/, ""))) : new Set<string>();
  const paidLessons = [...keys.keys()].filter((key) => !recorded.has(key));
  const pictureLessons = paidLessons.filter((key) => keys.get(key)![0]!.referencePicture).length;
  console.log(`\nlessons: ${keys.size} distinct paid lessons for ${probes.filter((probe) => probe.lane !== "dsa").length} rows (${keys.size - paidLessons.length} reused from --lessons), DSA lessons offline at $0`);
  for (const [key, rows] of keys) if (rows.length > 1) console.log(`  shared: ${key} by ${rows.map((row) => row.id).join(", ")}`);

  console.log("\nplan:");
  for (const probe of probes) {
    const lesson = probe.lane === "dsa" ? "dsa frames" : recorded.has(lessonKey(probe, options)) ? "recorded" : probe.referencePicture ? "paid + picture" : "paid";
    const expect = probe.expect.point ? `point: ${probe.expect.point}` : probe.expect.newFigure ? `new figure${probe.expect.newFigureInScope ? "" : " (out of scope)"}: ${probe.expect.newFigure}` : "no figure change";
    console.log(`  ${probe.id.padEnd(34)} ${probe.lane.padEnd(17)} lesson ${lesson.padEnd(15)} ${probe.mark ? `mark ${probe.mark} ` : ""}${expect}`);
  }

  // Rough ceilings for the cap, not a budget: the cap reserves each request's worst case live.
  const lessonUsd = 0.08;
  const doubtUsd = 0.02;
  const pictureUsd = labReferencePicturePolicy().reservationUsd;
  const estimate = paidLessons.length * lessonUsd + pictureLessons * pictureUsd + probes.length * options.arms.length * doubtUsd;
  console.log(`\nestimate: ${paidLessons.length} lessons x ~$${lessonUsd} + ${pictureLessons} picture reservations x $${pictureUsd.toFixed(2)} + ${probes.length * options.arms.length} doubts x ~$${doubtUsd} = ~$${estimate.toFixed(2)}; live cap --max-usd $${options.maxUsd.toFixed(2)}`);

  console.log("\noffline smoke (scripted answers, no model, no server):");
  const smokeRows: { probe: DoubtProbe; lesson: LessonRecord }[] = [];
  for (const probe of probes.filter((row) => row.lane === "dsa")) {
    const classified = classifyDsaQuestion(probe.lessonQuestion);
    const lesson = dsaLesson(probe, `dsa-${probe.id}`);
    console.log(`  ${probe.id.padEnd(34)} dsa=${classified.isDsa} ${lesson.dsa ? `${lesson.dsa.algorithmId}, frame ${lesson.dsa.frameIndex + 1}/${lesson.dsa.frameCount}, ${lesson.diagram?.anchors.length ?? 0} parts` : "NO FRAMES"}`);
    smokeRows.push({ probe, lesson });
  }
  const { checkpointSceneFixture } = await import("../verify/fixtures/checkpointScene");
  const { restoreVerifiedPresentationFromTurn } = await import("../../features/tutor-session/lib/scene/restoreVerifiedDiagram");
  const fixture = await checkpointSceneFixture();
  const lessonSaved = await canonicalizeTurnSceneMetadata(fixture.metadata);
  if (!lessonSaved.ok) throw new Error(`fixture lesson failed to save: ${lessonSaved.error}`);
  const restored = restoreVerifiedPresentationFromTurn({
    id: randomUUID(), question: fixture.question, visualStatus: "validated",
    sceneDocument: lessonSaved.value.sceneDocument, sceneArtifacts: lessonSaved.value.sceneArtifacts,
    segments: [{ orderIndex: 0, command: { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" } }],
  } as Parameters<typeof restoreVerifiedPresentationFromTurn>[0]);
  const fixtureProbe: DoubtProbe = {
    id: "fixture-number-line", lane: "physics_maths", lessonQuestion: fixture.question, doubt: "Why does the arrow start here?",
    mark: null, markTerms: [], dsaFrame: null, referencePicture: false,
    expect: { point: "the starting value", pointTerms: ["start", "2"], newFigure: null, newFigureInScope: true },
  };
  smokeRows.push({ probe: fixtureProbe, lesson: {
    schemaVersion: LESSON_RECORD_VERSION, key: "fixture", lessonQuestion: fixture.question, kind: "scene",
    diagram: restored?.diagram ?? null, figureTurnId: randomUUID(), dsa: null, turnPlan: null, solverProjection: null,
    rows: ["a = 2", "b = 3", "2 + 3 = 5"], lessonResponse: "", planner: null,
    summary: { committed: true, figureSource: "fixture", family: null, referencePicture: null, error: null, svg: null },
  } });
  // The two marks a student can make: a figure part and a work row, built from the board's own candidates.
  const fixtureLesson = smokeRows[smokeRows.length - 1]!.lesson;
  smokeRows.push(
    { probe: { ...fixtureProbe, id: "fixture-marked-part", doubt: "", mark: "figure_part", markTerms: ["start"] }, lesson: fixtureLesson },
    { probe: { ...fixtureProbe, id: "fixture-marked-row", doubt: "why five?", mark: "row", markTerms: ["2 + 3 = 5"] }, lesson: fixtureLesson },
  );
  let smokeFailures = 0;
  for (const { probe, lesson } of smokeRows) {
    for (const arm of options.arms) {
      const record = await runDoubt(probe, lesson, arm, scriptedStream(lesson.diagram), options);
      const grade = gradeDoubt(probe, record.evidence);
      const e = record.evidence;
      // The scripted ring may stay only on a figure board with the flag; the unknown id never survives.
      const keptRing = e.pointed.some((part) => part.kept);
      const ok = !e.error && e.saveOk && !e.liveFocusIds.includes("ghost_part") && grade.savedEqualsLive &&
        keptRing === (arm !== "today" && lesson.kind === "scene") &&
        (lesson.kind === "dsa" && arm === "today" ? e.liveFocusIds.length === 0 : e.liveFocusIds.length > 0);
      const markOk = !probe.mark || (record.mark.placed && record.userPrompt.includes("i marked this on the board"));
      if (!ok || !markOk) smokeFailures += 1;
      console.log(`    ${ok && markOk ? "ok  " : "FAIL"} ${probe.id} ${arm.padEnd(8)}${probe.mark ? ` mark ${record.mark.summary ?? "NOT PLACED"}` : ""} live FOCUS [${e.liveFocusIds.join(", ")}] saved [${e.savedFocusIds.join(", ")}] kept ring ${keptRing} pointing ${grade.pointing}${e.error ? ` error ${e.error}` : ""}${e.saveError ? ` save ${e.saveError}` : ""}`);
    }
  }
  console.log(`offline smoke: ${smokeFailures === 0 ? "all rows ok" : `${smokeFailures} FAILED`}`);
  if (smokeFailures > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// The paid round
// ---------------------------------------------------------------------------

interface Ledger {
  spendCap: LabSpendCap;
  usageTracker: PlannerUsageTracker;
  deniedTraces: Set<string>;
  writeCheckpoint: () => void;
  restore: () => void;
}

/**
 * The live cap: every chat, visual need and picture request reserves its
 * worst case before dispatch and settles after, through the same pieces
 * run.ts uses (conservative spend mode). A request the cap would push over
 * `--max-usd` is never sent, and the row is recorded as untested.
 */
function installBudgetedFetch(input: {
  origin: string; cookie: string; maxUsd: number; checkpointPath: string; standardModelHeader: boolean;
  endpoint: ReturnType<typeof resolveLlmEndpoint>; profile: LabModelProfile; serverConfig: LabBudgetServerConfig;
}): Ledger {
  const nativeFetch = globalThis.fetch;
  const spendCap = new LabSpendCap(input.maxUsd, "conservative");
  const deniedTraces = new Set<string>();
  const writeCheckpoint = () => writeFileSync(input.checkpointPath, `${JSON.stringify(spendCap.summary(0, 0), null, 1)}\n`);
  const settle = (reserved: number, usd: number, observation?: Parameters<LabSpendCap["settleCall"]>[2], context?: Parameters<LabSpendCap["settleCall"]>[3]) => {
    spendCap.settleCall(reserved, usd, observation, context);
    writeCheckpoint();
  };
  const usageTracker = new PlannerUsageTracker((usd, reserved, observation, context) => settle(reserved, usd, observation, context), "conservative");
  globalThis.fetch = (async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    const headers = new Headers(request instanceof Request ? request.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (url.startsWith(input.origin)) {
      headers.set("cookie", input.cookie);
      applyLectureLabHeaders(headers);
      if (input.standardModelHeader) headers.set(LECTURE_LAB_STANDARD_MODEL_HEADER, "1");
    }
    const traceId = headers.get("x-heytutor-trace-id");
    const deny = () => { if (traceId) deniedTraces.add(traceId); };
    if (url === `${input.origin}/api/visual-need`) {
      return budgetedVisualNeedFetch(request, { ...init, headers }, nativeFetch, {
        reserve: (usd) => spendCap.reserveCall(usd), spendMode: "conservative", beforeDispatch: writeCheckpoint,
        settle: (reserved, charged, observation) => settle(reserved, charged, observation, { traceId, kind: "visual_need" }),
        onAccounting: () => writeCheckpoint(), onDenied: deny,
      });
    }
    if (url === `${input.origin}/api/reference-picture`) {
      return budgetedReferencePictureFetch(request, { ...init, headers }, nativeFetch, {
        reserve: (usd) => spendCap.reserveCall(usd), spendMode: "conservative", traceId,
        reservationUsd: labReferencePicturePolicy().reservationUsd, beforeDispatch: writeCheckpoint,
        settle: (reserved, charged, observation) => settle(reserved, charged, observation, { traceId, kind: "reference_picture" }),
        onAccounting: () => writeCheckpoint(), onDenied: deny,
      });
    }
    const budget = labRequestBudgetDecision({ url, origin: input.origin, headers, init, endpoint: input.endpoint, profile: input.profile, serverConfig: input.serverConfig });
    const chatTrace = budget.chatRequest ? traceId : null;
    if (budget.shouldBudget && budget.chatRequest && !chatTrace) throw new Error("a paid chat request carried no trace id");
    if (budget.directProviderRequest) throw new Error("the doubt lab sends no direct provider request (no example picker)");
    const operation = (async () => {
      if (budget.shouldBudget) {
        try {
          await reserveLabRequest(spendCap, budget.worstCaseUsd, init?.signal);
        } catch (error) {
          deny();
          throw error;
        }
        writeCheckpoint();
      }
      if (chatTrace) usageTracker.recordRequest(chatTrace, budget.worstCaseUsd, budget.plannerRequest ? "planner" : "teaching", budget.maxAttempts);
      const startedAt = Date.now();
      let accounted = false;
      try {
        const response = await nativeFetch(request, { ...init, headers });
        if (chatTrace && budget.plannerRequest) {
          await usageTracker.recordResponse(chatTrace, response, budget.worstCaseUsd, budget.maxAttempts, budget.model, { elapsedMs: Date.now() - startedAt });
        } else if (chatTrace) {
          usageTracker.recordStreamingResponse(chatTrace, response, budget.worstCaseUsd, budget.maxAttempts, budget.model);
        }
        accounted = true;
        return response;
      } catch (error) {
        if (!accounted && chatTrace) usageTracker.recordFailure(chatTrace, budget.model, budget.worstCaseUsd, {});
        throw error;
      }
    })();
    if (chatTrace) usageTracker.trackOperation(chatTrace, operation);
    return operation;
  }) as typeof fetch;
  return { spendCap, usageTracker, deniedTraces, writeCheckpoint, restore: () => { globalThis.fetch = nativeFetch; } };
}

async function paidLesson(probe: DoubtProbe, key: string, options: Options, cookie: string, ledger: Ledger, outDir: string): Promise<LessonRecord> {
  const { runLecture } = await import("./lecturePipeline");
  const traceId = randomUUID();
  let diagram: VerifiedDiagram | null = null;
  const run = await runLecture(probe.lessonQuestion, {
    origin: options.origin, cookie, familiarity: options.familiarity, fastMode: options.model === "fast", traceId,
    probeId: `doubt-lesson|${key}`, figureOnly: options.figureOnlyLessons,
    productionStrictSubjects: options.productionStrictSubjects, spendMode: "conservative",
    referencePicture: probe.referencePicture, referencePicturePartFocus: options.referencePicturePartFocus,
    onPresentation: (presentation) => { diagram = presentation.diagram; },
  });
  const planner = await ledger.usageTracker.finishAsync(traceId);
  if (ledger.deniedTraces.has(traceId)) throw new BudgetStop(`budget ended during the lesson for ${probe.id}`);
  const shown = diagram as VerifiedDiagram | null;
  const picture = run.referencePicture?.status === "shown";
  let svg: string | null = null;
  if (run.diagram.svg) {
    mkdirSync(`${outDir}/frames`, { recursive: true });
    svg = `frames/${key}.svg`;
    writeFileSync(`${outDir}/${svg}`, run.diagram.svg);
  }
  return {
    schemaVersion: LESSON_RECORD_VERSION,
    key,
    lessonQuestion: probe.lessonQuestion,
    kind: shown ? (picture ? "picture" : "scene") : "none",
    diagram: shown,
    figureTurnId: randomUUID(),
    dsa: null,
    turnPlan: (run.figureReplayInputs?.selection.turnPlan as TurnPlanV3 | undefined) ?? null,
    solverProjection: run.figureReplayInputs?.authority?.projection ?? null,
    rows: [...run.givenRows, ...run.teaching.writes.map((write) => write.text).filter((text) => text.trim().length > 0)],
    lessonResponse: run.teaching.rawText,
    summary: { committed: run.diagram.committed, figureSource: run.diagram.figureSource ?? null, family: run.diagram.family,
      referencePicture: run.referencePicture?.status ?? null, error: run.error, svg },
    planner,
  };
}

class BudgetStop extends Error {}

async function runPaidRound(options: Options, probes: readonly DoubtProbe[]): Promise<void> {
  if (existsSync(resolve(process.cwd(), ".env.local"))) process.loadEnvFile(resolve(process.cwd(), ".env.local"));
  const outDir = resolve(process.cwd(), options.out);
  const checkpointPath = `${outDir}/spend-checkpoint.json`;
  if (existsSync(checkpointPath)) throw new Error("output has a spend checkpoint; pick a new --out, never erase prior spend");
  for (const dir of ["lessons", "doubts", "transcripts"]) mkdirSync(`${outDir}/${dir}`, { recursive: true });

  const endpoint = resolveLlmEndpoint();
  if (options.model === "fast" && endpoint.provider !== "fireworks") throw new Error("--model fast is the Fireworks production routing");
  const profile = buildLabModelProfile({ endpoint, env: process.env, fastMode: options.model === "fast" });
  const configHeaders = new Headers();
  applyLectureLabHeaders(configHeaders);
  const configResponse = await fetch(`${options.origin}/api/lecture-lab/config`, { headers: configHeaders });
  if (!configResponse.ok) throw new Error("authenticated lab provider preflight failed (is the dev server up?)");
  const serverConfig = await configResponse.json() as LabBudgetServerConfig;
  assertLabBudgetPreflight(profile, serverConfig);
  const landing = await fetch(`${options.origin}/`, { redirect: "manual" });
  const cookie = (landing.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
  if (!cookie) throw new Error("dev server issued no anonymous session cookie");

  const ledger = installBudgetedFetch({
    origin: options.origin, cookie, maxUsd: options.maxUsd, checkpointPath, endpoint, profile, serverConfig,
    standardModelHeader: labUsesStandardModelHeader(endpoint.provider, false, options.model),
  });
  ledger.writeCheckpoint();
  const stream: TeachingStream = async (request) => {
    const result = await streamLLMResponse({
      systemPrompt: request.systemPrompt, userPrompt: request.userPrompt, conversationHistory: request.conversationHistory,
      proxyUrl: `${options.origin}/api/chat`, hasAuthoritativePlan: request.hasAuthoritativePlan, fastMode: options.model === "fast",
      noReasoning: request.noReasoning, traceId: request.traceId, question: request.question,
    });
    return { text: result.text, ttftMs: result.streamStats?.ttftContentMs ?? null, reasoningChars: result.streamStats?.reasoningChars ?? 0 };
  };

  const recorded = new Map<string, LessonRecord>();
  if (options.lessons) {
    for (const name of readdirSync(resolve(options.lessons, "lessons")).filter((file) => file.endsWith(".json"))) {
      const lesson = JSON.parse(readFileSync(resolve(options.lessons, "lessons", name), "utf8")) as LessonRecord;
      if (lesson.schemaVersion === LESSON_RECORD_VERSION) recorded.set(lesson.key, lesson);
    }
  }
  const pending = new Map<string, Promise<LessonRecord>>();
  const lessonFor = (probe: DoubtProbe): Promise<LessonRecord> => {
    const key = probe.lane === "dsa" ? `dsa-${labArtifactSlug(probe.id)}` : lessonKey(probe, options);
    const existing = pending.get(key);
    if (existing) return existing;
    const made = (async () => {
      const lesson = probe.lane === "dsa" ? dsaLesson(probe, key) : recorded.get(key) ?? await paidLesson(probe, key, options, cookie, ledger, outDir);
      writeFileSync(`${outDir}/lessons/${key}.json`, `${JSON.stringify(lesson, null, 1)}\n`);
      return lesson;
    })();
    pending.set(key, made);
    return made;
  };

  console.log(`doubt lab: ${probes.length} rows x arms ${options.arms.join(", ")}, concurrency ${options.concurrency}, live cap $${options.maxUsd.toFixed(2)}, model ${options.model} -> ${options.out}`);
  const records: DoubtRecord[] = [];
  const untested: string[] = [];
  const spend = () => ({ ...ledger.spendCap.summary(records.length, probes.length * options.arms.length), untested });
  let done = 0;
  try {
    await runBudgetedLabRows(probes, options.concurrency, ledger.spendCap, async (probe) => {
      let lesson: LessonRecord;
      try {
        lesson = await lessonFor(probe);
      } catch (error) {
        if (!(error instanceof BudgetStop)) throw error;
        untested.push(probe.id);
        console.log(`budget ended before ${probe.id}; untested`);
        return;
      }
      for (const arm of options.arms) {
        const record = await runDoubt(probe, lesson, arm, stream, options);
        record.planner = await ledger.usageTracker.finishAsync(record.traceId);
        if (ledger.deniedTraces.has(record.traceId)) {
          untested.push(`${probe.id}|${arm}`);
          console.log(`budget ended during ${probe.id} (${arm}); untested, not a grade`);
          continue;
        }
        records.push(record);
        const slug = `${labArtifactSlug(probe.id)}-${arm}`;
        writeFileSync(`${outDir}/doubts/${slug}.json`, `${JSON.stringify(record, null, 1)}\n`);
        const grade = gradeDoubt(probe, record.evidence);
        writeFileSync(`${outDir}/transcripts/${slug}.md`, transcript(probe, lesson, record, grade));
        done += 1;
        console.log(`[${done}] ${probe.id} ${arm}: pointing ${grade.pointing}, figure ${grade.newFigure}, saved=live ${grade.savedEqualsLive}${record.evidence.error ? `, error ${record.evidence.error}` : ""} ($${ledger.spendCap.summary(0, 0).chargedUsd.toFixed(4)})`);
      }
      writeReports(outDir, probes, records, spend());
    });
  } finally {
    ledger.restore();
    ledger.writeCheckpoint();
  }
  const summary = writeReports(outDir, probes, records, spend());
  printSummary(summary);
  const final = ledger.spendCap.summary(records.length, probes.length * options.arms.length);
  console.log(`\nspend: $${final.chargedUsd.toFixed(4)} charged (conservative), $${final.knownUsageUsd.toFixed(4)} measured, cap $${final.maxUsd.toFixed(2)}${final.stoppedForBudget ? ", STOPPED FOR BUDGET" : ""}; ${untested.length} untested`);
  if (options.arms.includes("figures")) console.log("figures arm: the doubt figure path (phase 2) is not in this build; new figure grades read none until it lands");
}

function runRegrade(options: Options, probes: readonly DoubtProbe[]): void {
  const dir = resolve(process.cwd(), options.regrade!);
  const records = readdirSync(`${dir}/doubts`).filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(`${dir}/doubts/${name}`, "utf8")) as DoubtRecord);
  const spend = existsSync(`${dir}/summary.json`) ? (JSON.parse(readFileSync(`${dir}/summary.json`, "utf8")) as { spend?: unknown }).spend : null;
  printSummary(writeReports(dir, probes, records, spend));
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.check) return runCheck();
  const probes = loadProbes(options);
  if (options.dryRun) return runDryRun(options, probes);
  if (options.regrade) return runRegrade(options, probes);
  return runPaidRound(options, probes);
}

if (process.argv[1]?.endsWith("doubt-run.ts")) {
  void main().catch((error) => { console.error(error); process.exitCode = 1; });
}
