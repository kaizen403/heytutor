/**
 * Lesson figures, plan side (DIAGRAM_LESSON_FIGURES, lane 4).
 *
 * Mutations this gate catches (brief lane 4 table):
 * (a) allow digits: lessonFigureAsksOf keeps an ask with a digit;
 * (b) skip the same-figure reject in planLessonFigures;
 * (c) append the planner addon unconditionally (turnPlannerV3.ts; rebuild
 *     tutor-core, this gate reads its dist).
 */
import assert from "node:assert/strict";
import {
  TURN_PLAN_V3_LESSON_FIGURES_ADDON,
  TURN_PLAN_V3_PROMPT,
  auditTurnPlanV3,
  planTurnV3,
  withChemistryExampleAddon,
  type TurnPlannerV3Options,
} from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import {
  composeLessonFigureQuestion,
  isLessonFigureAdvanceId,
  lessonFigureAsksOf,
  lessonFiguresOf,
  resolveLessonFiguresEnabled,
} from "../../lib/boards/lessonFigures";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const asks = (figures: unknown) => lessonFigureAsksOf({ schemaVersion: "turn-plan/v3", figures });

async function askChecks(): Promise<void> {
  await check("asks/well-formed", () => {
    assert.deepEqual(asks([{ id: "figure_2", ask: " velocity time graph of the block " }]), [{ id: "figure_2", ask: "velocity time graph of the block" }]);
    assert.deepEqual(asks([{ id: "figure_2", ask: "free body diagram" }, { id: "figure_3", ask: "velocity time graph" }]).map((entry) => entry.id), ["figure_2", "figure_3"]);
  });
  await check("asks/absent-or-not-a-list", () => {
    assert.deepEqual(lessonFigureAsksOf({}), []);
    assert.deepEqual(lessonFigureAsksOf(null), []);
    assert.deepEqual(asks({ id: "figure_2", ask: "free body diagram" }), []);
    assert.deepEqual(asks([]), []);
  });
  await check("asks/digit-drops-the-list", () => {
    assert.deepEqual(asks([{ id: "figure_2", ask: "free body diagram" }, { id: "figure_3", ask: "graph for 5 seconds" }]), [], "a digit in any ask drops the whole list");
    assert.deepEqual(asks([{ id: "figure_2", ask: "graph up to ٣ seconds" }]), [], "any script's digit");
    assert.deepEqual(asks([{ id: "figure_2", ask: "graph for two seconds" }]), [], "a number word");
  });
  await check("asks/three-entries", () => {
    assert.deepEqual(asks([
      { id: "figure_2", ask: "free body diagram" }, { id: "figure_3", ask: "velocity time graph" }, { id: "figure_3", ask: "energy bar chart" },
    ]), []);
  });
  await check("asks/duplicate-id", () => {
    assert.deepEqual(asks([{ id: "figure_2", ask: "free body diagram" }, { id: "figure_2", ask: "velocity time graph" }]), []);
  });
  await check("asks/id-outside", () => {
    for (const id of ["figure_1", "figure_4", "Figure_2", "figure_2 ", 2, null]) {
      assert.deepEqual(asks([{ id, ask: "free body diagram" }]), [], `id ${JSON.stringify(id)}`);
    }
    assert.deepEqual(asks([{ id: "figure_3", ask: "velocity time graph" }, { id: "figure_2", ask: "free body diagram" }]), [], "ids ascend");
  });
  await check("asks/shape", () => {
    for (const ask of ["ab", "x".repeat(81), "graph [FOCUS:x]", "graph: velocity", "graph\nnext", 7, null]) {
      assert.deepEqual(asks([{ id: "figure_2", ask }]), [], `ask ${JSON.stringify(ask)}`);
    }
    assert.equal(asks([{ id: "figure_2", ask: "x".repeat(80) }]).length, 1, "80 characters is allowed");
  });
  await check("ids/advance", () => {
    assert(isLessonFigureAdvanceId("figure_2") && isLessonFigureAdvanceId("figure_3"));
    for (const id of ["figure_1", "figure_4", "figure_2x", " figure_2", "FIGURE_2"]) assert(!isLessonFigureAdvanceId(id), id);
  });
  await check("compose", () => {
    assert.equal(composeLessonFigureQuestion("  A block slides.  ", " velocity time graph "), "A block slides.\n\nFigure: velocity time graph");
  });
  await check("flag", () => {
    assert.equal(resolveLessonFiguresEnabled({}), false);
    assert.equal(resolveLessonFiguresEnabled({ DIAGRAM_LESSON_FIGURES: "1" }), false);
    assert.equal(resolveLessonFiguresEnabled({ DIAGRAM_LESSON_FIGURES: "on" }), true);
  });
  await check("artifact/validated-whole", () => {
    const figure = { id: "figure_2", ask: "velocity time graph", sceneDocument: { schemaVersion: "scene-document/v2" }, tier: "qualitative_verified", family: "graph", figureSource: "fast_family" };
    const artifact = (figures: unknown[]) => lessonFiguresOf({ lessonFigures: { schemaVersion: "lesson-figures/v1", figures } });
    assert.equal(artifact([figure])?.figures.length, 1);
    assert.equal(artifact([]), null, "an empty list is no artifact");
    assert.equal(artifact([{ ...figure, ask: "graph for 5 s" }]), null);
    assert.equal(artifact([figure, { ...figure, id: "figure_3" }, { ...figure, id: "figure_3" }]), null);
    assert.equal(artifact([{ ...figure, figureSource: "planner" }]), null);
    assert.equal(artifact([{ ...figure, tier: "drawn" }]), null);
    assert.equal(lessonFiguresOf({ lessonFigures: { schemaVersion: "lesson-figures/v2", figures: [figure] } }), null);
  });
}

