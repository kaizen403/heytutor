import assert from "node:assert/strict";
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
