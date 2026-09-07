import {
  CODE_LESSON_STEP_MS,
  CODE_LESSON_TARGET_MS,
  CODE_LESSON_TARGET_BY_FAMILIARITY,
  CODE_LESSON_V1_VERSION,
  FRAME_SWAP_MS,
  codeLessonBeatPlan,
  MAX_BLOCK_LINES,
  MAX_SECTION_BLOCKS,
  codeLessonStepCount,
  MAX_CODE_LINE_CHARS,
  codeLessonBlockById,
  codeLessonSectionCode,
  normalizeCodeLessonPlan,
  validateCodeLessonPlan,
  type CodeLessonPlan,
} from "../../src/code/codeLessonPlan";
import { codeFormatGateIssues } from "../../src/code/codeFormatGate";
import { FIRST_ATTEMPT_BUDGET_SHARE } from "../../src/code/codeLessonPlanner";
import {
  classifyDsaQuestion,
  detectCodeLessonLanguage,
} from "../../src/code/classifyDsaQuestion";
import {
  CODE_LESSON_V1_PROMPT,
} from "../../src/code/codeLessonPlanner";
import { codeLessonPromptAddon } from "../../src/code/codeLessonTeaching";
import {
  MOCK_CODE_LESSONS,
  buildMockCodeLessonTeaching,
  getMockCodeLessonPlan,
} from "../../src/code/mockCodeLesson";
import { getMockResponse } from "../../src/llm/mockResponses";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// --- Every mock lesson must pass the same gate as a live planner result. ---

for (const lesson of MOCK_CODE_LESSONS) {
  const plan = { ...lesson.plan, question: "mock" };
  const { plan: validated, issues } = validateCodeLessonPlan(plan);
  assert(
    validated && issues.length === 0,
    `mock lesson "${lesson.plan.title}" fails validation: ${issues.map((issue) => issue.code).join(", ")}`,
  );
  const gateIssues = codeFormatGateIssues(validated);
  assert(
    gateIssues.length === 0,
    `mock lesson "${lesson.plan.title}" fails the format gate: ${gateIssues.map((issue) => `${issue.code} ${issue.message}`).join("; ")}`,
  );
  const teaching = buildMockCodeLessonTeaching(lesson);
  const typeIds = [...teaching.matchAll(/\[TYPE:([^\]]+)\]/g)].map((match) => match[1]!);
  const blockIds = lesson.plan.sections.flatMap((section) =>
    section.blocks.map((block) => block.id));
  assert(
    typeIds.length === blockIds.length &&
      blockIds.every((id) => typeIds.includes(id)),
    `mock teaching for "${lesson.plan.title}" must TYPE every block exactly once`,
  );
  for (const id of typeIds) {
    assert(
      codeLessonBlockById(validated, id),
      `mock teaching TYPE id "${id}" resolves to a block`,
    );
  }
  assert(
    /\[STEP\][\s\S]*\[\/STEP\]/.test(teaching),
    "mock teaching uses [STEP] blocks",
  );
}

// --- Shape validation and gate rejections must fail closed. ---

const goodPlan = getMockCodeLessonPlan("explain binary search");
assert(goodPlan.sections.length >= 1, "mock plan has sections");

function mutate(fn: (plan: CodeLessonPlan) => unknown): { valid: boolean; codes: string[] } {
  const copy = JSON.parse(JSON.stringify(goodPlan)) as CodeLessonPlan;
  const mutated = fn(copy) ?? copy;
  const { plan, issues } = validateCodeLessonPlan(mutated);
  if (!plan) return { valid: false, codes: issues.map((issue) => issue.code) };
  const gate = codeFormatGateIssues(plan);
  return { valid: gate.length === 0, codes: gate.map((issue) => issue.code) };
}

const wide = mutate((plan) => {
  plan.sections[0]!.blocks[0]!.code += `\n    ${"x".repeat(MAX_CODE_LINE_CHARS)}`;
});
assert(!wide.valid && wide.codes.includes("line_too_wide"), "over-wide line is rejected");