/** Every system prompt the planner sends, with fetch answering 503. */
async function systemPrompts(run: () => Promise<unknown>): Promise<string[]> {
  const original = globalThis.fetch;
  const prompts: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
    prompts.push(body.messages?.find((message) => message.role === "system")?.content ?? "");
    return new Response("{}", { status: 503 });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return prompts;
}

async function promptChecks(): Promise<void> {
  const base: TurnPlannerV3Options = { proxyUrl: "http://planner.invalid/api/chat", timeoutMs: 2000 };
  for (const question of ["A 2 kg block slides down a 30 degree incline. Find its acceleration.", "Explain the SN2 mechanism."]) {
    for (const classifySubject of [false, true]) {
      const label = `${question.slice(0, 12)}/${classifySubject ? "subject" : "plain"}`;
      const absent = await systemPrompts(() => planTurnV3(question, { ...base, classifySubject }));
      const off = await systemPrompts(() => planTurnV3(question, { ...base, classifySubject, lessonFigures: false }));
      const on = await systemPrompts(() => planTurnV3(question, { ...base, classifySubject, lessonFigures: true }));
      await check(`prompt/${label}/absent-equals-fixture`, () => {
        assert(absent.length >= 2, "both plan lanes ran");
        const fixture = withChemistryExampleAddon(TURN_PLAN_V3_PROMPT, question);
        assert(absent.some((prompt) => prompt === fixture || prompt.startsWith(`${fixture}\n\nAlso return a top-level subject`)), "the primary lane's bytes are withChemistryExampleAddon's output");
        for (const prompt of absent) assert(!prompt.includes("LESSON FIGURES"), "no addon when absent");
      });
      await check(`prompt/${label}/off-equals-absent`, () => assert.deepEqual(off, absent));
      await check(`prompt/${label}/on-appends-addon`, () => {
        assert.equal(on.length, absent.length);
        on.forEach((prompt, index) => {
          const plain = absent[index]!;
          const subjectAt = plain.indexOf("\n\nAlso return a top-level subject");
          const expected = subjectAt >= 0
            ? `${plain.slice(0, subjectAt)}\n\n${TURN_PLAN_V3_LESSON_FIGURES_ADDON}${plain.slice(subjectAt)}`
            : `${plain}\n\n${TURN_PLAN_V3_LESSON_FIGURES_ADDON}`;
          assert.equal(prompt, expected, `lane ${index} gains exactly the addon`);
        });
      });
    }
  }
  await check("prompt/audit-never", async () => {
    const plan = { schemaVersion: "turn-plan/v3", question: "q" } as unknown as TurnPlanV3;
    const off = await systemPrompts(() => auditTurnPlanV3("q", plan, base));
    const on = await systemPrompts(() => auditTurnPlanV3("q", plan, { ...base, lessonFigures: true }));
    assert.deepEqual(on, off, "the audit call keeps its bytes");
  });
  await check("prompt/addon-size", () => {
    assert(TURN_PLAN_V3_LESSON_FIGURES_ADDON.length < 600, `addon is ${TURN_PLAN_V3_LESSON_FIGURES_ADDON.length} characters`);
    assert(!TURN_PLAN_V3_LESSON_FIGURES_ADDON.includes("[FOCUS"), "the plan addon names no teaching cue");
  });
}

async function main(): Promise<void> {
  await askChecks();
  await promptChecks();
  console.log(`verify-lesson-figures-plan: ${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
