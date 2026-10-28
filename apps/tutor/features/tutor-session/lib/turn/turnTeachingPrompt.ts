/**
 * Assembles the teaching prompt for one turn.
 *
 * This used to live inline in `useQuestionHandler`, which meant the only way to
 * see what the tutor is actually told was to run the browser. Every offline
 * lecture probe then rebuilt its own approximation of the prompt and measured
 * that instead of the product. The assembly is pure, so it lives here and both
 * the live hook and `scripts/lecture-lab` call the same function: a lecture the
 * lab grades is the lecture a student gets.
 */
import { WORK_ZONE, type TutorSegment } from "@heytutor/drawing";
import {
  HINGLISH_NARRATION_ADDON,
  type NarrationLanguage,
  CHEMISTRY_LESSON_RUNTIME_ADDON,
  CODE_LESSON_SYSTEM_PROMPT,
  DSA_EXPLANATION_SYSTEM_PROMPT,
  CONCEPT_LESSON_RUNTIME_ADDON,
  DERIVATION_ORDER_POLICY,
  FAMILIARITY_ADDONS,
  FAST_MODE_TEACHING_ADDON,
  TUTOR_CONTINUATION_PROMPT,
  TUTOR_SYSTEM_PROMPT,
  ROW_FIRST_TEACHING_PROMPT,
  TEACHING_STATEMENT_TRUTH_ADDON,
  buildGivenValueSegments,
  buildDsaOpeningSegments,
  buildLessonOpeningSegment,
  codeLessonBeatPlan,
  codeLessonPromptAddon,
  dsaOpeningPromptAddon,
  givenValuesPromptAddon,
  isConceptLessonQuestion,
  isQuotedPhysicalConstant,
  lessonScopePromptAddon,
  questionStatesValue,
  remainingCodeLessonBeats,
  LESSON_OPENING_PROMPT_ADDON,
  resolveLessonBudget,
  type CodeLessonFigureFrame,
  type CodeLessonPlan,
  type DsaTeachingPolicy,
  type LessonBudget,
  type SubjectFamiliarity,
} from "@heytutor/tutor-core";
import { isChemistryQuestion, readPlanExample, type TurnPlanV3 } from "@heytutor/scene-engine";
import { teachingPromptAddon } from "@/lib/account/userSettings";
import { BOARD_WORK_ROWS_PER_PAGE } from "../../constants";
import type { PausedLessonReason } from "./doubtTurn";

export interface TurnTeachingPromptInput {
  question: string;
  /** `VerifiedDiagram.promptAddon` when a figure was committed, else null. */
  diagramPromptAddon: string | null;
  /** The committed figure's `source.exampleSpecies` when it is the plan's example, else null. */
  figureExampleSpecies?: string | null;
  turnPlan: TurnPlanV3 | null;
  /** `ProblemAuthorityV1Response["projection"]` when the solver answered. */
  solverProjection: unknown;
  codeLesson: CodeLessonPlan | null;
  /** The question requests an explanation of the worked example without code. */
  codeLessonIncludeCode?: boolean;
  /**
   * The walk-through frames actually committed to the board, in order. The
   * teaching prompt narrates these; describing the planner's requested steps
   * instead is how the tutor ended up talking about frames the student could
   * not see.
   */
  codeLessonFrames?: readonly CodeLessonFigureFrame[];
  codeLessonTeachingPolicy?: DsaTeachingPolicy;
  /** Facts about the detected algorithm, for the concept beats and the close. */
  codeLessonFacts?: {
    terms?: readonly string[];
    resultText?: string;
    earlyExit?: boolean;
    example?: Record<string, unknown> | null;
  };
  /** The stem is a coding problem, whether or not the code lesson compiled. */
  isDsa: boolean;
  familiarity: SubjectFamiliarity;
  fastMode: boolean;
  /** Account teaching note and tutor toggles. Never sent to scene-engine. */
  teachingNote?: string | null;
  alwaysShowUnits?: boolean;
  alwaysStateLawFirst?: boolean;
  /** "hinglish" when the Sarvam voice speaks: the narration changes, the board does not. */
  narrationLanguage?: NarrationLanguage;
  /** The runtime spoke only its safe acknowledgement, not question framing. */
  earlyOpeningAcknowledgement?: boolean;
}

export interface TurnTeachingPrompt {
  systemPrompt: string;
  continuationPrompt: string;
  /**
   * The one spoken beat that leads the turn: what this question is and what
   * the lesson is about to do. It writes nothing, and it is kept out of
   * `givenSegments` because those rows are numbered work rows and this is not
   * one of them.
   */
  openingSegment: TutorSegment | null;
  /** "Given: ..." rows the runtime writes before the model's first step. */
  givenSegments: TutorSegment[];
  lessonBudget: LessonBudget;
  runtimeAddon: string;
}

const TEXT_ONLY_DIAGRAM_ADDON = `The semantic scene engine selected text-only mode because no fully validated diagram was available.
Do not emit any drawing, label, annotation, erase, highlight, or marker-movement tags.
WRITE the available work area as the student notebook: names, definitions, relations, substitutions, and results. Every step must [WRITE] a short board line. Do not speak while the marker stays parked.
With no figure available, carry the setup in words and on the board: name every object, direction, and relation the question describes and write those names down before you use them.`;

const NO_FIGURE_NARRATION_ADDON = `BOARD STATE: NO VERIFIED FIGURE
There is no diagram, plot, picture or worked-example figure on this board. This overrides any earlier example, opening or subject instruction that assumes a figure was revealed or tells you to read one.
A diagram mentioned by the question or plan is not a picture on this board. Describe the stated setup and relations in words and symbolic notebook rows, without inventing visible geometry, labels, directions or apparatus.
Never say "look at the figure", "as shown", "this arrow", "the graph on the right", or otherwise claim that an absent part is visible. Do not promise to draw or reveal a figure, announce that one failed, or explain internal tooling.
You may discuss a graph, axis, curve or geometric object as mathematics: explain its definition or the relation it would represent, rather than saying the student can see it. Keep the question's actual quantities, reasoning and requested solution.
Do not emit [FOCUS] or [ANNOTATE]. Existing notebook rows may still be referenced with [EMPHASIZE] under the normal visible-row rules. Keep this turn's existing WRITE or TYPE ownership; the absence of a figure does not change it.`;

function noFigurePromptAddon(codeBoard: boolean): string {
  return codeBoard ? NO_FIGURE_NARRATION_ADDON : `${NO_FIGURE_NARRATION_ADDON}
The notebook uses the full available board width rather than a narrow column beside an empty figure area. Keep rows readable; the runtime wraps lines and turns pages when needed.`;
}

const CODE_LESSON_NO_DIAGRAM_ADDON = `No verified diagram is available for this code lesson.
Do not emit any drawing, label, annotation, erase, highlight, or marker-movement tags, and never use [WRITE].
Teach with narration and reveal committed code blocks with [TYPE:blockId] only.`;