const tabbed = mutate((plan) => {
  plan.sections[0]!.blocks[0]!.code = plan.sections[0]!.blocks[0]!.code.replace("    ", "\t");
});
assert(!tabbed.valid && tabbed.codes.includes("tab_indent"), "tab indentation is rejected");

const unbalanced = mutate((plan) => {
  plan.sections[0]!.blocks[0]!.code += "\n    values = [1, 2";
});
assert(
  !unbalanced.valid && unbalanced.codes.includes("unbalanced_delimiters"),
  "unbalanced brackets are rejected",
);

const overlapping = mutate((plan) => {
  plan.sections[0]!.typeAlongRanges = [
    { startLine: 2, endLine: 5 },
    { startLine: 4, endLine: 6 },
  ];
});
assert(
  !overlapping.valid && overlapping.codes.includes("type_along_overlap"),
  "overlapping type-along ranges are rejected",
);

const outOfBounds = mutate((plan) => {
  plan.sections[0]!.typeAlongRanges = [{ startLine: 1, endLine: 999 }];
});
assert(
  !outOfBounds.valid && outOfBounds.codes.includes("type_along_range"),
  "out-of-bounds type-along range is rejected",
);

const duplicateBlock = mutate((plan) => {
  plan.sections[0]!.blocks[1]!.id = plan.sections[0]!.blocks[0]!.id;
});
assert(
  !duplicateBlock.valid && duplicateBlock.codes.includes("block_id_duplicate"),
  "duplicate block ids are rejected",
);

// --- Normalization coerces common planner slop. ---

const sloppy = normalizeCodeLessonPlan(
  {
    schemaVersion: "code-lesson/v1",
    title: " Sloppy ",
    language: "python",
    sections: {
      intro: {
        title: "Intro",
        explanation: "Something.",
        code: "def f():\n\treturn 1  ",
        typeAlongRanges: [[1, 2]],
      },
    },
    diagramHint: { structure: "banana" },
  },
  "q",
);
const sloppyValidated = validateCodeLessonPlan(sloppy);
assert(sloppyValidated.plan, "normalization repairs object-map sections and tuple ranges");
assert(
  codeLessonSectionCode(sloppyValidated.plan.sections[0]!) === "def f():\n    return 1",
  "normalization expands tabs and strips trailing whitespace",
);
assert(
  sloppyValidated.plan.diagramHint.structure === "none",
  "unknown diagram structure falls back to none",
);
assert(
  sloppyValidated.plan.sections[0]!.typeAlongRanges[0]!.endLine === 2,
  "tuple ranges normalize to startLine/endLine",
);

// --- Block granularity is repacked, never rejected. ---
// A live planner run split an 11-line Java method into one block per line and
// the whole lesson was thrown away over the block count, dropping the student
// back to a hand-written fallback. Grouping is presentation only, so it is
// regrouped here and the source must survive byte for byte.

