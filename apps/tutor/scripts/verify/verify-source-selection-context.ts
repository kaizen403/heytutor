import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  compileSceneDocument,
  validateProblemIR,
  type ProblemIR,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

const fixturePath = process.env.W2_INTERNAL_SOURCE_FIXTURE ??
  "/Users/kaizen/heytutor-claude-coord/integration/w2-section-run8-internal.json";
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  question: string;
  plan: TurnPlanV3;
  problem: ProblemIR;
  doc: SceneDocument;
  scene: {
    document: SceneDocument;
    renderScene: NonNullable<ReturnType<typeof compileSceneDocument>["renderScene"]>;
    validationReport: NonNullable<ReturnType<typeof compileSceneDocument>["report"]>;
    tier: string;
  };
};

assert.equal(fixture.question, "Find the point P which divides the line segment joining A(2,-1) and B(8,5) internally in the ratio 1:2.");
assert.equal(fixture.plan.question, fixture.question);
const checkedProblem = validateProblemIR(fixture.problem, fixture.question);
assert(checkedProblem.valid && checkedProblem.problem, "run8 fixture contains the actual complete, validated ProblemIR");
assert.equal(fixture.scene.tier, "exact_verified");
assert.equal(fixture.scene.document.source.archetype, undefined, "run8 source figure has no archetype marker");

function candidate(document: SceneDocument) {
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene && compiled.report.valid, "candidate fixture compiles before caller-context checks");
  return { sceneDocument: document, renderScene: compiled.renderScene, validationReport: compiled.report };
}

const actualSource = selectVerifiedRepresentation({
  question: fixture.question,
  turnPlan: fixture.plan,
  problemIR: checkedProblem.problem,
  exact: {
    sceneDocument: fixture.scene.document,
    renderScene: fixture.scene.renderScene,
    validationReport: fixture.scene.validationReport,
  },
});
assert.equal(actualSource.tier, "exact_verified");
assert.equal(actualSource.sceneDocument.source.sectionFormula, "stated-endpoints/v1");
assert(actualSource.sceneDocument.annotations.some((annotation) => annotation.text === "P=(4,1)"));

const qualitativeDocument = structuredClone(fixture.doc);
qualitativeDocument.assertions = [];
const qualitative = candidate(qualitativeDocument);
const sourceWins = selectVerifiedRepresentation({
  question: fixture.question,
  turnPlan: fixture.plan,
  problemIR: checkedProblem.problem,
  exact: qualitative,
});
assert.equal(sourceWins.tier, "exact_verified", "the source's earned metric proof outranks a qualitative planner document");
assert.equal(sourceWins.sceneDocument.source.sectionFormula, "stated-endpoints/v1");

const wrongCaption = structuredClone(qualitativeDocument);
wrongCaption.annotations.find((annotation) => annotation.targetIds.includes("pt_P"))!.text = "P=(44,1)";
const captionCandidate = {
  ...qualitative,
  sceneDocument: wrongCaption,
};
const repaired = selectVerifiedRepresentation({
  question: fixture.question,
  turnPlan: fixture.plan,
  problemIR: checkedProblem.problem,
  exact: captionCandidate,
});
assert.equal(repaired.tier, "exact_verified", "a mismatched planner caption cannot displace the source-verified figure");
assert(repaired.sceneDocument.annotations.some((annotation) => annotation.text === "P=(4,1)"));

const stalePlan = structuredClone(fixture.plan);
stalePlan.derived.find((quantity) => quantity.symbol === "x_P")!.value += 100;
const stale = selectVerifiedRepresentation({ question: fixture.question, turnPlan: stalePlan, problemIR: checkedProblem.problem, exact: qualitative });
assert.equal(stale.sceneDocument.visualDecision.mode, "text_only", "stale plan values cannot accompany section ink");

const wrongUnitPlan = structuredClone(fixture.plan);
wrongUnitPlan.givens.find((quantity) => quantity.symbol === "x_A")!.unit = "m";
const wrongUnit = selectVerifiedRepresentation({ question: fixture.question, turnPlan: wrongUnitPlan, problemIR: checkedProblem.problem, exact: qualitative });
assert.equal(wrongUnit.sceneDocument.visualDecision.mode, "text_only", "coordinate dimensions reject a physical length unit");

const extraObligation = structuredClone(checkedProblem.problem);
extraObligation.constraints.push({ id: "extra_visual_obligation", kind: "perpendicular", entityIds: ["A", "B"], evidenceFactIds: ["fA"] });
const incomplete = selectVerifiedRepresentation({ question: fixture.question, turnPlan: fixture.plan, problemIR: extraObligation, exact: qualitative });
assert.equal(incomplete.sceneDocument.visualDecision.mode, "text_only", "a source figure cannot discard a fullIR visual obligation");

const withoutIR = selectVerifiedRepresentation({ question: fixture.question, turnPlan: fixture.plan, exact: qualitative });
assert.equal(withoutIR.tier, "exact_verified", "the complete source stem supports the section when the caller has no ProblemIR");
assert(withoutIR.sceneDocument.entities.some((entity) => entity.label === "P=(4,1)"));

console.log("source selection context: actual run8 fullIR, source proof priority, caption mismatch, stale plan, wrong unit, extra fullIR obligation and no-IR source passed");