// A DSA question whose code lesson failed still must not hand-write code:
// handwriting is for a notebook, and source read letter by letter in ink
// teaches nothing. Such a turn teaches the idea in words instead.
const DSA_WITHOUT_CODE_LESSON_ADDON = `CODE LESSON UNAVAILABLE — the validated code panel could not be prepared, so this turn teaches the algorithm without code. It owns the whole lesson; ignore any instruction above about figures, given values, or filling the board.

Teach it as an idea and a worked example, one step each, in this order: the problem in plain words with its concrete example; the obvious slow way and why it is too slow; the idea that fixes it; the invariant the loop keeps; the example traced by hand, one move per step, saying the values out loud; the answer; the time and space complexity with the reason for each.

The left column is a notebook, not an editor. [WRITE] at most one short phrase per step, under forty characters, with no comma, no bracket and no code: "sort, then two pointers", "skip equal values", "time n squared". Never write a statement, a signature, a loop header, a list literal, or anything a student would type into an editor, and never dictate code aloud.`;

/**
 * Continuing a code lesson. The general continuation prompt demands a board
 * row in every continued step, which on this turn is forbidden ink.
 */
const CODE_LESSON_CONTINUATION_PROMPT = `Continue the code lesson exactly where the previous response stopped. Return only [STEP]...[/STEP] blocks, following the same lesson shape and the same rules: one [FOCUS:frame_id|spotlight] on a figure step, one [TYPE:blockId] on a code step, no tag on an opening, a trace-through or a close, and never [WRITE]. Do not restate anything already said, do not summarise what came before, and do not start again from the beginning.`;
const DSA_EXPLANATION_CONTINUATION_PROMPT = `Continue the worked example exactly where the previous response stopped. Return only [STEP]...[/STEP] blocks. Use one [FOCUS:frame_id|spotlight] for each remaining figure step and no tag on the close. Never use [TYPE] or [WRITE]. Explain the actual values and decisions, then close with the reason for time and space complexity. Do not recap or restart.`;

/** Presentation shape only: the existing solver audit remains numeric authority. */
function hasSolverBindingContext(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const projection = value as Record<string, unknown>;
  if (projection.schemaVersion !== "solver-authority/v1" || projection.status !== "verified" ||
      !Array.isArray(projection.bindings) || projection.bindings.length === 0) return false;
  return projection.bindings.every((value: unknown) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const binding = value as Record<string, unknown>;
    const number = binding.approximate;
    return [binding.requestId, binding.quantityId, binding.symbol].every(value => typeof value === "string" && value.trim().length > 0) &&
      (typeof number === "number" && Number.isFinite(number) ||
        Array.isArray(number) && number.length > 0 && number.every(value => typeof value === "number" && Number.isFinite(value)));
  });
}

/**
 * The plan and solver blocks. Shared by a lesson and by a doubt about it, so
 * the doubt is held to the same numbers, and the same "not stated by the
 * question" rule, as the lesson that wrote them on the board.
 */
function turnPlanPromptAddons(
  question: string,
  turnPlan: TurnPlanV3 | null,
  solverProjection: unknown,
): { turnPlanPromptAddon: string; solverPromptAddon: string } {
  // A planner given is not the same thing as a stated given. Asked to draw a
  // Young's double slit setup, the planner supplied d, D, λ, t and n, each
  // marked `provenance: "given"` and each admitting in its own sourceText that
  // it was a "typical value, not stated in question". The lesson then said
  // "substitute the given values", and one turn told a student that Earth's
  // magnetic field is one tesla. The board row has always been gated on
  // `questionStatesValue`; the prompt was not, so it is gated here too and the
  // assumed values are handed over labelled as assumptions.
  const assumedSymbols = Array.from(
    new Set(
      (turnPlan?.givens ?? []).flatMap((given) => {
        const row = given as { value?: unknown; symbol?: unknown; id?: unknown };
        const value = row.value;
        if (typeof value !== "number" || !Number.isFinite(value)) return [];
        if (questionStatesValue(question, value)) return [];
        const symbol = typeof row.symbol === "string" ? row.symbol
          : typeof row.id === "string" ? row.id
          : null;
        if (!symbol) return [];
        // g, c and h are quoted, not invented. Asking the tutor to say
        // "suppose the speed of light is three times ten to the eight" would
        // be worse than the fabricated givens this rule exists to catch.
        if (isQuotedPhysicalConstant(symbol.normalize("NFKC"), value)) return [];
        return [symbol];
      }),
    ),
  );

  // A projection can confirm one output while unrelated planner working and
  // qualitative claims remain unproved. Never give the whole plan its status.
  // The planner also stores transport and repair notes in this legacy list.
  // Those explain pipeline decisions, never conditions of the student's problem.
  const assumptions = (turnPlan?.assumptions ?? []).filter((text) =>
    !/^(?:A verified illustration is required|Turn-plan model was unavailable|Mock mode does not solve|Removed \d+ (?:invalid planner dependency|directional sign))/.test(text),
  );
  const turnPlanPromptAddon = turnPlan
    ? `TURN PLAN V3 (PLANNER WORKING; NOT A GLOBAL ANSWER KEY)
These are proposed working, not a globally verified answer key. A solver binding confirms only its own quantityId, symbol, unit and value; it does not confirm other derived quantities or qualitative claims below. Keep the question's stated givens and applicable laws, and label assumptions.
Your own board working cannot override an explicitly solver-bound value. Recheck disagreements from the givens and applicable law and correct the working; if they cannot be resolved, state the unresolved discrepancy instead of inventing an alternative answer.
For a quantity without a solver binding, correct an unsupported planner value only after checking its derivation from the givens, signs and units. Before using any result in a dependent calculation, check every adjacent equality in a chain. Before emitting a step, ensure its spoken quantities agree with the [WRITE] row.
${JSON.stringify({
  givens: turnPlan.givens,
  unknowns: turnPlan.unknowns,
  derived: turnPlan.derived,
  qualitativeClaims: turnPlan.qualitativeClaims,
  lawIds: turnPlan.lawIds,
  assumptions,
})}${assumptions.length > 0 ? `
PROBLEM CONDITIONS
The assumptions listed above are proposed modelling conditions, not established facts, extra givens or automatic prerequisites. Check each against the exact question and the applicable law. Keep conditions actually stated by the question as facts; neither a drawing nor a qualitative claim establishes an unstated condition. Do not impose an incidental process assumption on an end result already fixed by the givens.
Apply DERIVATION BEFORE RESULTS: introduce each genuinely necessary unstated condition once before its first use, explicitly say "assuming", and write one condition row so the saved notes scope all dependent working and results. Say once which requested result is not uniquely determined without that necessary condition; do not invent a dependency just because the plan listed it. Preserve that scope through the final answer even when other quantities are solver-verified; a new condition starts a new case, not a repeated suffix on each answer.` : ""}${assumedSymbols.length > 0
  ? `
NOT STATED BY THE QUESTION: ${assumedSymbols.join(", ")}. The question never supplies these; they are illustrative values chosen so the idea can be worked through.
Never call them given. Say "suppose" or "take, for example" the first time each one is spoken, and [WRITE] that word on the row that carries it. Never present a result computed from them as a fact about the world.`
  : ""}`
    : "";

  const solverPromptAddon = hasSolverBindingContext(solverProjection)
    ? `INDEPENDENT SOLVER AUTHORITY V1 — EXPLICIT BINDINGS ONLY
Only the outputs explicitly listed in bindings are solver-confirmed numeric results. Match quantityId, symbol and unit; never apply a bound value to another quantity. Use those values exactly, and do not replace them with your own board arithmetic. Expressions, constraints and representation intents are formulation context, not blanket confirmation of other planner results or unstated conditions.
${JSON.stringify(solverProjection)}`
    : "";

  return { turnPlanPromptAddon, solverPromptAddon };
}