const perLineSource = [
  "static Node reverse(Node head) {",
  "    Node prev = null;",
  "    Node curr = head;",
  "    while (curr != null) {",
  "        Node nextTemp = curr.next;",
  "        curr.next = prev;",
  "        prev = curr;",
  "        curr = nextTemp;",
  "    }",
  "    return prev;",
  "}",
];
const perLinePlan = normalizeCodeLessonPlan(
  {
    schemaVersion: "code-lesson/v1",
    title: "Reverse a linked list",
    language: "java",
    sections: [
      {
        id: "s2",
        title: "Reverse method",
        explanation: "Walk the list once and flip every next pointer.",
        blocks: perLineSource.map((code, index) => ({ id: `s2b${index + 1}`, code })),
        typeAlongRanges: [{ startLine: 3, endLine: 10 }],
      },
    ],
    diagramHint: {
      structure: "linked_list",
      nodes: [
        { id: "n1", label: "1" },
        { id: "n2", label: "2" },
        { id: "n3", label: "3" },
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3" },
      ],
      steps: [
        {
          id: "before",
          nodes: [
            { id: "n1", label: "1" },
            { id: "n2", label: "2" },
            { id: "n3", label: "3" },
          ],
          edges: [
            { from: "n1", to: "n2" },
            { from: "n2", to: "n3" },
          ],
        },
        {
          id: "after",
          nodes: [
            { id: "n1", label: "1" },
            { id: "n2", label: "2" },
            { id: "n3", label: "3" },
          ],
          edges: [
            { from: "n3", to: "n2" },
            { from: "n2", to: "n1" },
          ],
        },
      ],
    },
  },
  "reverse a linked list in java",
);
const perLineValidated = validateCodeLessonPlan(perLinePlan);
assert(
  perLineValidated.plan,
  `one block per line must be repacked, not rejected: ${perLineValidated.issues
    .map((issue) => issue.code)
    .join(", ")}`,
);
const repackedSection = perLineValidated.plan.sections[0]!;
assert(
  repackedSection.blocks.length <= 10 && repackedSection.blocks.length > 1,
  `repacking must group blocks under the cap, got ${repackedSection.blocks.length}`,
);
assert(
  codeLessonSectionCode(repackedSection) === perLineSource.join("\n"),
  "repacking must preserve the section source exactly",
);
assert(
  new Set(repackedSection.blocks.map((block) => block.id)).size === repackedSection.blocks.length,
  "repacked block ids stay unique",
);
assert(
  codeFormatGateIssues(perLineValidated.plan).length === 0,
  "repacked plan still passes the format gate",
);

// A block far longer than one narration step is split before merging.
const oneGiantBlock = normalizeCodeLessonPlan(
  {
    schemaVersion: "code-lesson/v1",
    title: "Long section",
    language: "python",
    sections: [
      {
        id: "s1",
        title: "All at once",
        explanation: "Everything in a single block.",
        blocks: [{ id: "s1b1", code: perLineSource.map(() => "x = 1").join("\n") }],
        typeAlongRanges: [],
      },
    ],
    diagramHint: { structure: "none" },
  },
  "q",
);
const giantValidated = validateCodeLessonPlan(oneGiantBlock);
assert(giantValidated.plan, "an oversized single block is split, not rejected");
assert(
  giantValidated.plan.sections[0]!.blocks.every(
    (block) => block.code.split("\n").length <= 8,
  ),
  "no repacked block exceeds one reveal's worth of lines",
);

// Repeated section ids would collide block ids the [TYPE] tags resolve against.
const duplicateSectionIds = normalizeCodeLessonPlan(
  {
    schemaVersion: "code-lesson/v1",
    title: "Duplicate ids",
    language: "python",
    sections: [
      {
        id: "s1",
        title: "First",
        explanation: "First section.",
        blocks: [{ code: "a = 1" }],
        typeAlongRanges: [],
      },
      {
        id: "s1",
        title: "Second",
        explanation: "Second section.",
        blocks: [{ code: "b = 2" }],
        typeAlongRanges: [],
      },
    ],
    diagramHint: { structure: "none" },
  },
  "q",
);
const duplicateValidated = validateCodeLessonPlan(duplicateSectionIds);
assert(duplicateValidated.plan, "repeated section ids are made unique, not rejected");
const allBlockIds = duplicateValidated.plan.sections.flatMap((section) =>
  section.blocks.map((block) => block.id));
assert(
  new Set(allBlockIds).size === allBlockIds.length,
  "deduped section ids keep block ids unique across the plan",
);

// --- DSA classifier fixtures: positives, language routing, and guards. ---

const positives = [
  "explain binary search",
  "how does a linked list work?",
  "implement quicksort",
  "teach me dynamic programming with the knapsack problem",
  "what is the time complexity of merge sort?",
  "write a function to reverse a string in java",
  "solve two sum in c++",
  "explain bfs traversal of a graph with code",
];
for (const question of positives) {
  assert(classifyDsaQuestion(question).isDsa, `"${question}" routes to the code lesson`);
}

