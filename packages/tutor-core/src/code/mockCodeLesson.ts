import type { CodeLessonPlan } from "./codeLessonPlan";

export interface MockCodeLesson {
  keywords: string[];
  plan: Omit<CodeLessonPlan, "question">;
  /** Spoken lesson intro before any code appears. */
  intro: string;
  /** Spoken cue before a section's first block. */
  sectionIntros: Record<string, string>;
  /** Spoken narration paired with each [TYPE:blockId]. */
  narrations: Record<string, string>;
  outro: string;
}

const BINARY_SEARCH: MockCodeLesson = {
  keywords: ["binary search"],
  plan: {
    schemaVersion: "code-lesson/v1",
    title: "Binary search",
    language: "python",
    sections: [
      {
        id: "s1",
        title: "The binary_search function",
        explanation:
          "Two markers fence the part of the array that can still hold the target. Each pass compares the middle value and throws away half the range, so the search takes logarithmic time.",
        blocks: [
          { id: "s1b1", code: "def binary_search(nums, target):\n    lo = 0\n    hi = len(nums) - 1" },
          { id: "s1b2", code: "    while lo <= hi:\n        mid = (lo + hi) // 2" },
          { id: "s1b3", code: "        if nums[mid] == target:\n            return mid" },
          { id: "s1b4", code: "        if nums[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1" },
          { id: "s1b5", code: "    return -1" },
        ],
        typeAlongRanges: [{ startLine: 2, endLine: 12 }],
        diagramCue: "lo, mid, and hi fence the live search range",
      },
      {
        id: "s2",
        title: "Running it",
        explanation:
          "The array must already be sorted for binary search to work. Searching for 12 in this array returns index 3.",
        blocks: [
          { id: "s2b1", code: "nums = [2, 5, 8, 12, 16, 23]\nprint(binary_search(nums, 12))" },
        ],
        typeAlongRanges: [],
      },
    ],
    diagramHint: {
      structure: "array",
      caption: "binary search halves the sorted range",
      values: [2, 5, 8, 12, 16, 23],
      pointers: [
        { name: "lo", index: 0 },
        { name: "mid", index: 2 },
        { name: "hi", index: 5 },
      ],
      steps: [
        {
          id: "input",
          caption: "search 12 in the whole array",
          values: [2, 5, 8, 12, 16, 23],
          pointers: [
            { name: "lo", index: 0 },
            { name: "mid", index: 2 },
            { name: "hi", index: 5 },
          ],
        },
        {
          id: "right",
          caption: "12 is right of 8, so lo moves past mid",
          values: [2, 5, 8, 12, 16, 23],
          pointers: [
            { name: "lo", index: 3 },
            { name: "mid", index: 4 },
            { name: "hi", index: 5 },
          ],
        },
        {
          id: "found",
          caption: "mid lands on 12",
          values: [2, 5, 8, 12, 16, 23],
          pointers: [{ name: "mid", index: 3 }],
        },
      ],
    },
  },
  intro:
    "binary search finds a target in a sorted array by halving the search range every step. look at the array on the right. lo and hi fence the range that can still hold the target, and mid is the value we test next.",
  sectionIntros: {
    s1: "let's build the function itself, piece by piece.",
    s2: "now a quick run to see it work.",
  },
  narrations: {
    s1b1: "we start with two markers. lo points at the first index and hi points at the last, so the whole array is in play.",
    s1b2: "while the range is not empty, we take the index halfway between lo and hi.",
    s1b3: "if the middle value is the target, we are done. return that index.",
    s1b4: "if the middle value is too small, the target can only live to the right, so lo jumps past mid. otherwise hi steps left of mid.",
    s1b5: "if lo ever passes hi, the range is empty and the target is not there, so we return minus one.",
    s2b1: "searching for twelve in this sorted array prints index three.",
  },
  outro:
    "notice how every comparison discards half of what is left. that is why binary search runs in logarithmic time while a plain scan is linear.",
};