/** A line written down the left of the page, as the doubt prompt quotes it. */
export interface DoubtBoardRow {
  /** `w3` for a numbered work row; a heading has none. */
  workId?: string;
  text: string;
}

export interface DoubtTeachingPromptInput {
  /** The lesson question the page belongs to, never the doubt itself. */
  lessonQuestion: string;
  /** Everything written down the left of the page now, top to bottom. */
  boardRows: readonly DoubtBoardRow[];
  /** Work rows still free under the last one on this page. */
  rowsLeftOnPage: number;
  /**
   * y of the next free row, or null when the page is full. Only its absence is
   * read: the prompt quotes the base prompt's own row grid, so the model is
   * never handed a second one.
   */
  nextRowY: number | null;
  /** `promptAddon` of the verified figure drawn on this page, when there is one. */
  diagramPromptAddon: string | null;
  /** A code lesson's editor covers the left of the board, so there is no notebook. */
  codePanelShowing: boolean;
  /**
   * A code lesson owns this board. With its panel still hidden the left is a
   * notebook, but the worked example on the right is conducted by a plan the
   * doubt does not run, so it is named in words and never pointed at.
   */
  codeLessonBoard?: boolean;
  /** Visible DSA ink on this page; this never grants a doubt FOCUS permission. */
  codeFigureVisible?: boolean;
  /** The code revealed on the panel, section titles and lines, when it is showing. */
  codePanelText?: string | null;
  turnPlan: TurnPlanV3 | null;
  solverProjection: unknown;
  familiarity: SubjectFamiliarity;
  /** Not read: fast mode trims how a lesson spends its steps, and a doubt has its own length. */
  fastMode: boolean;
  teachingNote?: string | null;
  alwaysShowUnits?: boolean;
  alwaysStateLawFirst?: boolean;
  /** "hinglish" when the Sarvam voice speaks: the narration changes, the board does not. */
  narrationLanguage?: NarrationLanguage;
  /**
   * `DIAGRAM_DOUBT_POINTING` granted for this turn. Off (or absent), the
   * prompt is exactly what it was before the flag existed.
   */
  doubtPointing?: boolean;
  /**
   * The figure in the zone is a reference picture. Its parts may be pointed
   * at, but the board keeps no ring on a picture, so `|keep` is not offered.
   */
  figureIsPicture?: boolean;
  /**
   * Code lesson board only: the cells of the frame on the board now, ids and
   * labels taken from its verified anchors. Never a frame id.
   */
  codeFrameCells?: readonly DoubtCodeFrameCell[];
}

/** A cell of the worked-example frame on the board, as the doubt prompt lists it. */
export interface DoubtCodeFrameCell {
  id: string;
  labels: readonly string[];
}

/**
 * A doubt is as long as what was asked, which the model reads from the doubt
 * itself. This is only what the turn logs in place of a lesson budget.
 */
const DOUBT_LESSON_BUDGET: LessonBudget = {
  scope: "compact",
  minSteps: 2,
  maxSteps: 6,
  boardPages: 1,
};

/** More rows than a page holds means wrapped lines; the newest are the ones asked about. */
const MAX_DOUBT_BOARD_ROWS = 24;
const MAX_DOUBT_ROW_CHARS = 140;
/** The panel is quoted so a doubt about a line can name it; a long program keeps its end. */
const MAX_DOUBT_CODE_CHARS = 4_000;

const DOUBT_CONTINUATION_PROMPT = `Continue the answer to the student's doubt exactly where the previous response stopped. Return only [STEP]...[/STEP] blocks under the same rules. Do not restate anything already said, do not start the answer again, and do not go on to the rest of the lesson: finish the doubt and stop.`;

/**
 * The base prompt's step floors (twelve for a numbered problem, sixteen for an
 * explain request) hold only when no LESSON LENGTH block is given. Without this
 * one a doubt inherited them and grew back into a lesson.
 */
const DOUBT_LENGTH_ADDON = `LESSON LENGTH FOR THIS DOUBT
This overrides every earlier step count, including the floors for a numbered problem or an explain request. A doubt about one line or one symbol takes two to five steps. When the student asks for the whole solution again, take one step for each row of the solution.`;

/**
 * How a doubt spends its steps for this student. The lesson's familiarity
 * addons are written for a whole lesson ("use all of it", "one final row
 * naming the idea"), which stretched a doubt back into one.
 */
const DOUBT_FAMILIARITY_LINES: Record<SubjectFamiliarity, string> = {
  new: "The student is new to this topic: define each term in plain words the first time you say it.",
  normal: "",
  revision: "The student is revising this topic: state the law and move quickly, without defining ordinary terms.",
};

/**
 * A figure's prompt addon is written for the lesson that reveals it: read it
 * part by part, calculate only after, never speak with the marker parked. A
 * doubt keeps the parts and the pointing forms and drops that lesson flow. The
 * lines are matched as `verifiedScenePresentation` writes them.
 */
