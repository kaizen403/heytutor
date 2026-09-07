/**
 * Teaching-prompt gate for a DSA turn.
 *
 * Two things the tutor says have to be true of the board it is standing at:
 *
 *   1. every figure it describes is a frame the runtime actually committed.
 *      The prompt used to list `plan.diagramHint.steps` — what the planner
 *      asked for — while the board showed compiled trace frames with entirely
 *      different ids. The tutor narrated pictures the student could not see
 *      and spotlighted ids that were never drawn, and nothing caught it;
 *   2. familiarity changes the lesson. A code lesson was the one turn that
 *      dropped the familiarity addon on the floor, so New, Normal and
 *      Revision produced the identical script.
 *
 * The prompt is a pure function of the plan, the frames, and the familiarity,
 * so both are checkable without a model.
 */
import {
  CODE_LESSON_STEP_WORDS,
  CODE_LESSON_SYSTEM_PROMPT,
  codeLessonBeatPlan,
  codeLessonPromptAddon,
  getMockCodeLessonPlan,
  type CodeLessonFigureFrame,
  type SubjectFamiliarity,
} from "../../src/index";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PLAN = getMockCodeLessonPlan("two sum with a hash map");
const BLOCK_IDS = PLAN.sections.flatMap((section) => section.blocks.map((block) => block.id));

const FRAMES: CodeLessonFigureFrame[] = [
  {
    id: "input",
    caption: "Find two values summing to 26",
    narrationIntent:
      "The array is not sorted, so two pointers will not work. Instead we remember every value we have already passed.",
  },
  {
    id: "store0",
    caption: "need 24, not seen yet",
    narrationIntent: "2 needs 24 as a partner, and nothing we have passed is 24.",
  },
  {
    id: "hit3",
    caption: "11 + 15 = 26",
    narrationIntent: "We need 11 to reach 26, and 11 is already in the map at index 2.",
  },
];

// --- The prompt describes the committed frames, and only those. ---
{
  const prompt = codeLessonPromptAddon(PLAN, { frames: FRAMES, familiarity: "normal" });
  for (const frame of FRAMES) {
    assert(
      prompt.includes(`[FOCUS:${frame.id}|spotlight]`),
      `frame ${frame.id} must be offered as a spotlight tag`,
    );
    assert(prompt.includes(frame.caption), `frame ${frame.id} must carry the caption on the board`);
    assert(
      prompt.includes(frame.narrationIntent),
      `frame ${frame.id} must carry what the runtime says that frame is for`,
    );
  }
  // The hint's own step ids are not on the board when a trace compiled, so
  // they must never be offered as focus targets.
  const hintStepIds = (PLAN.diagramHint.steps ?? []).map((step) => step.id);
  for (const id of hintStepIds) {
    if (FRAMES.some((frame) => frame.id === id)) continue;
    assert(
      !prompt.includes(`[FOCUS:${id}|spotlight]`),
      `the planner's hint step "${id}" is not on the board and must not be spotlightable`,
    );
  }
  assert(
    prompt.includes(`${FRAMES.length} frames`),
    "the prompt must say how many frames the walk-through has",
  );
  // The frame facts are notes. Rendered as a script ("cover: ..."), the model
  // recited the simulator's two sentences verbatim and a beat asked for four
  // came back as two.
  assert(
    /notes, not a script/i.test(prompt),
    "the frame facts must be handed over as notes the tutor rewords, not as a script",
  );
}

// --- With no walk-through, the prompt says the figure does not move. ---
{
  const prompt = codeLessonPromptAddon(PLAN, { frames: [], familiarity: "normal" });
  assert(
    /does not move/i.test(prompt),
    "a turn with no frames must tell the tutor the figure is static",
  );
  assert(
    !/\bFIGURE BEATS — \d+ frames\b/.test(prompt),
    "a turn with no frames must not list any",
  );
}

