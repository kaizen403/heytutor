import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
async function main() {
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
