import { WORK_ZONE, fitBoardText, type TutorSegment } from "@heytutor/drawing";
import type { SubjectFamiliarity } from "../llm/systemPrompt";
import {
  CODE_LESSON_STEP_WORDS,
  codeLessonBeatPlan,
  type CodeLessonBeat,
  type CodeLessonPlan,
} from "./codeLessonPlan";

/**
 * One frame of the walk-through that is actually committed to the board.
 *
 * This is the whole point of the type: the runtime draws a compiled sequence
 * of figures — from a real simulator run when the algorithm is recognised,
 * from the planner's own hint steps otherwise — and the narration has to be
 * about *those*. The prompt used to describe `plan.diagramHint.steps`, which
 * is what the planner asked for rather than what the compiler drew, so the
 * tutor narrated frames the student could not see and spotlighted ids that
 * were never on the board.
 */
export interface CodeLessonFigureFrame {
  id: string;
  /** The line drawn under the figure. */
  caption: string;
  /** What this frame is for, written by whoever produced the frame. */
  narrationIntent: string;
}

export interface CodeLessonTeachingOptions {
  /** The committed walk-through, in order. None of it is on the board yet. */
  frames?: readonly CodeLessonFigureFrame[];
  familiarity?: SubjectFamiliarity;
  /** Terms this family introduces, for the concept beats on New. */
  terms?: readonly string[];
  /** The answer the walk-through ends on. */
  resultText?: string;
  /** The walk stopped early because the algorithm found its answer. */
  earlyExit?: boolean;
}

/**
 * The system prompt for a DSA turn.
 *
 * A code lesson used to run on the physics teaching prompt with an addon that
 * announced it was overriding it. The base prompt asks for one or two short
 * sentences a step, forbids a step that writes no board row, tells the tutor
 * to stop before complexity analysis, and carries a ten-step worked example
 * made of [WRITE] rows. Measured over 104 lessons, the model obeyed the base
 * prompt often enough to leak handwriting into sixteen lessons and to skip
 * the complexity close in twelve. An override is weaker than an absence, so
 * this replaces it outright.
 */
export const CODE_LESSON_SYSTEM_PROMPT = `you are clicky, a clear and patient teacher with a voice, a shared board, and a pen. your words are spoken aloud, so write natural sentences for the ear, in lowercase conversational english, capitalised only where a name needs it.

what is on the board:
- at the start the left column already has the problem written in ink: the title and the example values. you never rewrite those rows. the worked-example figure is not on the board yet, and neither is the code editor.
- the figure on the right appears when you name its first frame, then moves frame by frame. you are told each frame's caption and the facts it establishes. you never draw, mark, erase or change it; you say what it shows and why.
- the editor on the left appears when you reveal the first code block, and then types a verified program one block at a time. you never write code by hand and never dictate it character by character. never mention an editor, a panel, or a figure the student cannot see yet.

output format:
- return only a sequence of [STEP]...[/STEP] blocks, one per beat of the lesson shape you are given, in that order.
- a figure step carries exactly one [FOCUS:frame_id|spotlight] and nothing else. a code step carries exactly one [TYPE:blockId] and nothing else. an opening, a trace-through and a close carry no tag at all.
- a figure step puts its tag after the first sentence that names the frame, so the picture moves on the name and the rest of the step explains it. a code step puts its tag after the words that explain the block.
- [PAUSE:800] is allowed before a result the student should look at.
- never use [WRITE], [LABEL], [EMPHASIZE], [ANNOTATE], [DRAW_*], [ARROW], [UNDERLINE], [CIRCLE_AROUND], [HIGHLIGHT], [ERASE] or [CLEAR]. this turn owns no handwriting.

how to teach code:
- say what a line does before you say what it is called, and say why it is there: which move on the figure it carries out.
- never speak a line of code verbatim and never spell out punctuation. say "we return the two indices", not "return open bracket i comma j close bracket".
- say notation for the ear: "target minus num", "i is not equal to j", "n log n".
- name a variable by its meaning the first time: "seen, the map from a value to where we passed it".
- the first code step of a section opens with one sentence saying what the section is for.
- every step says something new. never restate a sentence, never re-explain a block already revealed, never summarise what you have already said.

voice:
- sound like a patient teacher: short clauses, a breath after a result, then the next idea.
- never say "simply", "just", "as you can see", "let me draw", "i will write".
- never mention a planner, a runtime, a compiler, a schema, a validator, a token, a block id, a frame id, or a beat. the student is looking at a board, not at machinery.
- never use a dash as punctuation. use a comma, a colon, or a second sentence.
- no markdown, no bullet lists, no emojis, no meta commentary.`;