const negatives = [
  "draw the graph of y = x^2",
  "a stack of blocks rests on an incline at 30 degrees",
  "plot the velocity-time graph for uniform acceleration",
  "find the current in the 4 ohm resistor",
  "solve 2x + 3 = 7 and explain each step",
  "use a probability tree diagram for two coin tosses",
  "what is the area of a circle of radius 2?",
];
for (const question of negatives) {
  assert(!classifyDsaQuestion(question).isDsa, `"${question}" stays on the standard pipeline`);
}

assert(detectCodeLessonLanguage("reverse a linked list in java") === "java", "java detected");
assert(detectCodeLessonLanguage("two sum in c++") === "cpp", "c++ detected");
assert(detectCodeLessonLanguage("binary search in typescript") === "typescript", "ts detected");
assert(detectCodeLessonLanguage("binary search in javascript") === "javascript", "js detected");
assert(detectCodeLessonLanguage("explain binary search") === "python", "default is python");

// --- Mock teaching routing. ---

const mockTeaching = getMockResponse("explain binary search");
assert(mockTeaching.includes("[TYPE:s1b1]"), "mock response for DSA questions types code blocks");
assert(!mockTeaching.includes("[WRITE:"), "DSA mock teaching does not handwrite");
const circleTeaching = getMockResponse("find the equation of a circle");
assert(circleTeaching.includes("[WRITE:"), "non-DSA mock responses keep handwriting");

// --- Planner prompt pins the contract the gate enforces. ---

assert(
  CODE_LESSON_V1_PROMPT.includes(`${MAX_CODE_LINE_CHARS} characters per line`),
  "planner prompt states the line-width budget",
);
{
  // The lesson's shape comes from its own material: one step per committed
  // frame, one per code block, an opening and a close. The prompt renders the
  // count from the same function the pacing gate measures, so the ask and the
  // check cannot drift.
  const frames = [
    { id: "input", caption: "the array", narrationIntent: "what we start from" },
    { id: "step1", caption: "first move", narrationIntent: "what the algorithm did first" },
  ];
  const addon = codeLessonPromptAddon(goodPlan, { frames, familiarity: "normal" });
  const beats = codeLessonBeatPlan({
    frames: frames.map((frame) => ({ id: frame.id, caption: frame.caption })),
    blockIds: goodPlan.sections.flatMap((section) => section.blocks.map((block) => block.id)),
    familiarity: "normal",
  });
  assert(
    addon.includes(`Exactly ${beats.length} steps`) && /FOCUS:input\|spotlight/.test(addon),
    "teaching addon must walk the committed frames, one spotlighted step each",
  );

  // The band has to be reachable by the lesson shapes that actually occur, not
  // only by the widest one imaginable. Measured over 104 lessons: the median
  // plan had three frames and nine blocks, and under the old contract that
  // shape could not exceed 3.7 minutes however well it was taught, because
  // the step count was frames plus blocks plus two.
  const medianBeats = codeLessonBeatPlan({
    frames: [{ id: "f1", caption: "one" }, { id: "f2", caption: "two" }, { id: "f3", caption: "three" }],
    blockIds: ["b1", "b2", "b3", "b4", "b5", "b6", "b7"],
    familiarity: "normal",
  });
  // What the student actually sits through: the spoken beats plus the pause on
  // each figure swap. Typing often outlasts its narration too, so this is a
  // floor rather than an estimate.
  const medianMs = medianBeats.length * CODE_LESSON_STEP_MS.normal + 3 * FRAME_SWAP_MS;
  assert(
    medianMs >= CODE_LESSON_TARGET_BY_FAMILIARITY.normal.min,
    `a typical plan of three frames and seven blocks reaches only ${Math.round(medianMs / 60000)} minutes`,
  );
  assert(
    CODE_LESSON_TARGET_BY_FAMILIARITY.normal.min >= CODE_LESSON_TARGET_MS.min - 60_000,
    "the Normal band must still sit at the target the owner asked for",
  );
}
assert(/typeAlongRanges/.test(CODE_LESSON_V1_PROMPT), "planner prompt describes type-along ranges");
assert(/diagramHint/.test(CODE_LESSON_V1_PROMPT), "planner prompt describes the diagram hint");
assert(/never tabs/.test(CODE_LESSON_V1_PROMPT), "planner prompt forbids tabs");
assert(
  /REQUIRED whenever structure is array/.test(CODE_LESSON_V1_PROMPT),
  "planner prompt requires worked-example steps for graph, array, and table algorithms",
);
assert(
  /Do not omit steps for graphs, arrays, or tables/.test(CODE_LESSON_V1_PROMPT),
  "planner prompt forbids dropping steps on graph/array/table lessons",
);

