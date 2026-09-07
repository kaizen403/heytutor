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
  /** The committed walk-through, in order. Frame 1 is already on the board. */
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
export const CODE_LESSON_SYSTEM_PROMPT = `you are clicky, a clear and patient teacher with a voice, a code editor on the left of a shared board, and a worked example figure on the right. your words are spoken aloud, so write natural sentences for the ear, in lowercase conversational english, capitalised only where a name needs it.

what is on the board:
- the figure on the right is one worked example, drawn frame by frame. you are told each frame's caption and the facts it establishes. you never draw, mark, erase or change it; you say what it shows and why.
- the editor on the left types a verified program one block at a time, when you ask for it. you never write code by hand and never dictate it character by character.

output format:
- return only a sequence of [STEP]...[/STEP] blocks, one per beat of the lesson shape you are given, in that order.
- a figure step carries exactly one [FOCUS:frame_id|spotlight] and nothing else. a code step carries exactly one [TYPE:blockId] and nothing else. an opening, a trace-through and a close carry no tag at all.
- put the tag at the end of the step, after the words that explain it.
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

  return `CODE LESSON — this turn teaches an algorithm with a pre-committed, validated ${plan.language} program titled "${plan.title}". The code types into the editor on the left while you speak; the worked example on the right is already drawn and moves when you name the next frame.

LESSON SHAPE. Exactly ${beats.length} steps, listed below, in this order, nothing added and nothing skipped. Each step is at least ${shape.words} spoken words, unless its own line below says otherwise, and none runs past about ${Math.round(shape.words * 1.6)}. A step shorter than the floor is a summary, and a summary is the one thing this lesson must not be: the student cannot see how long the lesson is and is not waiting for it to end. Spend the words on the reasoning, which is what the figure and the code cannot say for themselves.

${shape.guidance}

${figureFrameFacts(frames)}

THE STEPS, in order. Each line says what that step is about; it is a brief, not an opening line, so never read it out and never start a step by describing the board's machinery ("the figure has moved", "stay on this frame"). Start with the substance.
${beats.map((beat, index) => renderBeat(beat, index, blockSource)).join("\n")}

Hard rules for this turn:
- One tag per step, exactly as listed above, at the end of the step. Never two tags, never a tag the list does not give you.
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
    return `FIGURE — there is no walk-through this turn. The picture on the right does not move, so do not use [FOCUS] at all and do not describe frames that are not there. Open by naming the concrete example you will refer to, then go to the code steps.`;
  }
  const lines = frames
    .map((frame, index) => {
      const role = index === 0 ? " (on the board when you start)" : "";
      return `frame ${index + 1} [FOCUS:${frame.id}|spotlight]${role}\n   caption drawn under it: ${frame.caption}\n   what it establishes: ${frame.narrationIntent}`;
    })
    .join("\n");
  return `FIGURE — ${frames.length} frames of one worked example, drawn on the right in this order. For each one you are given the caption the student can read and the facts it establishes. Those facts are notes, not a script: never read them out and never quote the caption. Say the same facts in your own words with the real numbers, and add what the notes leave out, which is why the algorithm made that move and what it does next.
${lines}`;
}
