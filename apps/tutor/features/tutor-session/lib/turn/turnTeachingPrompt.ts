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
  CODE_LESSON_SYSTEM_PROMPT,
  CONCEPT_LESSON_RUNTIME_ADDON,
  FAMILIARITY_ADDONS,
  FAST_MODE_TEACHING_ADDON,
  TUTOR_CONTINUATION_PROMPT,
  TUTOR_SYSTEM_PROMPT,
  buildGivenValueSegments,
  codeLessonPromptAddon,
  givenValuesPromptAddon,
  isConceptLessonQuestion,
  isQuotedPhysicalConstant,
  lessonScopePromptAddon,
  questionStatesValue,
  resolveLessonBudget,
  type CodeLessonFigureFrame,
  type CodeLessonPlan,
  type LessonBudget,
  type SubjectFamiliarity,
} from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

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
  codeLessonFacts?: { terms?: readonly string[]; resultText?: string; earlyExit?: boolean };
  /** The stem is a coding problem, whether or not the code lesson compiled. */
  isDsa: boolean;
  familiarity: SubjectFamiliarity;
  fastMode: boolean;
}

export interface TurnTeachingPrompt {
  systemPrompt: string;
  continuationPrompt: string;
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

export function buildTurnTeachingPrompt(input: TurnTeachingPromptInput): TurnTeachingPrompt {
  const { question, codeLesson, turnPlan } = input;

  // A code lesson's figure contract is the frame list inside its own addon.
  // The scene addon speaks the physics language ("read the figure before you
  // calculate with it", "[ANNOTATE:entity_id]") and lists every cell id as a
  // focus target, which is exactly what the code addon then forbids.
  const diagramPromptAddon = codeLesson
    ? (input.diagramPromptAddon ? "" : CODE_LESSON_NO_DIAGRAM_ADDON)
    : (input.diagramPromptAddon ?? TEXT_ONLY_DIAGRAM_ADDON);

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
  const solverVerified = Boolean(input.solverProjection);
  const turnPlanPromptAddon = turnPlan && !codeLesson
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

  const solverPromptAddon = input.solverProjection
    ? `INDEPENDENT SOLVER AUTHORITY V1
Use exactly these solver-verified values and formulation inputs. Do not independently replace or contradict them.
${JSON.stringify(input.solverProjection)}`
    : "";

  // A figure claims the right of the board, so the given list has to fit the
  // narrow left column. With no figure it may use the full width rather
  // than wrapping a two-value list across three rows.
  const givenSegments = codeLesson
    ? []
    : buildGivenValueSegments(question, turnPlan, {
        maxWidth: input.diagramPromptAddon ? WORK_ZONE.maxTextWidth : WORK_ZONE.fullWidthTextWidth,
      });

  // How long this lesson should be. Classified from the question, then
  // shifted by the chat-bar familiarity — so a proof stays long on Revision
  // and a one-line substitution stays short on New.
  const lessonBudget = resolveLessonBudget(question, input.familiarity);

  const runtimeAddon = [
    givenValuesPromptAddon(givenSegments.length > 0),
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
    !codeLesson && input.fastMode ? FAST_MODE_TEACHING_ADDON : "",
    !codeLesson ? (FAMILIARITY_ADDONS[input.familiarity] ?? "") : "",
    // Last, so it is the final word on step count: how long THIS question's
    // lesson should be. Without it every question got the same short lesson
    // and stopped at the bottom of the first board page.
    !codeLesson ? lessonScopePromptAddon(lessonBudget) : "",
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