/** What each familiarity spends its words on. */
const FAMILIARITY_SHAPE: Record<SubjectFamiliarity, { words: number; guidance: string }> = {
  new: {
    words: CODE_LESSON_STEP_WORDS.new,
    guidance: `FAMILIARITY: NEW. The student has not met this technique. Teach the tool itself before it is used: what a hash map, a pointer, a stack or a recursive call is, in plain words, with what it is good at and what it costs. Give the slow way first and say why it is too slow, because that is what makes the idea land. On every figure beat say what changed and why with the actual numbers, and say what the algorithm will do next. On every code beat say what the line does before you say what it is called, and connect it to the frame that showed it happening.`,
  },
  normal: {
    words: CODE_LESSON_STEP_WORDS.normal,
    guidance: `FAMILIARITY: NORMAL. The student has seen this before and is rusty. Skip the definitions, but give the slow way one sentence and the reason it is slow. On every figure beat say why the algorithm makes this move, with the numbers, and what it will do next. On every code beat connect the line to the frame it implements.`,
  },
  revision: {
    words: CODE_LESSON_STEP_WORDS.revision,
    guidance: `FAMILIARITY: REVISION. The student knows this and wants it sharpened. Do not motivate the technique or define its terms, and take each frame in one step. Spend the words where memory actually fails: the invariant the loop keeps, the exact loop bounds and update order, the edge cases, and the two mistakes people really make writing this.`,
  },
};

function renderBeat(beat: CodeLessonBeat, index: number, blockSource: (id: string) => string | null): string {
  const head = `${index + 1}. ${beat.tag ?? "(no tag)"}`;
  const code = beat.blockId ? blockSource(beat.blockId) : null;
  const lines = [`${head} — ${beat.brief}`];
  if (code) lines.push(code.split("\n").map((line) => `      ${line}`).join("\n"));
  return lines.join("\n");
}

/**
 * Runtime teaching addon for a committed code lesson. The code itself is
 * already validated and lives in the IDE panel; the teaching stream narrates
 * and reveals blocks with [TYPE:blockId] — it never writes code ink.
 */
export function codeLessonPromptAddon(
  plan: CodeLessonPlan,
  options: CodeLessonTeachingOptions = {},
): string {
  const familiarity = options.familiarity ?? "normal";
  const shape = FAMILIARITY_SHAPE[familiarity];
  const frames = options.frames ?? [];
  const blockIds = plan.sections.flatMap((section) => section.blocks.map((block) => block.id));
  const beats = codeLessonBeatPlan({
    frames: frames.map((frame) => ({ id: frame.id, caption: frame.caption })),
    blockIds,
    familiarity,
    earlyExit: options.earlyExit,
    terms: options.terms,
    resultText: options.resultText,
  });

  const blockSource = (id: string): string | null => {
    for (const section of plan.sections) {
      const block = section.blocks.find((candidate) => candidate.id === id);
      if (block) return block.code;
    }
    return null;
  };

  const sectionListing = plan.sections
    .map((section) => `SECTION ${section.id} — ${section.title}\n${section.explanation}`)
    .join("\n\n");

  return `CODE LESSON — this turn teaches an algorithm with a pre-committed, validated ${plan.language} program titled "${plan.title}". The left column already holds the problem in ink. The worked example appears on the right when you name the first frame, and the editor appears on the left when you reveal the first code block.

LESSON SHAPE. Exactly ${beats.length} steps, listed below, in this order, nothing added and nothing skipped. Each step is at least ${shape.words} spoken words, unless its own line below says otherwise, and none runs past about ${Math.round(shape.words * 1.6)}. A step shorter than the floor is a summary, and a summary is the one thing this lesson must not be: the student cannot see how long the lesson is and is not waiting for it to end. Spend the words on the reasoning, which is what the figure and the code cannot say for themselves.

${shape.guidance}

${figureFrameFacts(frames)}

THE STEPS, in order. Each line says what that step is about; it is a brief, not an opening line, so never read it out and never start a step by describing the board's machinery ("the figure has moved", "stay on this frame"). Start with the substance.
${beats.map((beat, index) => renderBeat(beat, index, blockSource)).join("\n")}

Hard rules for this turn:
- One tag per step, exactly as listed above. A figure tag sits after the first sentence that names the frame; a code tag sits after the words that explain the block. Never two tags, never a tag the list does not give you.
- A figure step names a frame. The figure moves to that frame the first time you name it and stays there while you keep naming it, so two steps on one frame are two steps on the same picture. Never name a frame you have already left.
- Reveal every block exactly once, in the order listed. Never invent, repeat or skip a block id.
- Never write code, values, or expressions as board ink. This turn owns no handwriting.
- Close with the complexity and the reason for it. Do not end on a recap of the lesson.

The committed program, section by section (context for your narration only, never read out):

${sectionListing}`;
}

/**
 * The frames the runtime has actually committed, in order.
 *
 * Each frame carries the caption drawn under it and the facts established by
 * whoever produced it: for a recognised algorithm those come from the
 * simulator that ran the example, so they state what genuinely happened. They
 * are handed over as notes, not as a script, because when they were rendered
 * as "cover: ..." the model recited them word for word and a beat asked for
 * four sentences came out as the simulator's two.
 */