// --- Familiarity changes the script, and says so in the right direction. ---
{
  const prompts = new Map<SubjectFamiliarity, string>();
  for (const familiarity of ["new", "normal", "revision"] as const) {
    prompts.set(familiarity, codeLessonPromptAddon(PLAN, { frames: FRAMES, familiarity }));
  }
  const texts = [...prompts.values()];
  assert(new Set(texts).size === texts.length, "each familiarity must produce its own prompt");

  assert(/FAMILIARITY: NEW/.test(prompts.get("new")!), "New must name its familiarity");
  assert(/FAMILIARITY: REVISION/.test(prompts.get("revision")!), "Revision must name its familiarity");
  // Sentences were the wrong unit: the model's sentences run ten to fourteen
  // words, so "three to four sentences" bought about half the intended time.
  for (const familiarity of ["new", "normal", "revision"] as const) {
    assert(
      prompts.get(familiarity)!.includes(`at least ${CODE_LESSON_STEP_WORDS[familiarity]} spoken words`),
      `${familiarity} must state its own word floor`,
    );
  }
  assert(
    CODE_LESSON_STEP_WORDS.new > CODE_LESSON_STEP_WORDS.normal &&
      CODE_LESSON_STEP_WORDS.normal > CODE_LESSON_STEP_WORDS.revision,
    "New teaches the most and Revision the least, so the word floors must be ordered",
  );

  // Familiarity has to change the lesson's shape, not only its wording: New
  // gets the concept and idea beats, Revision the invariant, edge cases and
  // common bugs.
  const beatsFor = (familiarity: SubjectFamiliarity) =>
    codeLessonBeatPlan({
      frames: FRAMES.map((frame) => ({ id: frame.id, caption: frame.caption })),
      blockIds: BLOCK_IDS,
      familiarity,
      terms: ["hash map"],
    }).map((beat) => beat.kind);
  const newKinds = beatsFor("new");
  const revisionKinds = beatsFor("revision");
  const normalKinds = beatsFor("normal");
  assert(newKinds.includes("concept"), "New must teach the term before it is used");
  assert(!normalKinds.includes("concept"), "Normal has met the term before");
  assert(revisionKinds.includes("invariant") && revisionKinds.includes("edge_cases") && revisionKinds.includes("bugs"),
    "Revision must spend its steps on the invariant, the edge cases and the real bugs");
  assert(!revisionKinds.includes("brute_force"), "Revision does not need the slow way motivated");
  for (const kinds of [newKinds, normalKinds, revisionKinds]) {
    assert(kinds[0] === "opening", "every lesson opens by stating the problem");
    assert(kinds[kinds.length - 1] === "close", "every lesson closes on the complexity");
    assert(kinds.includes("trace_through"), "every lesson runs the finished code on the example");
  }

  const beats = codeLessonBeatPlan({
    frames: FRAMES.map((frame) => ({ id: frame.id, caption: frame.caption })),
    blockIds: BLOCK_IDS,
    familiarity: "normal",
  });
  assert(
    prompts.get("normal")!.includes(`Exactly ${beats.length} steps`),
    "the step count must come from the beats there actually are, not a fixed budget",
  );
  // No minute estimate reaches the model. It is derivable, but a prompt is an
  // instruction rather than a report: a thin plan renders as "roughly two
  // minutes", which reads as permission to finish in two minutes.
  for (const familiarity of ["new", "normal", "revision"] as const) {
    assert(
      !/\bminutes?\b/i.test(prompts.get(familiarity)!),
      `${familiarity} must not hand the model a duration to aim at`,
    );
  }
}

// --- The ownership rules a DSA turn depends on are still stated. ---
{
  const prompt = codeLessonPromptAddon(PLAN, { frames: FRAMES, familiarity: "normal" });
  for (const blockId of BLOCK_IDS) {
    assert(prompt.includes(`[TYPE:${blockId}]`), `block ${blockId} must be revealable`);
  }
  assert(/One tag per step/i.test(prompt), "one tag per step is what maps steps onto beats");
  // The base prompt used to be the physics one, and its "one or two short
  // spoken sentences" beat every override the addon tried. A code lesson now
  // replaces the base prompt outright rather than arguing with it, so the
  // conflicting rule must not reach the model at all.
  assert(
    !CODE_LESSON_SYSTEM_PROMPT.includes("one or two short spoken sentences"),
    "the code-lesson system prompt must not carry the sentence rule that shortened every lesson",
  );
  assert(
    /never restate a sentence/i.test(CODE_LESSON_SYSTEM_PROMPT),
    "repetition must be forbidden explicitly",
  );
  assert(
    /\[WRITE\]/.test(CODE_LESSON_SYSTEM_PROMPT) && /owns no handwriting/i.test(CODE_LESSON_SYSTEM_PROMPT),
    "handwriting must stay banned",
  );
  assert(
    /never mention a planner|never mention a runtime|planner, a runtime/i.test(CODE_LESSON_SYSTEM_PROMPT),
    "the machinery words that leaked into speech must be banned by name",
  );
  assert(
    !/23-37 steps|23 to 37/.test(prompt),
    "the fixed step budget is gone: padding to a step count is what caused the repetition",
  );
}

console.log(
  `verify-code-lesson-teaching: ${FRAMES.length} frames, ${BLOCK_IDS.length} blocks — ` +
    "the prompt describes the committed board and familiarity moves the lesson",
);