const missingSteps = mutate((plan) => {
  plan.diagramHint = { structure: "graph", nodes: [{ id: "a", label: "A" }], edges: [] };
});
assert(
  !missingSteps.valid && missingSteps.codes.includes("diagram_steps"),
  "a graph without diagramHint.steps is rejected",
);

const mockTeachingWalk = getMockResponse("explain binary search");
assert(
  /\[FOCUS:input\|spotlight\]/.test(mockTeachingWalk),
  "mock DSA teaching spotlights the first worked-example frame",
);
assert(
  /\[FOCUS:[^\]]+\|spotlight\]/.test(mockTeachingWalk) &&
    mockTeachingWalk.indexOf("[FOCUS:") < mockTeachingWalk.indexOf("[TYPE:"),
  "mock DSA teaching walks the figure before typing code",
);

// --- A slow first attempt must not starve the repair. ---
{
  // The lane plans, then repairs what deterministic validation rejected. A
  // rejected first plan is the normal case, so the repair has to be
  // affordable: measured live, a plan that ran 53 of its 60 seconds left the
  // repair to be aborted after 9, and the turn lost its code panel and its
  // worked example with it.
  assert(
    FIRST_ATTEMPT_BUDGET_SHARE > 0 && FIRST_ATTEMPT_BUDGET_SHARE < 1,
    `the first attempt must leave something behind, got ${FIRST_ATTEMPT_BUDGET_SHARE}`,
  );
  const laneMs = 60_000;
  const firstMs = Math.max(Math.round(laneMs * FIRST_ATTEMPT_BUDGET_SHARE), 1_000);
  const repairMs = laneMs - firstMs;
  assert(
    repairMs >= 15_000,
    `a repair with ${repairMs}ms cannot finish; the first attempt is taking too much of ${laneMs}ms`,
  );
  assert(
    firstMs >= repairMs,
    "the first attempt should still get the larger half; the repair is the fallback",
  );
}

// --- A practice range must never cost the student the lesson. ---
{
  // Measured live on "implement a queue using two stacks": the model returned
  // a complete, valid program whose typeAlongRanges ran past the end of the
  // section, and both the plan and the repair were rejected for it. The
  // student got no code panel and no worked example, for a slip in a practice
  // aid nobody had asked for yet.
  const source = ["def push(self, x):", "    self.inbox.append(x)", "    return None"].join("\n");
  const sloppyRanges = {
    schemaVersion: CODE_LESSON_V1_VERSION,
    question: "implement a queue using two stacks",
    title: "Queue from two stacks",
    language: "python",
    sections: [{
      id: "s1",
      title: "Push",
      explanation: "Pushes always land on the inbox stack.",
      blocks: [{ id: "s1b1", code: source }],
      // Runs off the end of a three-line section, and the second range starts
      // inside the first.
      // Out of order as well as out of range: sorted first, or the earlier
      // range would be clamped against the later one's end and disappear.
      typeAlongRanges: [{ startLine: 3, endLine: 9 }, { startLine: 1, endLine: 2 }],
    }],
    diagramHint: {
      structure: "array",
      values: [1, 2, 3],
      steps: [{ id: "input" }, { id: "pop" }],
    },
  };
  const rescued = validateCodeLessonPlan(
    normalizeCodeLessonPlan(sloppyRanges, "implement a queue using two stacks"),
  );
  assert(
    rescued.plan,
    `an out-of-range practice range must not reject the lesson: ${rescued.issues.map((issue) => issue.code).join(",")}`,
  );
  const section = rescued.plan.sections[0]!;
  const lineCount = codeLessonSectionCode(section).split("\n").length;
  assert(
    codeLessonSectionCode(section) === source,
    "clamping a practice range must not touch the source",
  );
  for (const range of section.typeAlongRanges) {
    assert(
      range.startLine >= 1 && range.endLine <= lineCount && range.startLine <= range.endLine,
      `range ${range.startLine}-${range.endLine} is outside the ${lineCount}-line section`,
    );
  }
  let end = 0;
  for (const range of section.typeAlongRanges) {
    assert(range.startLine > end, "clamped ranges must not overlap each other");
    end = range.endLine;
  }
  assert(
    section.typeAlongRanges.length === 2,
    `both ranges must survive being given out of order, kept ${section.typeAlongRanges.length}`,
  );
}

