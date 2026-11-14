import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  classifyDsaQuestion,
  getMockCodeLessonPlan,
  planCodeLessonV1,
} from "@heytutor/tutor-core";
import {
  canonicalizeTurnSceneMetadata,
  type SubmittedTurnSceneMetadata,
} from "../../lib/scene/turnScenePersistence";
import {
  parseStoredCodeLesson,
  storedCodeLessonPlan,
} from "../../lib/code-lesson/persistedCodeLesson";

// Synthetic minimization of a social-studies lecture: the two load-bearing
// tokens were "Example:" and "target", neither of which asks for programming.
const lecture =
  "Sustainable development lecture. Example: A factory creates jobs but pollutes the river. Taxpayers are the target market of public projects. Explain all lectures.";

async function verifyComputationalAdmissions() {
  const corpusQuestions: string[] = [];
  const corpusRoot = new URL("../../../../data/leetcode-probes/", import.meta.url);
  for (const file of readdirSync(corpusRoot).filter(file => file.endsWith(".json"))) {
    const corpus: unknown = JSON.parse(readFileSync(new URL(file, corpusRoot), "utf8"));
    assert(corpus && typeof corpus === "object" && "questions" in corpus && Array.isArray(corpus.questions));
    for (const item of corpus.questions) {
      assert(item && typeof item === "object" && "question" in item && typeof item.question === "string");
      corpusQuestions.push(item.question);
    }
  }
  assert(corpusQuestions.length > 0, "the existing coding corpus must be present");
  const questions = [
    ...corpusQuestions,
    "Given a string s, return s with all vowels removed. Constraints: 1 <= s.length <= 1000.",
    "Given an array readings, return readings after removing negative entries. Constraints: 1 <= readings.length <= 1000.",
    "Given a string text, return it without spaces. Constraints: 1 <= text.length <= 1000.",
    "Given two strings left and right, return their combined characters. Constraints: 1 <= left.length <= 1000.",
    "Given an integer n, compute its digit count. Constraints: 1 <= n <= 1000.",
    "Given a list values, remove duplicate entries. Constraints: 1 <= values.length <= 1000.",
    "Given a string payload, return payload.",
    "Given a string message, return it unchanged.",
    "Given an integer value, calculate its digit count.",
    "Given a string word return word in uppercase",
    "Given string text return it unchanged",
    "Given the head of a singly linked list, reverse the list and return the reversed list.",
    "Given the head of a doubly linked list, reverse the list and return the reversed list.",
    "Given the root of a binary tree, return its depth.",
    "Given a positive integer n, calculate its digit count. Constraints: 1 <= n <= 1000.",
    "Given an array of integers, find the maximum product of any two elements. Example: [1, 2, 3] gives 6.",
    "Given a non-negative integer n, calculate its digit count.",
    "Given a sorted array of integers, find its largest element.",
    'Given a string measurement = "20 m/s", return measurement.',
    "Given a string measurement = '3 kg', return measurement.",
    "Given a string, remove all vowels.",
    'Given a string "hello", reverse it.',
    "Write a Python function to compute the frequency of a string of length 2 m with wave speed 20 m/s.",
    "Given a string text, remove duplicate characters. Time limit: 1 s.",
    "Given two binary strings a and b, return their sum as a binary string. Example: a = 11, b = 1 gives 100. Constraints: 1 <= a.length <= 1000.",
    "Given a lowercase alphanumeric string text, calculate its character count.",
    "Given an integer array readings, find its maximum product.",
    "Given a rectangular two-dimensional integer matrix values, find its largest element.",
    "Given an array readings, return readings with negative entries removed. Your solution must run within 2 seconds.",
    "Given a string text, return it unchanged. The runtime budget is 500 ms.",
    ...["`value`", "**value**", "*value*", "_value_", "__value__", "$value$"].map(binding =>
      `Given an integer ${binding}, calculate its digit count.`,
    ),
  ];
  const fetchBefore = globalThis.fetch;
  const results = [];
  const nonCoding = [lecture,
    "Given a string of length 2 m carrying a mass of 3 kg, find its tension.",
    "Given two integers 2 and 3, find their sum.",
    "Given a string under tension 20 N, calculate its wave speed.",
    "Given a string **of** length 2 m carrying a mass of 3 kg, find its tension.",
    "Given a string _under_ tension 20 N, calculate its wave speed.",
    "Given a string fixed at both ends with length 2 m and wave speed 20 m/s, find its fundamental frequency.",
    "Given a string carrying a mass of 3 kg and length 2 m, remove the mass and find its frequency.",
    "Given a string that's fixed with length 2 m and mass 3 kg, remove the mass. What's its frequency?",
    "Given a string stretched between two walls, remove the attached mass and describe its motion.",
    "Given a lecture about strings, remove the misconception and explain the topic. Example: target audience.",
  ];
  try {
    for (const question of [...questions, ...nonCoding]) {
      const fixture = getMockCodeLessonPlan(question);
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return Response.json({ choices: [{ message: { content: JSON.stringify(fixture) } }] });
      };
      const planned = await planCodeLessonV1(question, {
        proxyUrl: "https://synthetic.invalid",
        timeoutMs: 1000,
      });
      const restored = parseStoredCodeLesson(
        JSON.parse(JSON.stringify({ codeLesson: fixture })), question,
      );
      results.push({
        classified: classifyDsaQuestion(question).isDsa,
        calls,
        planned: planned !== null,
        restored: restored.status,
      });
    }
  } finally {
    globalThis.fetch = fetchBefore;
  }
  assert.deepEqual(results, [
    ...questions.map(() => ({ classified: true, calls: 1, planned: true, restored: "valid" })),
    ...nonCoding.map(() => ({ classified: false, calls: 0, planned: false, restored: "invalid" })),
  ], "computational instructions must reach classification, real planning and restore; lecture prose must not");
}

