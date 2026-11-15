import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import {
  compileSceneDocument,
  synthesizeFamilyScene,
  tierForForeignDocument,
  validateSceneDocument,
} from "@heytutor/scene-engine";
import {
  selectVerifiedRepresentation,
  type RepresentationSelectionInput,
} from "../../features/tutor-session/lib/scene/representationFallback";
import { evaluationSuppressesSelectedSource } from "../lecture-lab/diagramEval";
import { runLecture } from "../lecture-lab/lecturePipeline";

// Synthetic fixture using the existing solid_projection operators; no student
// questions, model calls, planner prompts or engine contracts are modified.
const question = "A solid consists of a cylinder of radius 3 cm and height 8 cm, topped by a cone of height 4 cm. Find its volume and total exposed surface area, including the bottom.";
const source = synthesizeFamilyScene({ question, families: ["solid_figure"] });
assert(source, "existing source-bound composite fixture must be supported");
const normalized = validateSceneDocument({ ...source.document, annotations: [] });
assert(normalized.document, "planner fixture must normalize without losing the supported solid calls");
const plannerDocument = normalized.document;
const compiled = compileSceneDocument(plannerDocument);
assert(compiled.ok && compiled.renderScene && compiled.report.valid);
assert.equal(tierForForeignDocument(plannerDocument).tier, "qualitative_verified");
assert.equal(plannerDocument.constructions.filter((call) => call.operator === "solid_projection").length, 2);
assert(compiled.renderScene.primitives.some((primitive) =>
  (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text?.trim()),
"planner candidate must carry readable, verified ink");

const input: RepresentationSelectionInput = {
  question,
  families: ["solid_figure"],
  exact: { sceneDocument: plannerDocument, renderScene: compiled.renderScene, validationReport: compiled.report },
};

// The existing default preference is a deliberate policy and must not change.
const defaultSelection = selectVerifiedRepresentation(input);
assert.equal(defaultSelection.figureSource, "family");
assert.equal(defaultSelection.family, "solid_figure");
assert.deepEqual(defaultSelection.renderScene, source.renderScene);
assert(evaluationSuppressesSelectedSource("planner_examples_strict", defaultSelection.figureSource),
  "current strict policy removes the substituted hand-built source despite a usable planner candidate");

// A named input allows this test to compile before the optional selector input
// is implemented. It tests its desired outcome, not a missing-export error.
const strictInput: RepresentationSelectionInput & { preferPlanner: true } = { ...input, preferPlanner: true };
const strictSelection = selectVerifiedRepresentation(strictInput);
assert.equal(strictSelection.figureSource, "planner", "strict preference must retain an admissible planner scene before choosing a forbidden fallback");
assert.equal(strictSelection.tier, "qualitative_verified", "strict preference cannot upgrade an existence-only proof to exact");
assert.deepEqual(strictSelection.renderScene, compiled.renderScene);
assert.equal(strictSelection.validationReport.valid, true);
assert.equal(strictSelection.sceneDocument.source.question, question);
assert(!evaluationSuppressesSelectedSource("planner_examples_strict", strictSelection.figureSource));

console.log("strict planner selection: admissible qualitative composite survives; default source preference is unchanged");

// Check the two policy call sites, rather than unrelated uses of classification
// (for example the block-flow eligibility gate). The bare DSA lesson below
// correctly draws no scene, so ink equality alone cannot prove final admission.
const pipeline = ts.createSourceFile("lecturePipeline.ts",
  readFileSync(resolve(process.cwd(), "scripts/lecture-lab/lecturePipeline.ts"), "utf8"),
  ts.ScriptTarget.Latest, true);
const policyBindings = new Set(["pickerDecision", "diagramStrategy"]);
function verifyPolicyBinding(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && policyBindings.has(node.name.text)) {
    const call = node.initializer;
    assert(call && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "labStrategyDecision");
    const context = call.arguments[1];
    assert(context && ts.isObjectLiteralExpression(context));
    const dsa = context.properties.find((property) => ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) && property.name.text === "dsa");
    assert(dsa && ts.isPropertyAssignment(dsa));
    const value = dsa.initializer;
    assert(ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression) &&
      value.expression.text === "dsaClassification" && value.name.text === "isDsa",
    `${node.name.text} must pass the real DSA classification to shared production policy`);
    policyBindings.delete(node.name.text);
  }
  ts.forEachChild(node, verifyPolicyBinding);
}
verifyPolicyBinding(pipeline);
assert.deepEqual([...policyBindings], [], "both picker and final-selection policy calls must be checked");

async function verifyDsaExemption(): Promise<void> {
  const dsaQuestion = "Explain binary search.";
  const nativeFetch = globalThis.fetch;
  const plan = { ...createFallbackTurnPlanV3(dsaQuestion), visualRequirement: "required" as const, subject: "other" };
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify(plan) } }] });
  try {
    const options = { productionStrictSubjects: ["other"] as const, origin: "http://synthetic", cookie: "", figureOnly: true, scenePlannerDeadlineMs: 1000,
      visualNeedReplay: { decision: "required" as const, source: "jev" as const, unavailableReason: null,
        usage: null, provenance: null } };
    const current = await runLecture(dsaQuestion, { ...options, arm: "current" });
    const strict = await runLecture(dsaQuestion, { ...options, arm: "planner_examples_strict" });
    assert.equal(strict.isDsa, true);
    assert.equal(strict.examplePicker, undefined, "DSA exemption must prevent the strict lab picker even with an empty library");
    assert.equal(strict.diagram.figureSource, current.diagram.figureSource, "DSA strict assignment keeps current source admission");
    assert.deepEqual(strict.diagram.labels, current.diagram.labels);
    assert.equal(strict.turnPlanStatus, "planned", "exercise the accepted-plan policy path");
    assert.deepEqual(strict.productionStrategy, { classifiedSubject: "other", strategy: "current" },
      "the picker must apply the DSA exemption even when its accepted subject is assigned strict");
    assert.equal(strict.diagram.suppressedFallback, null,
      "final selection must not suppress the current DSA source under strict policy");
  } finally { globalThis.fetch = nativeFetch; }
  console.log("strict lab DSA exemption: no example picker and current source admission pass (mocked, zero model calls)");
}
void verifyDsaExemption().catch((error) => { console.error(error); process.exitCode = 1; });