const REVERSE_LINKED_LIST: MockCodeLesson = {
  keywords: ["linked list", "reverse a list"],
  plan: {
    schemaVersion: "code-lesson/v1",
    title: "Reverse a linked list",
    language: "python",
    sections: [
      {
        id: "s1",
        title: "The reverse_list function",
        explanation:
          "Three names track the walk: prev is the already-reversed part, curr is the node being flipped, and nxt saves the rest of the list before the link turns around. When curr runs off the end, prev is the new head.",
        blocks: [
          { id: "s1b1", code: "def reverse_list(head):\n    prev = None\n    curr = head" },
          { id: "s1b2", code: "    while curr:\n        nxt = curr.next" },
          { id: "s1b3", code: "        curr.next = prev\n        prev = curr\n        curr = nxt" },
          { id: "s1b4", code: "    return prev" },
        ],
        typeAlongRanges: [{ startLine: 2, endLine: 9 }],
        diagramCue: "each arrow flips to point at the previous node",
      },
    ],
    diagramHint: {
      structure: "linked_list",
      caption: "reverse the next-links one node at a time",
      nodes: [
        { id: "n1", label: "1" },
        { id: "n2", label: "2" },
        { id: "n3", label: "3" },
        { id: "n4", label: "4" },
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3" },
        { from: "n3", to: "n4" },
      ],
      steps: [
        {
          id: "before",
          caption: "1 → 2 → 3 → 4",
          nodes: [
            { id: "n1", label: "1" },
            { id: "n2", label: "2" },
            { id: "n3", label: "3" },
            { id: "n4", label: "4" },
          ],
          edges: [
            { from: "n1", to: "n2" },
            { from: "n2", to: "n3" },
            { from: "n3", to: "n4" },
          ],
        },
        {
          id: "after",
          caption: "after the walk: 4 → 3 → 2 → 1",
          nodes: [
            { id: "n1", label: "1" },
            { id: "n2", label: "2" },
            { id: "n3", label: "3" },
            { id: "n4", label: "4" },
          ],
          edges: [
            { from: "n4", to: "n3" },
            { from: "n3", to: "n2" },
            { from: "n2", to: "n1" },
          ],
        },
      ],
    },
  },
  intro:
    "to reverse a linked list we walk it once and turn every next arrow around. the list on the right shows the nodes and the links we are about to flip.",
  sectionIntros: {
    s1: "here is the whole algorithm as one small function.",
  },
  narrations: {
    s1b1: "prev starts empty because nothing is reversed yet, and curr starts at the head.",
    s1b2: "before touching any link we save the rest of the list in nxt, or the walk would lose it.",
    s1b3: "now the flip. curr points back at prev, then prev and curr both slide one node forward.",
    s1b4: "when curr falls off the end, prev is standing on the last node, which is the new head.",
  },
  outro:
    "one pass, constant extra space. the saved nxt pointer is the whole trick; everything else is bookkeeping.",
};

const TWO_SUM: MockCodeLesson = {
  keywords: ["two sum", "hash map", "hashmap"],
  plan: {
    schemaVersion: "code-lesson/v1",
    title: "Two sum with a hash map",
    language: "python",
    sections: [
      {
        id: "s1",
        title: "The two_sum function",
        explanation:
          "The dictionary remembers every value we have already seen and where it was. For each new value we ask one question: has the partner that completes the target already appeared? One pass, constant-time lookups.",
        blocks: [
          { id: "s1b1", code: "def two_sum(nums, target):\n    seen = {}" },
          { id: "s1b2", code: "    for i, x in enumerate(nums):\n        need = target - x" },
          { id: "s1b3", code: "        if need in seen:\n            return [seen[need], i]" },
          { id: "s1b4", code: "        seen[x] = i\n    return []" },
        ],
        typeAlongRanges: [{ startLine: 2, endLine: 8 }],
        diagramCue: "seen maps each value to its index",
      },
    ],
    diagramHint: {
      structure: "array",
      caption: "for each value, ask if its partner was seen",
      values: [3, 7, 11, 15],
      pointers: [{ name: "i", index: 1 }],
      steps: [
        {
          id: "input",
          caption: "scan [3, 7, 11, 15] for a pair that sums to 18",
          values: [3, 7, 11, 15],
          pointers: [{ name: "i", index: 0 }],
        },
        {
          id: "seen_3",
          caption: "3 is filed; i sits on 7, which needs 11",
          values: [3, 7, 11, 15],
          pointers: [{ name: "i", index: 1 }],
        },
        {
          id: "found",
          caption: "11 was already seen, so 7 and 11 are the pair",
          values: [3, 7, 11, 15],
          pointers: [{ name: "i", index: 2 }],
        },
      ],
    },
  },
  intro:
    "two sum asks for the indices of two values that add up to a target. look at the array on the right. we will scan it once and remember what we have already seen.",
  sectionIntros: {
    s1: "the whole solution is one short function.",
  },
  narrations: {
    s1b1: "seen starts empty. it will map each value we pass to the index where it lives.",
    s1b2: "for every value x we compute the partner it needs to reach the target.",
    s1b3: "if that partner is already in the map, we have our pair. return both indices.",
    s1b4: "otherwise we file x away under its index and keep scanning. no pair means an empty answer.",
  },
  outro:
    "the naive version checks every pair and costs quadratic time. the map trades a little memory to answer each partner question instantly.",
};