async function main() {
  await verifyComputationalAdmissions();
  assert.equal(
    classifyDsaQuestion(lecture).isDsa,
    false,
    "lecture examples and target market cannot authorize a Python lesson",
  );
  for (const question of [
    "Example: Explain how the root of inequality affects society.",
    "Given a triangle, find its area. Example: base 4 and height 3.",
    "Explain why we queue at a hospital. Example: a long queue.",
  ])
    assert.equal(classifyDsaQuestion(question).isDsa, false, question);
  for (const question of [
    "Explain binary search",
    "Write a Python program to assess sustainable development",
    "Given an array nums and an integer target, return the indices of two numbers that add to target.",
    "Input: nums = [1, 2] Output: 3",
    "Explain a linked list without code",
  ])
    assert.equal(classifyDsaQuestion(question).isDsa, true, question);

  const spurious = getMockCodeLessonPlan(lecture);
  assert.equal(
    parseStoredCodeLesson({ codeLesson: spurious }, lecture).status,
    "invalid",
    "schema-valid code is not source intent",
  );
  assert.equal(
    storedCodeLessonPlan({ codeLesson: spurious }),
    null,
    "restore cannot invent coding intent from a saved plan",
  );
  assert.equal(
    storedCodeLessonPlan(
      { codeLesson: getMockCodeLessonPlan("Explain binary search") },
      lecture,
    ),
    null,
    "a copied coding plan cannot override the stored source question",
  );
  const fetchBefore = globalThis.fetch;
  let plannerCalls = 0;
  try {
    globalThis.fetch = async () => {
      plannerCalls++;
      throw new Error("non-coding planner request");
    };
    assert.equal(
      await planCodeLessonV1(lecture, {
        proxyUrl: "https://synthetic.invalid",
        timeoutMs: 1000,
      }),
      null,
    );
    assert.equal(
      plannerCalls,
      0,
      "non-coding requests cannot dispatch code planning or repair",
    );
  } finally {
    globalThis.fetch = fetchBefore;
  }
  const question = "Explain binary search";
  const text = await canonicalizeTurnSceneMetadata({
    question,
    visualStatus: "text_only",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3",
      codeLesson: getMockCodeLessonPlan(question),
      figureSource: "dsa_trace",
    },
    segments: [],
  });
  assert(text.ok);
  assert.equal(
    text.value.sceneArtifacts?.figureSource,
    "text_only",
    "a lost scene cannot keep a rendered DSA provenance claim",
  );
  assert(
    storedCodeLessonPlan(text.value.sceneArtifacts),
    "real code without a diagram still reopens its code panel",
  );

  // Optional private replay: never copy the source, identities or payload to
  // the repo or stdout. The original stored case must be refused at admission
  // and restore, rather than promoted from text_only to verified geometry.
  const path = process.argv[2];
  if (path) {
    const stored: SubmittedTurnSceneMetadata = JSON.parse(
      readFileSync(path, "utf8"),
    );
    assert.equal(classifyDsaQuestion(stored.question).isDsa, false);
    assert.equal(storedCodeLessonPlan(stored.sceneArtifacts), null);
    const result = await canonicalizeTurnSceneMetadata(stored);
    assert(!result.ok && result.code === "scene_code_lesson_invalid");
    console.log(
      "private stored source replay passed: standard lesson; no restored code or geometry authority",
    );
  }
  console.log("lesson source routing verification passed");
}
void main();