const FIGURE_LESSON_FLOW_LINES: readonly RegExp[] = [
  /^A complete metric diagram has already been compiled/,
  /^A source-grounded conceptual representation/,
  /^Read the figure to the student before you calculate/,
  /^Read the figure's setup before using it:/,
  /^WRITE the left work column/,
  /This figure is what it is/,
  /^The left side of the board is the code editor/,
  /^This turn overrides the FOCUS instructions above/,
  /^Always write it as \[FOCUS:frame_id/,
];
/** A withheld label belongs to the part of the lesson the student has not reached. */
const ANNOTATE_SENTENCE = /\s*To reveal a withheld measurement.*$/;

/** The figure's parts and pointing forms, without the lesson that revealed it. */
export function figureAddonForDoubt(addon: string, options: { keepAnnotate?: boolean } = {}): string {
  const kept = addon
    .split("\n")
    .filter((line) => !FIGURE_LESSON_FLOW_LINES.some((pattern) => pattern.test(line.trim())))
    .map((line) => (options.keepAnnotate ? line : line.replace(ANNOTATE_SENTENCE, "")))
    .filter((line) => line.trim().length > 0);
  return ["The figure on the right is already drawn on this page. For pointing at it:", ...kept].join("\n");
}

function doubtBoardBlock(rows: readonly DoubtBoardRow[]): string {
  if (rows.length === 0) {
    return "Nothing is written in the work column yet.";
  }
  const lines = rows
    .slice(-MAX_DOUBT_BOARD_ROWS)
    .map((row) => `${row.workId ? `${row.workId}: ` : ""}${row.text.slice(0, MAX_DOUBT_ROW_CHARS)}`);
  return `Written down the left of the board now, top to bottom:\n${lines.join("\n")}`;
}

const MAX_DOUBT_FRAME_CELLS = 40;

/** The frame's cells, ids and labels only, for `[FOCUS:cell_id|spotlight]`. */
function doubtFrameCellsBlock(cells: readonly DoubtCodeFrameCell[]): string {
  const lines = cells.slice(0, MAX_DOUBT_FRAME_CELLS).map((cell) => {
    const labels = cell.labels.map((label) => label.trim()).filter(Boolean).slice(0, 3);
    return labels.length > 0 ? `${cell.id}: ${labels.join(", ")}` : cell.id;
  });
  return `Cells of the worked example on the board now (id: label):\n${lines.join("\n")}`;
}

function doubtCodeBlock(codePanelText: string | null | undefined): string {
  const code = (codePanelText ?? "").trim();
  if (!code) {
    return "The code panel shows no code yet.";
  }
  return `The code on the panel now, as the student sees it:\n${code.slice(-MAX_DOUBT_CODE_CHARS)}`;
}

/**
 * The y of the next row on the base prompt's own grid. The slot finder places a
 * WRITE row itself, so this is only the number the model sends; quoting the
 * finder's coordinate instead taught the model a second grid three pixels off
 * the first.
 */
function doubtRowY(rowsLeft: number): number {
  if (rowsLeft <= 0) return WORK_ZONE.topY;
  const index = Math.min(
    Math.max(BOARD_WORK_ROWS_PER_PAGE - rowsLeft, 0),
    BOARD_WORK_ROWS_PER_PAGE - 1,
  );
  return WORK_ZONE.topY + index * WORK_ZONE.lineHeight;
}

/**
 * The full row tag with real numbers. A resumed lesson's base prompt is the
 * continuation prompt, which never showed the coordinates, and a retry that
 * spelled them `x,y` got a literal x back: production resumes wrote
 * `[WRITE:text]`, `[WRITE:text,277]` and `[WRITE:text,x,211]`, the parser
 * refused every row, and the lesson taught nothing.
 */
function writeRowTag(y: number): string {
  return `[WRITE:text,${WORK_ZONE.marginX},${y}]`;
}

/** The y a continued lesson's next row is quoted at: the space rule's own number. */
export function resumeNextRowY(input: Pick<ResumeTeachingPromptInput, "rowsLeftOnPage" | "nextRowY">): number {
  return input.rowsLeftOnPage <= 0 || input.nextRowY === null ? WORK_ZONE.topY : doubtRowY(input.rowsLeftOnPage);
}

function doubtSpaceRule(
  input: Pick<DoubtTeachingPromptInput, "rowsLeftOnPage" | "nextRowY">,
  figureOnBoard: boolean,
): string {
  const pitch = WORK_ZONE.lineHeight;
  const figureStays = figureOnBoard ? ", and the figure stays" : "";
  if (input.rowsLeftOnPage <= 0 || input.nextRowY === null) {
    return `This page is full. Your first [WRITE] turns the board to a fresh page by itself${figureStays}. Make that first row the line the doubt is about, restated in symbols at y = ${WORK_ZONE.topY} as ${writeRowTag(WORK_ZONE.topY)}, and explain under it, stepping y by ${pitch}.`;
  }
  const rows = input.rowsLeftOnPage;
  return `There is room for ${rows} more ${rows === 1 ? "row" : "rows"} under the last one on this page. Fit an ordinary doubt in that room: your first row is y = ${doubtRowY(rows)}, written ${writeRowTag(doubtRowY(rows))}, then step y by ${pitch}. When the answer needs more, keep writing past the bottom: the board turns to a fresh page by itself${figureStays}. Your first row on a fresh page restates, in symbols, the line the doubt is about, so the student can still see it.`;
}

/**
 * The teaching prompt for a doubt answered on the page it was asked about.
 *
 * The base prompt describes a fresh lesson: an opening line, "Given" rows, a
 * six-row ladder, a figure read part by part, a row in every step, a closing
 * check. None of that is true of a page the student is already looking at, and
 * a doubt run under those rules restarted the lesson from its givens. The doubt
 * block goes last so it is the final word: the page as it stands, the room left
 * on it, and what a doubt is allowed to be.
 */
export function buildDoubtTeachingPrompt(input: DoubtTeachingPromptInput): TurnTeachingPrompt {
  const lessonQuestion = input.lessonQuestion.trim();
  const panelShowing = input.codePanelShowing;
  const codeBoard = panelShowing || Boolean(input.codeLessonBoard);
  const hasFigure = Boolean(input.diagramPromptAddon?.trim()) || Boolean(codeBoard && input.codeFigureVisible);
  const figureOnBoard = !codeBoard && hasFigure;
  // DIAGRAM_DOUBT_POINTING: walk the figure's parts, keep a ring, letter a
  // withheld measurement; on a code board, light the cells of the frame shown.
  const pointAtFigure = input.doubtPointing === true && figureOnBoard;
  const frameCells = input.doubtPointing === true && codeBoard && hasFigure ? (input.codeFrameCells ?? []) : [];
  const pointAtCells = frameCells.length > 0;
  // A code lesson's turn plan is a fallback that carries only the question,
  // and printing it invites the tutor to talk about givens.
  const { turnPlanPromptAddon, solverPromptAddon } = turnPlanPromptAddons(
    lessonQuestion,
    codeBoard ? null : input.turnPlan,
    codeBoard ? null : input.solverProjection,
  );

  const example =
    "Use the problem's own numbers, or new numbers said with \"for example\" and never written as givens.";
  const noAnnotate =
    "- Never use [ANNOTATE] in this turn: the labels it reveals belong to the part of the lesson still ahead.";
  const annotateWithheld =
    "- When the doubt needs a measurement the figure still withholds, letter it with [ANNOTATE:entity_id] on that part, using only an id listed above. Never use [ANNOTATE] for anything else in this turn.";
  const keepRing =
    "- On the one part the whole doubt turns on, you may write [FOCUS:entity_id|keep] once or twice: a ring that stays while this page is up. Use it only on a figure part listed above, never on a board row.";
  const cellSpotlight =
    "You may light the cells of the worked example the doubt is about with [FOCUS:cell_id|spotlight], using only the ids in the list of cells. Never name a frame, and never use |keep or [ANNOTATE].";
  const emptyMark =
    "- If the mark landed on an empty area and nothing was typed, ask one short question about what they meant, write nothing, and stop. That question is the one exception to the last rule.";
  const closing =
    "- End with one sentence that ties the answer back to the line they asked about, and stop. No recap, and no question back to the student. Do not continue the original lesson and do not ask whether to continue: the student chooses to pick the lecture back up or ask another doubt.";

  const rules = panelShowing
    ? [
        "- Answer what the student asked and nothing else. Do not greet, do not read the question back, do not open the lesson again, and do not carry on with the rest of the lesson once the doubt is answered.",
        hasFigure
          ? "- In your first step say which line of the code or which part of the worked example you mean, quoting the line as it reads on the panel above."
          : "- In your first step identify the visible code line the doubt concerns, quoting it as it reads on the panel above.",
        `- Explain it a different way from the first time: a smaller step, the reason behind the line, or the example traced by hand with its values said out loud. ${example} When the student asks you to go through the whole thing again, go through all of it, one line per step.`,
        pointAtCells
          ? `- The left of the board is the code editor and the right is the worked example, and both stay as they are. Never [WRITE] and never [TYPE] in this turn: teach it in speech, one idea per step. ${cellSpotlight} On this board a step with no tag is correct.`
          : `${hasFigure ? "- The left of the board is the code editor and the right is the worked example, and both stay as they are." : "- The code editor stays as it is; there is no worked-example figure beside it."} Never [WRITE], never [TYPE] and never [FOCUS] in this turn: teach it in speech, one idea per step. On this board a step with no tag is correct.`,
        noAnnotate,
        emptyMark,
        closing,
      ]
    : [
        "- Answer what the student asked, about the part they pointed at. Do not greet, do not read the question back, do not open the lesson again, and do not carry on with the rest of the problem once the doubt is answered.",
        figureOnBoard
          ? "- Your first step points and writes nothing. Say which line or figure part you mean. To box an existing row, copy its id and exact text from the board list above into [EMPHASIZE:row_id|exact row text], or use [FOCUS:entity_id] on that figure part. If no listed row is the line you mean, do not box one. A step that only points is correct here. Write from the second step on."
          : "- Your first step points and writes nothing. Say which line you mean. To box an existing row, copy its id and exact text from the board list above into [EMPHASIZE:row_id|exact row text]. If no listed row is the line you mean, do not box one. A step that only points is correct here. Write from the second step on.",
        "- A row id holds only while this page is on the board. Once the board turns to a fresh page, old ids name new rows: never box an old row after that, write it again instead.",
        `- Explain it a different way from the first time: a smaller step, the reason behind the move, or a tiny example. ${example}`,
        "- Never [WRITE] a row that is still on this page. To use one again, say so and box it with [EMPHASIZE:row_id|exact row text]. For a line you just wrote in this doubt, use [EMPHASIZE:last|exact row text]. The runtime checks the text against visible ink before boxing.",
        "- When the student asks you to go through the whole thing again, walk the rows top to bottom, one step each with [EMPHASIZE:row_id|exact row text] on that row (boxing every row is right here), and write only the lines that are missing. When they ask you to start over, write it again under the last row, and let the board turn when the column runs out.",
        `- ${doubtSpaceRule(input, figureOnBoard)}`,
        ...(pointAtFigure ? [...(input.figureIsPicture ? [] : [keepRing]), annotateWithheld] : [noAnnotate]),
        emptyMark,
        closing,
      ];

  const figureLine = panelShowing
    ? ""
    : pointAtFigure
      ? "The figure on the right is drawn and stays. Its parts are listed above. Walk through the parts the doubt turns on, one part per step, in the order they matter, and point at each with [FOCUS:entity_id] as you name it. Do not read the whole figure to the student again."
    : figureOnBoard
      ? "The figure on the right is drawn and stays. Its parts are listed above. Point only at the parts the doubt is about, and do not read the whole figure to the student again."
      : pointAtCells
        ? `The worked example on the right stays as it is. ${cellSpotlight}`
      : codeBoard && hasFigure
        ? "The worked example on the right stays as it is. Do not point at it with [FOCUS] in this turn; say in words which part you mean."
        : "No figure is on this board. Do not use [FOCUS] or [ANNOTATE].";

  const doubtBlock = [
    "THIS TURN ANSWERS A DOUBT ON THE SAME BOARD",
    lessonQuestion
      ? `The student stopped the lesson on "${lessonQuestion}" to ask about part of it. The board is exactly as they left it, and everything on it stays where it is.`
      : "The student asked a doubt about what is on the board. The board is exactly as they left it, and everything on it stays where it is.",
    panelShowing ? doubtCodeBlock(input.codePanelText) : doubtBoardBlock(input.boardRows),
    figureLine,
    pointAtCells ? doubtFrameCellsBlock(frameCells) : "",
    "This turn is a doubt, not a new lesson. It replaces every rule above about opening the lesson, the \"Given\" rows, the order and the number of work rows, the lesson length, the rule that every step writes a board line (a step that only points is correct here), reading a relation or the figure before using it (a relation already on this page is pointed at, not rewritten), and closing with a check. Those rules describe a fresh page; this page is already written.",
    ...rules,
  ]
    .filter(Boolean)
    .join("\n");

  const runtimeAddon = [
    figureOnBoard && input.diagramPromptAddon
      ? figureAddonForDoubt(input.diagramPromptAddon, { keepAnnotate: pointAtFigure })
      : "",
    turnPlanPromptAddon,
    solverPromptAddon,
    !codeBoard && isChemistryQuestion(lessonQuestion) ? CHEMISTRY_LESSON_RUNTIME_ADDON : "",
    teachingPromptAddon({
      teachingNote: input.teachingNote,
      alwaysShowUnits: input.alwaysShowUnits,
      alwaysStateLawFirst: input.alwaysStateLawFirst,
    }),
    !hasFigure ? noFigurePromptAddon(codeBoard) : "",
    [DOUBT_LENGTH_ADDON, DOUBT_FAMILIARITY_LINES[input.familiarity] ?? ""].filter(Boolean).join("\n"),
    !codeBoard ? ROW_FIRST_TEACHING_PROMPT : "",
    doubtBlock,
    input.narrationLanguage === "hinglish" ? HINGLISH_NARRATION_ADDON : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    runtimeAddon,
    openingSegment: null,
    givenSegments: [],
    lessonBudget: DOUBT_LESSON_BUDGET,
    systemPrompt: `${TUTOR_SYSTEM_PROMPT}\n\n--- current lesson (runtime) ---\n${runtimeAddon}`,
    // The doubt's own instruction comes first: a cut off doubt continues the
    // doubt, not the lesson. Only the derivation order rule is carried over;
    // the lesson continuation would tell it to finish the whole derivation.
    continuationPrompt: [
      DOUBT_CONTINUATION_PROMPT,
      codeBoard ? "" : DERIVATION_ORDER_POLICY,
      codeBoard ? "" : TEACHING_STATEMENT_TRUTH_ADDON,
      `--- this lesson ---\n${runtimeAddon}`,
    ].filter(Boolean).join("\n\n"),
  };
}

export interface ResumeTeachingPromptInput {
  lessonQuestion: string;
  /**
   * Why the lesson paused. "stop" (the student stopped it, or left and came
   * back) must never be told a doubt was answered. Defaults to "doubt".
   */
  reason?: PausedLessonReason;
  boardRows: readonly DoubtBoardRow[];
  /** Work as it stood before the doubt (may be on an earlier page now). */
  lessonBoardRows?: readonly DoubtBoardRow[];
  interruptedStep?: string;
  rowsLeftOnPage: number;
  nextRowY: number | null;
  diagramPromptAddon: string | null;
  codePanelShowing: boolean;
  codeLessonBoard?: boolean;
  codePanelText?: string | null;
  /** Remaining code-lesson beats, when this is a paused DSA lecture. */
  codeLessonResumeNote?: string | null;
  /** The paused code lesson, so the resume can list every remaining beat. */
  codeLesson?: CodeLessonPlan | null;
  codeLessonIncludeCode?: boolean;
  codeLessonFrames?: readonly CodeLessonFigureFrame[];
  alreadyRevealedBlockIds?: readonly string[];
  framesAlreadyShown?: number;
  codeLessonFacts?: {
    terms?: readonly string[];
    resultText?: string;
    earlyExit?: boolean;
  };
  turnPlan: TurnPlanV3 | null;
  solverProjection: unknown;
  familiarity: SubjectFamiliarity;
  fastMode: boolean;
  teachingNote?: string | null;
  alwaysShowUnits?: boolean;
  alwaysStateLawFirst?: boolean;
  /** "hinglish" when the Sarvam voice speaks: the narration changes, the board does not. */
  narrationLanguage?: NarrationLanguage;
}

/**
 * The user prompt for a paused lesson that continues after a doubt. The
 * teaching model must not see the original question again or it restarts.
 */
const RESUME_LESSON_USER_PROMPT = "continue";

const RESUME_AFTER_DOUBT_NOTE =
  "A doubt on this board has been answered. Pick up the original lesson from the next unwritten step and teach it to the end. Do not restart, do not recap, and do not repeat the doubt.";

/** After a plain Stop or a reload there was no doubt: never claim one. */
const RESUME_AFTER_STOP_NOTE =
  "The student stopped this lesson and has come back to it. Pick up the original lesson from the step it stopped on and teach it to the end. Do not restart and do not recap.";

/** The full user prompt for the first resume chunk, including any DSA leftover. */
export function resumeLessonUserPrompt(
  codeLessonNote?: string | null,
  reason: PausedLessonReason = "doubt",
): string {
  return [
    RESUME_LESSON_USER_PROMPT,
    (codeLessonNote ?? "").trim(),
    reason === "stop" ? RESUME_AFTER_STOP_NOTE : RESUME_AFTER_DOUBT_NOTE,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The one corrective retry when a resume came back without board writing. */
export function resumeInkRetryUserPrompt(reason: PausedLessonReason = "doubt", nextRowY: number = WORK_ZONE.topY): string {
  const repeat = reason === "stop" ? "Do not repeat any already written row." : "Do not repeat the doubt or any already written row.";
  return `${resumeLessonUserPrompt(null, reason)}\n\nYour previous continuation contained no usable [WRITE] step: every row needs its two numbers. Continue from the next unfinished derivation step on the existing board. For each new mathematical step, put its short row tag immediately after the words that explain it, the first one as ${writeRowTag(nextRowY)} with your row text in place of "text", the next at y = ${nextRowY + WORK_ZONE.lineHeight}, and so on in steps of ${WORK_ZONE.lineHeight}. ${repeat} Return [STEP] blocks, not narration alone.`;
}

const RESUME_LENGTH_ADDON = `LESSON LENGTH FOR THIS CONTINUATION
This overrides every earlier step count, including the floors for a numbered problem or an explain request. Finish the original question completely: every remaining step, the result, and the closing check. Do not stop after two or three steps if work remains. Do not restart, and do not add a new example.`;

const RESUME_CONTINUATION_PROMPT = `Continue the original lesson exactly where it stopped before the doubt. Return only [STEP]...[/STEP] blocks. Do not restate anything already said, do not recap the doubt, and do not start again from the givens.`;

const RESUME_AFTER_STOP_CONTINUATION_PROMPT = `Continue the original lesson exactly where it stopped. Return only [STEP]...[/STEP] blocks. Do not restate anything already said, and do not start again from the givens.`;

/** Where the next row goes when the lesson, not a doubt, continues the page. */
function resumeSpaceRule(
  input: Pick<ResumeTeachingPromptInput, "rowsLeftOnPage" | "nextRowY">,
  figureOnBoard: boolean,
): string {
  const pitch = WORK_ZONE.lineHeight;
  const figureStays = figureOnBoard ? ", and the figure stays" : "";
  if (input.rowsLeftOnPage <= 0 || input.nextRowY === null) {
    return `This page is full. Your first [WRITE] turns the board to a fresh page by itself${figureStays}. Make that first row the last result the lesson reached, restated in symbols at y = ${WORK_ZONE.topY} as ${writeRowTag(WORK_ZONE.topY)}, and continue under it, stepping y by ${pitch}.`;
  }
  const rows = input.rowsLeftOnPage;
  return `There is room for ${rows} more ${rows === 1 ? "row" : "rows"} under the last one on this page: your next row is y = ${doubtRowY(rows)}, written ${writeRowTag(doubtRowY(rows))}, then step y by ${pitch}. When the lesson needs more, keep writing past the bottom: the board turns to a fresh page by itself${figureStays}. Your first row on a fresh page restates, in symbols, the last result the lesson reached.`;
}

function remainingCodeLessonStepsBlock(input: ResumeTeachingPromptInput): string {
  const plan = input.codeLesson;
  if (!plan) return "";
  const frames = input.codeLessonFrames ?? [];
  const blockIds = input.codeLessonIncludeCode === false
    ? []
    : plan.sections.flatMap((section) => section.blocks.map((block) => block.id));
  const remaining = remainingCodeLessonBeats(
    codeLessonBeatPlan({
      frames: frames.map((frame) => ({ id: frame.id, caption: frame.caption })),
      blockIds,
      familiarity: input.familiarity,
      earlyExit: input.codeLessonFacts?.earlyExit,
      terms: input.codeLessonFacts?.terms,
      resultText: input.codeLessonFacts?.resultText,
    }),
    {
      alreadyRevealedBlockIds: input.alreadyRevealedBlockIds,
      framesAlreadyShown: input.framesAlreadyShown,
    },
  );
  if (remaining.length === 0) return "";
  const lines = remaining.map((beat, index) => `${index + 1}. ${beat.tag ?? "(no tag)"}: ${beat.brief}`);
  return `REMAINING STEPS of the original lesson, in this order. Teach every one, then stop. Nothing added, nothing skipped.\n${lines.join("\n")}`;
}

/**
 * The teaching prompt for the rest of a lesson after a mid-lesson doubt.
 *
 * Same page, same figure, same numbers. The doubt has been answered; this turn
 * picks up the original problem and teaches it to the end.
 */
export function buildResumeTeachingPrompt(input: ResumeTeachingPromptInput): TurnTeachingPrompt {
  const lessonQuestion = input.lessonQuestion.trim();
  const afterStop = input.reason === "stop";
  const noRepeat = afterStop ? "do not recap" : "do not recap, do not repeat the doubt";
  const panelShowing = input.codePanelShowing;
  const codeBoard = panelShowing || Boolean(input.codeLessonBoard) || Boolean(input.codeLesson);
  const hasFigure = Boolean(input.diagramPromptAddon?.trim()) || Boolean(codeBoard && input.codeLessonFrames?.length);
  const figureOnBoard = !codeBoard && hasFigure;
  const remainingSteps = remainingCodeLessonStepsBlock(input);
  const { turnPlanPromptAddon, solverPromptAddon } = turnPlanPromptAddons(
    lessonQuestion,
    codeBoard ? null : input.turnPlan,
    codeBoard ? null : input.solverProjection,
  );

  const rules = input.codeLesson && input.codeLessonIncludeCode === false
    ? [
        hasFigure
          ? "- Continue the worked example at its next frame. The student asked for an explanation, so no code editor appears and no [TYPE] tags are allowed."
          : "- Continue the original explanation in words. No worked-example figure or code editor is available; do not use [FOCUS] or [TYPE].",
        hasFigure
          ? "- Explain the actual values and decisions on each remaining frame, then close with the reason for time and space complexity."
          : "- Explain the remaining algorithm decisions and values in words, then close with the reason for time and space complexity.",
        input.codeLessonResumeNote?.trim() ? `- ${input.codeLessonResumeNote.trim()}` : "",
        "- Do not recap or restart the example.",
      ]
    : panelShowing || input.codeLesson
    ? [
        `- Continue the original lesson from the next unwritten step. Do not greet, ${noRepeat}, and do not start the lesson again.`,
        "- The original question is still the question of this lesson. Teach it to the end, including the complexity close.",
        hasFigure
          ? "- The left of the board is the code editor and the right is the worked example, and both stay as they are. Never [WRITE]. Reveal remaining code with [TYPE:blockId] and remaining frames with [FOCUS:frame_id]."
          : "- The code editor stays as it is; no worked-example figure is available. Never [WRITE] or [FOCUS]. Reveal remaining code with [TYPE:blockId].",
        input.codeLessonResumeNote?.trim() ? `- ${input.codeLessonResumeNote.trim()}` : "",
        "- End after the last remaining beat of the original lesson. No recap, and no question back to the student.",
      ]
    : [
        `- Continue the original lesson from the next unwritten step. Do not greet, ${noRepeat}, and do not start from the givens.`,
        "- The original question is still the question of this lesson. Teach it to the end: every remaining derivation step, the result, and the closing check.",
        figureOnBoard
          ? "- The figure on the right is already drawn and stays. [FOCUS:entity_id] when you name a part of it. [ANNOTATE:entity_id] may reveal a withheld measurement the lesson had not reached yet."
          : "- No figure is on this board. Do not use [FOCUS] or [ANNOTATE].",
        "- Never [WRITE] a row that is still on this page. To use one again, say so and point at it with [EMPHASIZE:wN].",
        `- ${afterStop ? resumeSpaceRule(input, figureOnBoard) : doubtSpaceRule(input, figureOnBoard)}`,
        "- Every new step [WRITE]s a short board line and [FOCUS]es named figure parts. Teach to the end of the original question, then stop. No recap, and no question back to the student.",
      ];

  const resumeBlock = [
    "THIS TURN CONTINUES THE PAUSED LESSON",
    afterStop
      ? lessonQuestion
        ? `The student stopped the lesson on "${lessonQuestion}" and has come back to it. The board is exactly as they left it, and everything on it stays where it is. The original question is still the question of this lesson.`
        : "The student stopped the lesson and has come back to it. Continue the lesson on this board as it stands."
      : lessonQuestion
        ? `The student stopped the lesson on "${lessonQuestion}" to ask a doubt. The doubt has been answered. The board is exactly as they left it after that answer, and everything on it stays where it is. The original question is still the question of this lesson.`
        : "The student asked a doubt. It has been answered. Continue the lesson on this board as it stands.",
    panelShowing ? doubtCodeBlock(input.codePanelText) : doubtBoardBlock(input.boardRows),
    !codeBoard && input.lessonBoardRows?.length
      ? `The original lecture had reached these notebook lines when the student ${afterStop ? "stopped it" : "interrupted"} (an earlier page may no longer be visible):\n${input.lessonBoardRows.slice(-MAX_DOUBT_BOARD_ROWS).map((row) => row.text.slice(0, MAX_DOUBT_ROW_CHARS)).join("\n")}\nUse these as the completed work, not as lines to write again.`
      : "",
    !codeBoard && input.interruptedStep?.trim()
      ? afterStop
        // The step Stop cut off is saved with its board line (decision 12). The
        // rest of the lesson follows it: finish it in words, never rewrite it.
        ? `The student stopped during this step, so it may be cut off mid sentence: ${input.interruptedStep.trim().slice(0, 500)}. Its board line, if it had one, is already written above. Start here: finish explaining this step in words without writing its line again, then take the next step; do not jump back to the beginning.`
        : `The last lesson idea before the interruption was: ${input.interruptedStep.trim().slice(0, 500)}. Finish its unfinished reasoning, then take the next step; do not jump back to the beginning.`
      : "",
    remainingSteps,
    "This turn continues the original lesson, not a new one. It replaces every rule above about opening the lesson, the \"Given\" rows, and restarting from the beginning. Those rules describe a fresh page; this page is already written.",
    ...rules,
  ]
    .filter(Boolean)
    .join("\n");

  const runtimeAddon = [
    figureOnBoard && input.diagramPromptAddon ? input.diagramPromptAddon : "",
    turnPlanPromptAddon,
    solverPromptAddon,
    !codeBoard && isChemistryQuestion(lessonQuestion) ? CHEMISTRY_LESSON_RUNTIME_ADDON : "",
    teachingPromptAddon({
      teachingNote: input.teachingNote,
      alwaysShowUnits: input.alwaysShowUnits,
      alwaysStateLawFirst: input.alwaysStateLawFirst,
    }),
    !hasFigure ? noFigurePromptAddon(codeBoard) : "",
    RESUME_LENGTH_ADDON,
    !codeBoard ? ROW_FIRST_TEACHING_PROMPT : "",
    resumeBlock,
    input.narrationLanguage === "hinglish" ? HINGLISH_NARRATION_ADDON : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const basePrompt = input.codeLesson && input.codeLessonIncludeCode === false
    ? DSA_EXPLANATION_CONTINUATION_PROMPT
    : codeBoard ? CODE_LESSON_CONTINUATION_PROMPT : TUTOR_CONTINUATION_PROMPT;
  return {
    runtimeAddon,
    openingSegment: null,
    givenSegments: [],
    lessonBudget: lessonQuestion
      ? resolveLessonBudget(lessonQuestion, input.familiarity)
      : DOUBT_LESSON_BUDGET,
    systemPrompt: `${basePrompt}\n\n--- current lesson (runtime) ---\n${runtimeAddon}`,
    continuationPrompt: [
      codeBoard ? "" : basePrompt,
      afterStop ? RESUME_AFTER_STOP_CONTINUATION_PROMPT : RESUME_CONTINUATION_PROMPT,
      codeBoard ? "" : TEACHING_STATEMENT_TRUTH_ADDON,
      `--- this lesson ---\n${runtimeAddon}`,
    ].filter(Boolean).join("\n\n"),
  };
}

/** The plan example a committed scene document draws, or null when it draws none. */
export function figureExampleSpeciesOf(document: unknown): string | null {
  const source = document && typeof document === "object" ? (document as { source?: { figureProvenance?: unknown; exampleSpecies?: unknown } }).source : undefined;
  return source?.figureProvenance === "plan_example" && typeof source.exampleSpecies === "string" ? source.exampleSpecies : null;
}

/**
 * Empty unless the figure committed to the board is the plan's example for
 * this chemistry question. A parseable example the figure checks refused, or
 * a turn whose board shows something else, gets nothing: the lesson never
 * commits to a species the board does not show.
 */
export function planExampleTeachingAddon(question: string, turnPlan: TurnPlanV3 | null, figureExampleSpecies: string | null | undefined): string {
  if (!figureExampleSpecies) return "";
  const reading = readPlanExample(question, turnPlan);
  if (reading.status !== "accepted" || reading.source.formula !== figureExampleSpecies) return "";
  const { formula } = reading.source;
  return `EXAMPLE TO TEACH WITH
The question names no species. Teach the idea with ${formula} as the one worked example, and say early that ${formula} is an example you chose. Any figure on the board is ${formula}. Do not switch to another species as the main example; a second species only as a brief contrast.`;
}

export function buildTurnTeachingPrompt(input: TurnTeachingPromptInput): TurnTeachingPrompt {
  const { question, codeLesson, turnPlan } = input;
  const hasFigure = Boolean(input.diagramPromptAddon?.trim()) || Boolean(codeLesson && input.codeLessonFrames?.length);

  // A code lesson's figure contract is the frame list inside its own addon.
  // The scene addon speaks the physics language ("read the figure before you
  // calculate with it", "[ANNOTATE:entity_id]") and lists every cell id as a
  // focus target, which is exactly what the code addon then forbids.
  const diagramPromptAddon = codeLesson
    ? (hasFigure ? "" : CODE_LESSON_NO_DIAGRAM_ADDON)
    : (input.diagramPromptAddon?.trim() ? input.diagramPromptAddon : TEXT_ONLY_DIAGRAM_ADDON);

  const { turnPlanPromptAddon, solverPromptAddon } = turnPlanPromptAddons(
    question,
    codeLesson ? null : turnPlan,
    input.solverProjection,
  );

  // A figure claims the right of the board, so the given list has to fit the
  // narrow left column. With no figure it may use the full width rather
  // than wrapping a two-value list across three rows.
  const givenSegments = codeLesson
    ? buildDsaOpeningSegments({
        title: codeLesson.title,
        question,
        example: input.codeLessonFacts?.example ?? null,
        language: input.narrationLanguage,
      })
    : buildGivenValueSegments(question, turnPlan, {
        maxWidth: hasFigure ? WORK_ZONE.maxTextWidth : WORK_ZONE.fullWidthTextWidth,
        language: input.narrationLanguage,
      });

  // The lesson's first spoken beat. It leads the given rows on a problem, the
  // title and example rows on a code lesson, and the model's first step on an
  // explain question, which had no runtime opening at all and so began on a
  // definition with nothing in front of it.
  const openingSegment = buildLessonOpeningSegment({
    question,
    kind: codeLesson ? "code" : isConceptLessonQuestion(question) ? "concept" : "problem",
    hasBoardOpening: givenSegments.length > 0,
    language: input.narrationLanguage,
  });

  // How long this lesson should be. Classified from the question, then
  // shifted by the chat-bar familiarity — so a proof stays long on Revision
  // and a one-line substitution stays short on New.
  const lessonBudget = resolveLessonBudget(question, input.familiarity);

  // Given rows keep their runtime ownership, but an acknowledgement is not
  // the question-specific opening assumed by the shared legacy addon.
  const givenAddon = codeLesson ? "" : givenValuesPromptAddon(givenSegments.length > 0);
  const runtimeGivenAddon = input.earlyOpeningAcknowledgement
    ? givenAddon.replace(
        "The runtime already spoke the opening line",
        "The runtime spoke only an acknowledgement, not this question or its target",
      ).replace(
        "do not say what the question asks for again",
        "briefly identify what this question asks before explaining its symbols",
      )
    : givenAddon;

  const runtimeAddon = [
    openingSegment
      ? input.earlyOpeningAcknowledgement
        ? "THE RUNTIME SPOKE ONLY AN ACKNOWLEDGEMENT\nIt has not named this question or its target. In your first teaching step, briefly identify what this question asks, then begin the teaching. Do not greet again, give the requested answer before deriving it, or promise a figure."
        : LESSON_OPENING_PROMPT_ADDON
      : "",
    codeLesson
      ? dsaOpeningPromptAddon(givenSegments.length > 0, input.codeLessonIncludeCode)
      : runtimeGivenAddon,
    diagramPromptAddon,
    codeLesson
      ? codeLessonPromptAddon(codeLesson, {
          frames: input.codeLessonFrames,
          // Familiarity is the single axis for how much the tutor teaches, and
          // a code lesson used to be the one turn that ignored it entirely.
          familiarity: input.familiarity,
          terms: input.codeLessonFacts?.terms,
          resultText: input.codeLessonFacts?.resultText,
          earlyExit: input.codeLessonFacts?.earlyExit,
          teachingPolicy: input.codeLessonTeachingPolicy,
          includeCode: input.codeLessonIncludeCode,
        })
      : "",
    input.isDsa && !codeLesson ? DSA_WITHOUT_CODE_LESSON_ADDON : "",
    // A code lesson has no solver and no quantities; the fallback turn plan
    // carries nothing but the question, and printing it invites the tutor to
    // talk about givens.
    codeLesson ? "" : turnPlanPromptAddon,
    codeLesson ? "" : solverPromptAddon,
    !codeLesson && isConceptLessonQuestion(question) ? CONCEPT_LESSON_RUNTIME_ADDON : "",
    // Chemistry keeps every rule of the base prompt and adds its notation:
    // subscripts, charges, state symbols, balanced rows, and the figure that
    // the engine computed from the formula. Keyed off the question, never the
    // account subject, which never reaches this code.
    !codeLesson && isChemistryQuestion(question) ? CHEMISTRY_LESSON_RUNTIME_ADDON : "",
    // The figure of a topic ask with no species is the plan's own example;
    // the lesson teaches with that same species so voice and board agree.
    !codeLesson && hasFigure && isChemistryQuestion(question) ? planExampleTeachingAddon(question, turnPlan, input.figureExampleSpecies) : "",
    !codeLesson && input.fastMode ? FAST_MODE_TEACHING_ADDON : "",
    !codeLesson ? (FAMILIARITY_ADDONS[input.familiarity] ?? "") : "",
    !hasFigure ? noFigurePromptAddon(Boolean(codeLesson)) : "",
    // Last, so it is the final word on step count: how long THIS question's
    // lesson should be. Without it every question got the same short lesson
    // and stopped at the bottom of the first board page.
    !codeLesson ? lessonScopePromptAddon(lessonBudget, {
      conceptLesson: isConceptLessonQuestion(question),
    }) : "",
    teachingPromptAddon({
      teachingNote: input.teachingNote,
      alwaysShowUnits: input.alwaysShowUnits,
      alwaysStateLawFirst: input.alwaysStateLawFirst,
    }),
    // Last of all: it overrides the base prompt's "speak English" lines.
    input.narrationLanguage === "hinglish" ? HINGLISH_NARRATION_ADDON : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // A code lesson replaces the base prompt rather than overriding it: the
  // physics rules it argued with (one or two sentences a step, a board row in
  // every step, stop before complexity) were being obeyed often enough to
  // shorten lessons and leak handwriting into them.
  // The shared base assumes the deterministic opening named the question.
  // An early acknowledgement did not: replace only that framing contract,
  // leaving OFF bytes and every diagram/numeric rule untouched.
  const tutorBasePrompt = input.earlyOpeningAcknowledgement
    ? TUTOR_SYSTEM_PROMPT.replace(
        "the runtime has already spoken one opening line naming what the question asks for",
        "the runtime has already spoken only a brief acknowledgement without naming this question or its target",
      ).replace(
        "do not open the lesson a second time, do not say what the question asks for again",
        "briefly identify what this question asks in your first teaching step, but do not greet again",
      )
    : TUTOR_SYSTEM_PROMPT;
  const basePrompt = codeLesson && input.codeLessonIncludeCode === false
    ? DSA_EXPLANATION_SYSTEM_PROMPT
    : codeLesson ? CODE_LESSON_SYSTEM_PROMPT : tutorBasePrompt;
  const continuationBase = codeLesson && input.codeLessonIncludeCode === false
    ? DSA_EXPLANATION_CONTINUATION_PROMPT
    : codeLesson ? CODE_LESSON_CONTINUATION_PROMPT : TUTOR_CONTINUATION_PROMPT;
  return {
    runtimeAddon,
    openingSegment,
    givenSegments,
    lessonBudget,
    systemPrompt: runtimeAddon
      ? `${basePrompt}\n\n--- current lesson (runtime) ---\n${runtimeAddon}`
      : basePrompt,
    continuationPrompt: runtimeAddon
      ? `${continuationBase}\n\n--- this lesson ---\n${runtimeAddon}`
      : continuationBase,
  };
}