export const MOCK_CODE_LESSONS: MockCodeLesson[] = [
  BINARY_SEARCH,
  REVERSE_LINKED_LIST,
  TWO_SUM,
];

export function findMockCodeLesson(question: string): MockCodeLesson {
  const normalized = question.toLowerCase();
  return (
    MOCK_CODE_LESSONS.find(({ keywords }) =>
      keywords.some((keyword) => normalized.includes(keyword)),
    ) ?? TWO_SUM
  );
}

export function getMockCodeLessonPlan(question: string): CodeLessonPlan {
  const lesson = findMockCodeLesson(question);
  return { ...lesson.plan, question };
}

/**
 * Deterministic [STEP] teaching script for a mock code lesson. Each [TYPE]
 * tag sits immediately after its spoken cue so live sync matches real mode.
 */
export function buildMockCodeLessonTeaching(lesson: MockCodeLesson): string {
  const frames = lesson.plan.diagramHint.steps ?? [];
  const firstFrame = frames[0];
  const laterFrames = frames.slice(1);
  const steps: string[] = [
    `[STEP]\n${lesson.intro}${firstFrame ? `\n[FOCUS:${firstFrame.id}|spotlight]` : ""}\n[/STEP]`,
  ];
  const totalBlocks = lesson.plan.sections.reduce(
    (count, section) => count + section.blocks.length,
    0,
  );
  let typed = 0;
  let nextFrame = 0;
  for (const section of lesson.plan.sections) {
    const sectionIntro = lesson.sectionIntros[section.id];
    if (sectionIntro) {
      const frame = laterFrames[nextFrame];
      if (frame) nextFrame += 1;
      steps.push(
        `[STEP]\n${sectionIntro}${frame ? `\n[FOCUS:${frame.id}|spotlight]` : ""}\n[/STEP]`,
      );
    }
    for (const block of section.blocks) {
      typed += 1;
      const midBeat =
        laterFrames[nextFrame] &&
        totalBlocks > 1 &&
        typed === Math.ceil(totalBlocks / 2);
      if (midBeat) {
        const frame = laterFrames[nextFrame]!;
        nextFrame += 1;
        steps.push(
          `[STEP]\n${frame.caption ?? "watch the same example after that move."}\n[FOCUS:${frame.id}|spotlight]\n[/STEP]`,
        );
      }
      const narration = lesson.narrations[block.id] ?? `next, this part.`;
      steps.push(`[STEP]\n${narration}\n[TYPE:${block.id}]\n[/STEP]`);
    }
  }
  while (nextFrame < laterFrames.length) {
    const frame = laterFrames[nextFrame]!;
    nextFrame += 1;
    steps.push(
      `[STEP]\n${frame.caption ?? "here is the example after the next move."}\n[FOCUS:${frame.id}|spotlight]\n[/STEP]`,
    );
  }
  steps.push(`[STEP]\n${lesson.outro}\n[/STEP]`);
  return steps.join("\n");
}

export function getMockCodeLessonTeaching(question: string): string {
  return buildMockCodeLessonTeaching(findMockCodeLesson(question));
}
