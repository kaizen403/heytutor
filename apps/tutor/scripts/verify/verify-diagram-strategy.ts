import assert from "node:assert/strict";
import {
  decideDiagramStrategy,
  diagramStrategyAllowsFigureSource,
  evaluationDiagramStrategyDecision,
  liveDiagramStrategyDecision,
  type DiagramStrategyContext,
} from "../../features/tutor-session/lib/scene/diagramStrategy";
import { resolveDiagramStrategyAssignment, resolveDiagramStrictSubjects } from "../../lib/scene/diagramStrategy.server";
import {
  filterLiveDiagramExamples,
  injectLiveDiagramExamples,
  type LiveDiagramExample,
} from "../../lib/scene/diagramExampleLibrary.server";

const fixtures: Array<{ name: string; context: DiagramStrategyContext }> = [
  {
    name: "physics",
    context: { chemistryLane: false, codeLesson: false, dsa: false, doubt: false },
  },
  {
    name: "maths",
    context: { chemistryLane: false, codeLesson: false, dsa: false, doubt: false },
  },
  {
    name: "chemistry",
    context: { chemistryLane: true, codeLesson: false, dsa: false, doubt: false },
  },
  {
    name: "code lesson",
    context: { chemistryLane: false, codeLesson: true, dsa: false, doubt: false },
  },
  {
    name: "DSA",
    context: { chemistryLane: false, codeLesson: true, dsa: true, doubt: false },
  },
  {
    name: "doubt",
    context: { chemistryLane: false, codeLesson: false, dsa: false, doubt: true },
  },
];

assert.deepEqual(resolveDiagramStrictSubjects("maths,maths nonsense"), ["maths"]);
assert.deepEqual(resolveDiagramStrictSubjects(""), []);

for (const fixture of fixtures) {
  const current = decideDiagramStrategy({ assignedStrategy: "current", ...fixture.context });
  assert.equal(current.strategy, "current", `${fixture.name}: switch-off must preserve current`);
  assert.equal(current.selectionOrder, "current", `${fixture.name}: switch-off order`);
  assert.equal(current.usePickedExamples, false, `${fixture.name}: switch-off examples`);
  assert.equal(diagramStrategyAllowsFigureSource(current, "fast_family"), true);
  assert.deepEqual(
    liveDiagramStrategyDecision({ assignedStrategy: "strict", ...fixture.context }),
    evaluationDiagramStrategyDecision("planner_examples_strict", fixture.context),
    `${fixture.name}: live and lab decisions must be identical`,
  );
}

const strict = decideDiagramStrategy({
  assignedStrategy: "strict",
  chemistryLane: false,
  codeLesson: false,
  dsa: false,
  doubt: false,
});
for (const subject of ["maths", "physics", "chemistry", "other"] as const) {
  const scoped = decideDiagramStrategy({
    assignedStrategy: "current",
    subject,
    strictSubjects: ["maths"],
    chemistryLane: subject === "chemistry",
    codeLesson: false,
    dsa: false,
    doubt: false,
  });
  assert.equal(scoped.strategy, subject === "maths" ? "strict" : "current", `${subject}: maths-only switch`);
  assert.equal(scoped.selectionOrder, subject === "maths" ? "planner_first" : "current");
  assert.equal(scoped.usePickedExamples, subject === "maths");
  for (const exempt of ["doubt", "codeLesson", "dsa"] as const) {
    assert.equal(decideDiagramStrategy({ ...scoped, [exempt]: true }).strategy, "current");
  }
  assert.equal(decideDiagramStrategy({ ...scoped, strictSubjects: [] }).strategy, "current", "empty scope preserves main");
}
assert.equal(strict.strategy, "strict");
assert.equal(strict.selectionOrder, "planner_first");
assert.equal(strict.usePickedExamples, true);
assert.equal(diagramStrategyAllowsFigureSource(strict, "planner"), true);
assert.equal(diagramStrategyAllowsFigureSource(strict, "verified_recovery"), true);
assert.equal(diagramStrategyAllowsFigureSource(strict, "fast_family"), false);
assert.equal(diagramStrategyAllowsFigureSource(strict, "last_resort"), false);
assert.equal(diagramStrategyAllowsFigureSource(strict, "source_grounded"), false);

for (const fixture of fixtures.filter(({ name }) => !["physics", "maths"].includes(name))) {
  const decision = decideDiagramStrategy({ assignedStrategy: "strict", ...fixture.context });
  assert.equal(decision.strategy, "current", `${fixture.name}: strict is exempt`);
}

console.log("diagram strategy verification passed");

assert.equal(resolveDiagramStrategyAssignment({ userId: "student-1", email: null }, {
  percent: undefined,
  allowlist: undefined,
}), "current", "rollout defaults off");
assert.equal(resolveDiagramStrategyAssignment({ userId: "student-1", email: null }, {
  percent: "100",
  allowlist: "",
}), "strict", "100 percent assigns strict");
assert.equal(resolveDiagramStrategyAssignment({ userId: "staff-id", email: null }, {
  percent: "0",
  allowlist: "staff-id,staff@example.com",
}), "strict", "id allowlist overrides percentage");
assert.equal(resolveDiagramStrategyAssignment({ userId: "someone", email: " STAFF@EXAMPLE.COM " }, {
  percent: "0",
  allowlist: "staff-id,staff@example.com",
}), "strict", "email allowlist is normalized");
assert.equal(resolveDiagramStrategyAssignment({ userId: "stable-user", email: null }, {
  percent: "37.5",
  allowlist: "",
}), resolveDiagramStrategyAssignment({ userId: "stable-user", email: null }, {
  percent: "37.5",
  allowlist: "",
}), "assignment is stable");

const exampleDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "text_only", reason: "fixture" },
};
const examples: LiveDiagramExample[] = [
  {
    id: "curated:eval-leak",
    sourceKind: "curated",
    question: "Draw a projectile launched at 30 degrees",
    depicts: "projectile trajectory",
    figureKind: "motion_path",
    family: "projectile",
    archetype: "projectile",
    document: exampleDocument,
  },
  {
    id: "synthesized:projectile",
    sourceKind: "synthesized",
    question: null,
    depicts: "projectile trajectory",
    figureKind: "motion_path",
    family: "projectile",
    archetype: "projectile",
    document: exampleDocument,
  },
];
assert.deepEqual(
  filterLiveDiagramExamples(examples, "Draw a projectile launched at 30 degrees", [
    "curated:eval-leak",
    "synthesized:projectile",
    "unknown",
  ]).map((example) => example.id),
  ["synthesized:projectile"],
  "the live server filters a current/eval-row duplicate and unknown ids",
);
const injected = injectLiveDiagramExamples(
  JSON.stringify({ messages: [{ role: "user", content: "ORIGINAL PROMPT" }] }),
  filterLiveDiagramExamples(examples, "A different projectile problem", ["synthesized:projectile"]),
);
assert.match(injected, /ORIGINAL PROMPT/);
assert.match(injected, /WORKED SCENE EXAMPLES/);
assert.match(injected, /scene-document\/v2/);
