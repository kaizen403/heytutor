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
  CHEMISTRY_LESSON_RUNTIME_ADDON,
  CODE_LESSON_SYSTEM_PROMPT,
  CONCEPT_LESSON_RUNTIME_ADDON,
  FAMILIARITY_ADDONS,
  FAST_MODE_TEACHING_ADDON,
  TUTOR_CONTINUATION_PROMPT,
  TUTOR_SYSTEM_PROMPT,
  buildGivenValueSegments,
  buildDsaOpeningSegments,
  buildLessonOpeningSegment,
  codeLessonPromptAddon,
  dsaOpeningPromptAddon,
  givenValuesPromptAddon,
  isConceptLessonQuestion,
  isQuotedPhysicalConstant,
  lessonScopePromptAddon,
  questionStatesValue,
  LESSON_OPENING_PROMPT_ADDON,
  resolveLessonBudget,
  type CodeLessonFigureFrame,
  type CodeLessonPlan,
  type LessonBudget,
  type SubjectFamiliarity,
} from "@heytutor/tutor-core";
import { isChemistryQuestion, type TurnPlanV3 } from "@heytutor/scene-engine";
import { teachingPromptAddon } from "@/lib/account/userSettings";
import { BOARD_WORK_ROWS_PER_PAGE } from "../../constants";

export interface TurnTeachingPromptInput {
  question: string;
  /** `VerifiedDiagram.promptAddon` when a figure was committed, else null. */
  diagramPromptAddon: string | null;
  turnPlan: TurnPlanV3 | null;
  /** `ProblemAuthorityV1Response["projection"]` when the solver answered. */
  solverProjection: unknown;
  codeLesson: CodeLessonPlan | null;
  /**
   * The walk-through frames actually committed to the board, in order. The
   * teaching prompt narrates these; describing the planner's requested steps
   * instead is how the tutor ended up talking about frames the student could
   * not see.
   */
  codeLessonFrames?: readonly CodeLessonFigureFrame[];
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
WRITE the left work column as the student notebook: names, definitions, relations, substitutions, and results (x below 360). Every step must [WRITE] a short board line. Do not speak while the marker stays parked.
With no figure available, carry the setup in words and on the board: name every object, direction, and relation the question describes and write those names down before you use them.`;

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
        if (isQuotedPhysicalConstant(symbol, value)) return [];
        return [symbol];
      }),
    ),
  );

  // "Verified" is only true when the independent solver signed the numbers off.
  // Without it these are one model's working: a collision plan reached a lesson
  // claiming 62 J of kinetic energy after a 24 J collision, with the energy
  // lost recorded as zero, and the prompt still introduced it as verified. The
  // teaching model ignored it and was right, which is not a guarantee worth
  // relying on. Say what the block actually is.
  const solverVerified = Boolean(solverProjection);
  const turnPlanPromptAddon = turnPlan
    ? `${solverVerified ? "AUTHORITATIVE TURN PLAN V3" : "TURN PLAN V3 (NOT INDEPENDENTLY CHECKED)"}
${solverVerified
  ? "Use these verified quantities and qualitative claims for the explanation. Do not replace them with independently guessed values or contradict them."
  : "An independent solver did not confirm these numbers, so they are one working, not an answer key. Use them as the intended route and keep the givens, laws and assumptions. Before you speak any derived value, get it from the line of algebra you have just written; if your own line disagrees with the number below, write your line and say that value instead."}
${JSON.stringify({
  givens: turnPlan.givens,
  unknowns: turnPlan.unknowns,
  derived: turnPlan.derived,
  qualitativeClaims: turnPlan.qualitativeClaims,
  lawIds: turnPlan.lawIds,
  assumptions: turnPlan.assumptions,
})}${assumedSymbols.length > 0
  ? `
NOT STATED BY THE QUESTION: ${assumedSymbols.join(", ")}. The question never supplies these; they are illustrative values chosen so the idea can be worked through.
Never call them given. Say "suppose" or "take, for example" the first time each one is spoken, and [WRITE] that word on the row that carries it. Never present a result computed from them as a fact about the world.`
  : ""}`
    : "";

  const solverPromptAddon = solverProjection
    ? `INDEPENDENT SOLVER AUTHORITY V1
Use exactly these solver-verified values and formulation inputs. Do not independently replace or contradict them.
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
}