// --- One block is one beat, so a whole function is not one block. ---
{
  // A planner that returns one block per function gives a three-beat lesson:
  // three paragraphs of speech while an entire program types itself. The
  // normalizer repacks to a teachable grain, and the one invariant that must
  // survive is that the source is unchanged — a block boundary may move, a
  // line may not.
  const wholeFunction = [
    "def two_sum(nums, target):",
    "    index = {}",
    "    for i, num in enumerate(nums):",
    "        complement = target - num",
    "        if complement in index:",
    "            return [index[complement], i]",
    "        index[num] = i",
    "    return []",
  ].join("\n");
  const onePerFunction = {
    schemaVersion: CODE_LESSON_V1_VERSION,
    question: "two sum",
    title: "Two sum",
    language: "python",
    sections: [{
      id: "s1",
      title: "Two sum",
      explanation: "One pass with a hash map.",
      blocks: [{ id: "s1b1", code: wholeFunction }],
      typeAlongRanges: [],
    }],
    diagramHint: {
      structure: "array",
      values: [2, 7, 11, 15],
      steps: [{ id: "input" }, { id: "hit" }],
    },
  };
  const repacked = validateCodeLessonPlan(normalizeCodeLessonPlan(onePerFunction, "two sum"));
  assert(repacked.plan, `an eight-line function must still be a valid plan: ${repacked.issues.map((issue) => issue.code).join(",")}`);
  const section = repacked.plan.sections[0]!;
  assert(
    section.blocks.length >= 3,
    `an eight-line function must become several beats, got ${section.blocks.length}`,
  );
  assert(
    section.blocks.length <= MAX_SECTION_BLOCKS,
    `a section may not exceed ${MAX_SECTION_BLOCKS} blocks, got ${section.blocks.length}`,
  );
  assert(
    codeLessonSectionCode(section) === wholeFunction,
    "repacking may move a block boundary but never change a line of source",
  );
  for (const block of section.blocks) {
    assert(
      block.code.split("\n").length <= MAX_BLOCK_LINES,
      `block ${block.id} is ${block.code.split("\n").length} lines`,
    );
  }

  // A long section still has to fit the block cap, so the grain coarsens
  // rather than the plan failing.
  const longSource = Array.from({ length: 36 }, (_, index) => `    line_${index + 1} = ${index}`).join("\n");
  const longPlan = {
    ...onePerFunction,
    sections: [{ ...onePerFunction.sections[0]!, blocks: [{ id: "s1b1", code: `def f():\n${longSource}` }] }],
  };
  const longRepacked = validateCodeLessonPlan(normalizeCodeLessonPlan(longPlan, "two sum"));
  assert(longRepacked.plan, "a 37-line section must still validate after repacking");
  const longSection = longRepacked.plan.sections[0]!;
  assert(
    longSection.blocks.length <= MAX_SECTION_BLOCKS,
    `a long section must coarsen to fit ${MAX_SECTION_BLOCKS} blocks, got ${longSection.blocks.length}`,
  );
  assert(
    codeLessonSectionCode(longSection) === `def f():\n${longSource}`,
    "coarsening must not change the source either",
  );
}

console.log("verify-code-lesson-plan: ok");