function figureFrameFacts(frames: readonly CodeLessonFigureFrame[]): string {
  if (frames.length === 0) {
    return `FIGURE — there is no walk-through this turn. The picture on the right does not move, so do not use [FOCUS] at all and do not describe frames that are not there. Open from the values already written on the left, then go to the code steps.`;
  }
  const lines = frames
    .map((frame, index) => {
      const role = index === 0
        ? " (not on the board yet: naming it draws the example)"
        : "";
      return `frame ${index + 1} [FOCUS:${frame.id}|spotlight]${role}\n   caption drawn under it: ${frame.caption}\n   what it establishes: ${frame.narrationIntent}`;
    })
    .join("\n");
  return `FIGURE — ${frames.length} frames of one worked example, drawn on the right in this order. None of them is on the board when you start. Naming a frame draws it. For each one you are given the caption the student can read and the facts it establishes. Those facts are notes, not a script: never read them out and never quote the caption. Say the same facts in your own words with the real numbers, and add what the notes leave out, which is why the algorithm made that move and what it does next.
${lines}`;
}

export interface DsaOpeningInput {
  title: string;
  question: string;
  /** Concrete example the figure will walk, when known. */
  example?: Record<string, unknown> | null;
}

const MAX_OPENING_ROWS = 6;
const MAX_EXAMPLE_FIELDS = 4;

/**
 * Runtime-owned opening for a DSA turn: the pen writes the problem on the left
 * before any figure or editor appears.
 *
 * The teaching model used to open on a dumped first frame and an empty code
 * panel, so the student saw the answer-shaped board and then heard the
 * question restated. These rows are the question, in ink, with the voice on
 * the pen.
 */
export function buildDsaOpeningSegments(input: DsaOpeningInput): TutorSegment[] {
  const rows = dsaOpeningRows(input).slice(0, MAX_OPENING_ROWS);
  return rows.map((row, index) => ({
    narration: row.spoken,
    command: {
      type: "WRITE" as const,
      params: [WORK_ZONE.marginX, WORK_ZONE.topY + index * WORK_ZONE.lineHeight],
      text: row.board,
      charPosition: 0,
      narrationBefore: row.spoken,
      syncable: true,
    },
  }));
}

/** Work-row ids the opening WRITEs will register as, in order, on an empty board. */
export function dsaOpeningPointIds(rowCount: number): string[] {
  if (rowCount <= 0) return [];
  return Array.from({ length: rowCount }, (_, index) => `w${index + 1}`);
}

export function dsaOpeningPromptAddon(hasOpening: boolean): string {
  if (!hasOpening) return "";
  return `PROBLEM IS ALREADY ON THE BOARD
The runtime already spoke the opening line, then wrote the problem title and the example values on the left, in ink, with the pen. Do not rewrite them, do not open the lesson a second time, and do not read the question back.
Start by saying what is being asked, in plain words, using those values. The worked-example figure is not on the board yet: it appears when you name the first frame. The code editor is not on the board yet: it appears when you reveal the first code block. Never mention an editor, a panel, or a figure that the student cannot see.`;
}

function dsaOpeningRows(input: DsaOpeningInput): Array<{ board: string; spoken: string }> {
  const rows: Array<{ board: string; spoken: string }> = [];
  const ask = problemAsk(input.question);
  const title = input.title.trim() || "the problem";
  const titleBlock = fitBoardText(title, {
    role: "work",
    maxWidth: WORK_ZONE.maxTextWidth,
  });
  for (const [index, line] of titleBlock.lines.entries()) {
    rows.push({
      board: line,
      spoken: index === 0
        ? (ask || `the question is ${title}`)
        : line,
    });
  }
  for (const [key, value] of exampleEntries(input.example)) {
    const board = `${key} = ${boardValue(value)}`;
    const block = fitBoardText(board, {
      role: "work",
      maxWidth: WORK_ZONE.maxTextWidth,
    });
    for (const [index, line] of block.lines.entries()) {
      rows.push({
        board: line,
        spoken: index === 0 ? `${speakKey(key)} is ${speakValue(value)}` : line,
      });
    }
  }
  return rows;
}

/** The stem before Example / Input / Constraints, so the opening is the ask. */
function problemAsk(question: string): string {
  const body = question.split(
    /\n\s*(?:example\s*\d*\s*:|input\s*:|output\s*:|constraints\s*:)/i,
  )[0] ?? question;
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const sentences = compact.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [compact];
  return sentences.slice(0, 2).join(" ").trim();
}

function exampleEntries(
  example: Record<string, unknown> | null | undefined,
): Array<[string, unknown]> {
  if (!example) return [];
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(example)) {
    if (value === undefined || value === null) continue;
    entries.push([key, value]);
    if (entries.length >= MAX_EXAMPLE_FIELDS) break;
  }
  return entries;
}

function boardValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map(boardValue).join(", ")}]`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function speakKey(key: string): string {
  if (key === "nums" || key === "arr" || key === "array") return "the array";
  if (key === "target") return "the target";
  if (key === "s" || key === "str" || key === "string") return "the string";
  if (key === "n") return "n";
  return key.replace(/_/g, " ");
}

function speakValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.length === 1 ? value : `"${value}"`;
  if (Array.isArray(value)) return value.map(speakValue).join(", ");
  return boardValue(value);
}