/**
 * A doubt is as long as what was asked, which the model reads from the doubt
 * itself. This is only what the turn logs in place of a lesson budget.
 */
export const DOUBT_LESSON_BUDGET: LessonBudget = {
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
  /^WRITE the left work column/,
  /This figure is what it is/,
  /^The left side of the board is the code editor/,
  /^This turn overrides the FOCUS instructions above/,
  /^Always write it as \[FOCUS:frame_id/,
];
/** A withheld label belongs to the part of the lesson the student has not reached. */
const ANNOTATE_SENTENCE = /\s*To reveal a withheld measurement.*$/;

/** The figure's parts and pointing forms, without the lesson that revealed it. */
export function figureAddonForDoubt(addon: string): string {
  const kept = addon
    .split("\n")
    .filter((line) => !FIGURE_LESSON_FLOW_LINES.some((pattern) => pattern.test(line.trim())))
    .map((line) => line.replace(ANNOTATE_SENTENCE, ""))
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

function doubtSpaceRule(
  input: Pick<DoubtTeachingPromptInput, "rowsLeftOnPage" | "nextRowY">,
  figureOnBoard: boolean,
): string {
  const pitch = WORK_ZONE.lineHeight;
  const figureStays = figureOnBoard ? ", and the figure stays" : "";
  if (input.rowsLeftOnPage <= 0 || input.nextRowY === null) {
    return `This page is full. Your first [WRITE] turns the board to a fresh page by itself${figureStays}. Make that first row the line the doubt is about, restated in symbols at y = ${WORK_ZONE.topY}, and explain under it, stepping y by ${pitch}.`;
  }
  const rows = input.rowsLeftOnPage;
  return `There is room for ${rows} more ${rows === 1 ? "row" : "rows"} under the last one on this page. Fit an ordinary doubt in that room: your first row is y = ${doubtRowY(rows)}, then step y by ${pitch}. When the answer needs more, keep writing past the bottom: the board turns to a fresh page by itself${figureStays}. Your first row on a fresh page restates, in symbols, the line the doubt is about, so the student can still see it.`;
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
  const figureOnBoard = !codeBoard && Boolean(input.diagramPromptAddon);
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
  const emptyMark =
    "- If the mark landed on an empty area and nothing was typed, ask one short question about what they meant, write nothing, and stop. That question is the one exception to the last rule.";
  const closing =
    "- End with one sentence that ties the answer back to the line they asked about, and stop. No recap, and no question back to the student. The lesson continues by itself after you stop.";

  const rules = panelShowing
    ? [
        "- Answer what the student asked and nothing else. Do not greet, do not read the question back, do not open the lesson again, and do not carry on with the rest of the lesson once the doubt is answered.",
        "- In your first step say which line of the code or which part of the worked example you mean, quoting the line as it reads on the panel above.",
        `- Explain it a different way from the first time: a smaller step, the reason behind the line, or the example traced by hand with its values said out loud. ${example} When the student asks you to go through the whole thing again, go through all of it, one line per step.`,
        "- The left of the board is the code editor and the right is the worked example, and both stay as they are. Never [WRITE], never [TYPE] and never [FOCUS] in this turn: teach it in speech, one idea per step. On this board a step with no tag is correct.",
        noAnnotate,
        emptyMark,
        closing,
      ]
    : [
        "- Answer what the student asked, about the part they pointed at. Do not greet, do not read the question back, do not open the lesson again, and do not carry on with the rest of the problem once the doubt is answered.",
        figureOnBoard
          ? "- Your first step points and writes nothing. Say which line or figure part you mean and put [EMPHASIZE:wN] on that row, with the id listed beside it above, or [FOCUS:entity_id] on that figure part. A step that only points is correct here. Write from the second step on."
          : "- Your first step points and writes nothing. Say which line you mean and put [EMPHASIZE:wN] on that row, with the id listed beside it above. A step that only points is correct here. Write from the second step on.",
        "- A row id holds only while this page is on the board. Once the board turns to a fresh page, old ids name new rows: never box an old row after that, write it again instead.",
        `- Explain it a different way from the first time: a smaller step, the reason behind the move, or a tiny example. ${example}`,
        "- Never [WRITE] a row that is still on this page. To use one again, say so and point at it with [EMPHASIZE:wN].",
        "- When the student asks you to go through the whole thing again, walk the rows top to bottom, one step each with [EMPHASIZE:wN] on that row (boxing every row is right here), and write only the lines that are missing. When they ask you to start over, write it again under the last row, and let the board turn when the column runs out.",
        `- ${doubtSpaceRule(input, figureOnBoard)}`,
        noAnnotate,
        emptyMark,
        closing,
      ];

  const figureLine = panelShowing
    ? ""
    : figureOnBoard
      ? "The figure on the right is drawn and stays. Its parts are listed above. Point only at the parts the doubt is about, and do not read the whole figure to the student again."
      : codeBoard
        ? "The worked example on the right stays as it is. Do not point at it with [FOCUS] in this turn; say in words which part you mean."
        : "No figure is on this board. Do not use [FOCUS] or [ANNOTATE].";

  const doubtBlock = [
    "THIS TURN ANSWERS A DOUBT ON THE SAME BOARD",
    lessonQuestion
      ? `The student stopped the lesson on "${lessonQuestion}" to ask about part of it. The board is exactly as they left it, and everything on it stays where it is.`
      : "The student asked a doubt about what is on the board. The board is exactly as they left it, and everything on it stays where it is.",
    panelShowing ? doubtCodeBlock(input.codePanelText) : doubtBoardBlock(input.boardRows),
    figureLine,
    "This turn is a doubt, not a new lesson. It replaces every rule above about opening the lesson, the \"Given\" rows, the order and the number of work rows, the lesson length, the rule that every step writes a board line (a step that only points is correct here), reading a relation or the figure before using it (a relation already on this page is pointed at, not rewritten), and closing with a check. Those rules describe a fresh page; this page is already written.",
    ...rules,
  ]
    .filter(Boolean)
    .join("\n");

  const runtimeAddon = [
    figureOnBoard && input.diagramPromptAddon ? figureAddonForDoubt(input.diagramPromptAddon) : "",
    turnPlanPromptAddon,
    solverPromptAddon,
    !codeBoard && isChemistryQuestion(lessonQuestion) ? CHEMISTRY_LESSON_RUNTIME_ADDON : "",
    teachingPromptAddon({
      teachingNote: input.teachingNote,
      alwaysShowUnits: input.alwaysShowUnits,
      alwaysStateLawFirst: input.alwaysStateLawFirst,
    }),
    [DOUBT_LENGTH_ADDON, DOUBT_FAMILIARITY_LINES[input.familiarity] ?? ""].filter(Boolean).join("\n"),
    doubtBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    runtimeAddon,
    openingSegment: null,
    givenSegments: [],
    lessonBudget: DOUBT_LESSON_BUDGET,
    systemPrompt: `${TUTOR_SYSTEM_PROMPT}\n\n--- current lesson (runtime) ---\n${runtimeAddon}`,
    continuationPrompt: `${DOUBT_CONTINUATION_PROMPT}\n\n--- this lesson ---\n${runtimeAddon}`,
  };
}

export interface ResumeTeachingPromptInput {
  lessonQuestion: string;
  boardRows: readonly DoubtBoardRow[];
  rowsLeftOnPage: number;
  nextRowY: number | null;
  diagramPromptAddon: string | null;
  codePanelShowing: boolean;
  codeLessonBoard?: boolean;
  codePanelText?: string | null;
  /** Remaining code-lesson beats, when this is a paused DSA lecture. */
  codeLessonResumeNote?: string | null;
  turnPlan: TurnPlanV3 | null;
  solverProjection: unknown;
  familiarity: SubjectFamiliarity;
  fastMode: boolean;
  teachingNote?: string | null;
  alwaysShowUnits?: boolean;
  alwaysStateLawFirst?: boolean;
}

/**
 * The user prompt for a paused lesson that continues after a doubt. The
 * teaching model must not see the original question again or it restarts.
 */
export const RESUME_LESSON_USER_PROMPT = "continue";

const RESUME_AFTER_DOUBT_NOTE =
  "A doubt on this board has been answered. Pick up the original lesson from the next unwritten step. Do not restart, do not recap, and do not repeat the doubt.";

/** The full user prompt for the first resume chunk, including any DSA leftover. */
export function resumeLessonUserPrompt(codeLessonNote?: string | null): string {
  return [RESUME_LESSON_USER_PROMPT, (codeLessonNote ?? "").trim(), RESUME_AFTER_DOUBT_NOTE]
    .filter(Boolean)
    .join("\n\n");
}

const RESUME_LENGTH_ADDON = `LESSON LENGTH FOR THIS CONTINUATION
This overrides every earlier step count, including the floors for a numbered problem or an explain request. Finish only what is left of the original question. Do not restart, and do not add a new example.`;

const RESUME_CONTINUATION_PROMPT = `Continue the original lesson exactly where it stopped before the doubt. Return only [STEP]...[/STEP] blocks. Do not restate anything already said, do not recap the doubt, and do not start again from the givens.`;

/**
 * The teaching prompt for the rest of a lesson after a mid-lesson doubt.
 *
 * Same page, same figure, same numbers. The doubt has been answered; this turn
 * picks up the original problem and teaches it to the end.
 */
export function buildResumeTeachingPrompt(input: ResumeTeachingPromptInput): TurnTeachingPrompt {
  const lessonQuestion = input.lessonQuestion.trim();
  const panelShowing = input.codePanelShowing;
  const codeBoard = panelShowing || Boolean(input.codeLessonBoard);
  const figureOnBoard = !codeBoard && Boolean(input.diagramPromptAddon);
  const { turnPlanPromptAddon, solverPromptAddon } = turnPlanPromptAddons(
    lessonQuestion,
    codeBoard ? null : input.turnPlan,
    codeBoard ? null : input.solverProjection,
  );

  const rules = panelShowing
    ? [
        "- Continue the original lesson from the next unwritten step. Do not greet, do not recap, do not repeat the doubt, and do not start the lesson again.",
        "- The left of the board is the code editor and the right is the worked example, and both stay as they are. Never [WRITE]. Reveal remaining code with [TYPE:blockId] and remaining frames with [FOCUS:frame_id].",
        input.codeLessonResumeNote?.trim() ? `- ${input.codeLessonResumeNote.trim()}` : "",
        "- End after the last remaining beat of the original lesson. No recap, and no question back to the student.",
      ]
    : [
        "- Continue the original lesson from the next unwritten step. Do not greet, do not recap, do not repeat the doubt, and do not start from the givens.",
        figureOnBoard
          ? "- The figure on the right is already drawn and stays. [FOCUS:entity_id] when you name a part of it. [ANNOTATE:entity_id] may reveal a withheld measurement the lesson had not reached yet."
          : "- No figure is on this board. Do not use [FOCUS] or [ANNOTATE].",
        "- Never [WRITE] a row that is still on this page. To use one again, say so and point at it with [EMPHASIZE:wN].",
        `- ${doubtSpaceRule(input, figureOnBoard)}`,
        "- Every new step [WRITE]s a short board line and [FOCUS]es named figure parts. Teach to the end of the original question, then stop. No recap, and no question back to the student.",
      ];

  const resumeBlock = [
    "THIS TURN CONTINUES THE PAUSED LESSON",
    lessonQuestion
      ? `The student stopped the lesson on "${lessonQuestion}" to ask a doubt. The doubt has been answered. The board is exactly as they left it after that answer, and everything on it stays where it is.`
      : "The student asked a doubt. It has been answered. Continue the lesson on this board as it stands.",
    panelShowing ? doubtCodeBlock(input.codePanelText) : doubtBoardBlock(input.boardRows),
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
    RESUME_LENGTH_ADDON,
    resumeBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const basePrompt = codeBoard ? CODE_LESSON_CONTINUATION_PROMPT : TUTOR_CONTINUATION_PROMPT;
  return {
    runtimeAddon,
    openingSegment: null,
    givenSegments: [],
    lessonBudget: DOUBT_LESSON_BUDGET,
    systemPrompt: `${basePrompt}\n\n--- current lesson (runtime) ---\n${runtimeAddon}`,
    continuationPrompt: `${RESUME_CONTINUATION_PROMPT}\n\n--- this lesson ---\n${runtimeAddon}`,
  };
}

export function buildTurnTeachingPrompt(input: TurnTeachingPromptInput): TurnTeachingPrompt {
  const { question, codeLesson, turnPlan } = input;

  // A code lesson's figure contract is the frame list inside its own addon.
  // The scene addon speaks the physics language ("read the figure before you
  // calculate with it", "[ANNOTATE:entity_id]") and lists every cell id as a
  // focus target, which is exactly what the code addon then forbids.
  const diagramPromptAddon = codeLesson
    ? (input.diagramPromptAddon ? "" : CODE_LESSON_NO_DIAGRAM_ADDON)
    : (input.diagramPromptAddon ?? TEXT_ONLY_DIAGRAM_ADDON);

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
      })
    : buildGivenValueSegments(question, turnPlan, {
        maxWidth: input.diagramPromptAddon ? WORK_ZONE.maxTextWidth : WORK_ZONE.fullWidthTextWidth,
      });

  // The lesson's first spoken beat. It leads the given rows on a problem, the
  // title and example rows on a code lesson, and the model's first step on an
  // explain question, which had no runtime opening at all and so began on a
  // definition with nothing in front of it.
  const openingSegment = buildLessonOpeningSegment({
    question,
    kind: codeLesson ? "code" : isConceptLessonQuestion(question) ? "concept" : "problem",
    hasBoardOpening: givenSegments.length > 0,
  });

  // How long this lesson should be. Classified from the question, then
  // shifted by the chat-bar familiarity — so a proof stays long on Revision
  // and a one-line substitution stays short on New.
  const lessonBudget = resolveLessonBudget(question, input.familiarity);

  const runtimeAddon = [
    openingSegment ? LESSON_OPENING_PROMPT_ADDON : "",
    codeLesson
      ? dsaOpeningPromptAddon(givenSegments.length > 0)
      : givenValuesPromptAddon(givenSegments.length > 0),
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
    !codeLesson && input.fastMode ? FAST_MODE_TEACHING_ADDON : "",
    !codeLesson ? (FAMILIARITY_ADDONS[input.familiarity] ?? "") : "",
    // Last, so it is the final word on step count: how long THIS question's
    // lesson should be. Without it every question got the same short lesson
    // and stopped at the bottom of the first board page.
    !codeLesson ? lessonScopePromptAddon(lessonBudget) : "",
    teachingPromptAddon({
      teachingNote: input.teachingNote,
      alwaysShowUnits: input.alwaysShowUnits,
      alwaysStateLawFirst: input.alwaysStateLawFirst,
    }),
  ]
    .filter(Boolean)
    .join("\n\n");

  // A code lesson replaces the base prompt rather than overriding it: the
  // physics rules it argued with (one or two sentences a step, a board row in
  // every step, stop before complexity) were being obeyed often enough to
  // shorten lessons and leak handwriting into them.
  const basePrompt = codeLesson ? CODE_LESSON_SYSTEM_PROMPT : TUTOR_SYSTEM_PROMPT;
  const continuationBase = codeLesson ? CODE_LESSON_CONTINUATION_PROMPT : TUTOR_CONTINUATION_PROMPT;
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
