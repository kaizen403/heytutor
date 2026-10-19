import assert from "node:assert/strict";
import { compileSceneDocument, type SceneDocument, type RenderScene } from "@heytutor/scene-engine";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import {
  selectProductionScene,
  validateProductionSceneCandidate,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

// Session-owned regression gate: a complete source reader is a fallback, even
// when it can compile a different presentation of a valid planner's answer.
// These authored planner programs deliberately use equivalent algebra, their
// own display windows and operator-owned label layouts rather than copying
// reader output. Linear annotations cannot manufacture alternate label ink.
interface PlannerCase {
  id: string;
  question: string;
  operator: string;
  inputs: Record<string, unknown>;
  invalidInputs: Record<string, unknown>;
}

const cases: PlannerCase[] = [
  {
    id: "number-line",
    question: "Represent -3 < x <= 4 on a number line.",
    operator: "number_line_set",
    inputs: {
      variable: "x",
      expression: { intersection: [{ inequality: "2x > -6" }, { inequality: "8 >= 2x" }] },
      view: { xMin: -6, xMax: 8, yMin: -4, yMax: 4 },
    },
    invalidInputs: { variable: "x", expression: { inequality: "x >= 99" } },
  },
  {
    id: "half-plane",
    question: "Shade the half-plane 3x - 2y >= 6.",
    operator: "linear_half_plane",
    inputs: {
      variables: ["x", "y"], inequality: "-6x + 4y <= -12",
      view: { xMin: -2, xMax: 8, yMin: -8, yMax: 2 },
    },
    invalidInputs: { variables: ["x", "y"], inequality: "3x - 2y <= 6" },
  },
  {
    id: "feasible-region",
    question: "Graph the feasible region x >= 0, y >= 0 and 2x + y <= 10.",
    operator: "linear_feasible_region",
    inputs: {
      variables: ["x", "y"], constraints: ["10 >= y + 2x", "-y <= 0", "-x <= 0"],
      view: { xMin: -2, xMax: 9, yMin: -2, yMax: 13 },
    },
    invalidInputs: { variables: ["x", "y"], constraints: ["x >= 0", "y >= 0", "2x + y <= 99"] },
  },
  {
    id: "intersection",
    question: "Graph 2x + y = 7 and x - y = 2 and find their intersection.",
    operator: "linear_system",
    inputs: {
      variables: ["x", "y"], equations: ["2x - 2y = 4", "4x + 2y = 14"],
      view: { xMin: -4, xMax: 8, yMin: -3, yMax: 9 },
    },
    invalidInputs: { variables: ["x", "y"], equations: ["2x + y = 99", "x - y = 2"] },
  },
  {
    id: "system",
    question: "Solve x + 2y = 7 and 2x - y = 4 graphically.",
    operator: "linear_system",
    inputs: {
      variables: ["x", "y"], equations: ["4x - 2y = 8", "-x - 2y = -7"],
      view: { xMin: -5, xMax: 9, yMin: -4, yMax: 8 },
    },
    invalidInputs: { variables: ["x", "y"], equations: ["x + 2y = 7", "2x - y = 99"] },
  },
];

function plannerDocument(test: PlannerCase): SceneDocument {
  const entityId = `planner_${test.id}`;
  const groupId = `${entityId}_group`;
  return {
    schemaVersion: "scene-document/v2",
    source: { question: test.question },
    visualDecision: { mode: "scene", reason: "A source-equivalent planner graphical solution." },
    quantities: [],
    entities: [{ id: entityId, kind: "linear_region", role: "solution" }],
    constructions: [{ id: `${entityId}_construct`, operator: test.operator, inputs: test.inputs, outputs: [entityId] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: [entityId],
    revealGroups: [{ id: groupId, entityIds: [entityId], dependsOn: [], narrationCue: "Show the verified solution." }],
    teachingTimeline: [{ id: `${entityId}_reveal`, action: "reveal", targetId: groupId,
      dependsOn: [], narrationIntent: "Explain the verified source-equivalent solution." }],
  };
}

const presentation = (scene: RenderScene) => scene.primitives.map(({ kind, points, text }) => ({ kind, points, text }));
const failures: string[] = [];
let checks = 0;
function verify(name: string, run: () => void): void {
  checks++;
  try {
    run();
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const test of cases) {
  const turnPlan = { ...createFallbackTurnPlanV3(test.question), visualRequirement: "required" as const };
  const reader = selectVerifiedRepresentation({ question: test.question, turnPlan });
  assert.equal(reader.figureSource, "linear_source", `${test.id}: the reader must offer a real competing scene`);
  assert(compileSceneDocument(reader.sceneDocument).ok, `${test.id}: reader competitor must compile`);

  const candidate = plannerDocument(test);
  const validation = validateProductionSceneCandidate({
    question: test.question, turnPlan, candidate: candidate as unknown as Record<string, unknown>,
  });
  assert(validation.valid && validation.value, `${test.id}: planner fixture must be independently admissible: ${JSON.stringify(validation.errors)}`);
  const value = validation.value;
  assert(value.renderScene.primitives.some(p => p.kind === "label" && p.text?.trim()),
    `${test.id}: the planner must have readable operator-owned labels`);
  assert.notDeepEqual(presentation(value.renderScene), presentation(reader.renderScene),
    `${test.id}: the competing scenes must differ in geometry or labels, beyond ids/provenance`);
  assert.notDeepEqual(presentation(value.renderScene).filter(p => p.kind === "label"),
    presentation(reader.renderScene).filter(p => p.kind === "label"),
    `${test.id}: the planner must preserve its distinct verified label layout`);
  const exact = { sceneDocument: value.document, renderScene: value.renderScene, validationReport: value.report };

  // Both default and explicit planner preference must preserve the accepted
  // candidate. Provenance alone is insufficient: compare the actual ink too.
  for (const preferPlanner of [undefined, true]) {
    const policyName = preferPlanner ? "explicit" : "default";
    verify(`${test.id}/${policyName}/representation`, () => {
      const selected = selectVerifiedRepresentation({ question: test.question, turnPlan, exact, preferPlanner });
      assert.equal(selected.figureSource, "planner", "a valid planner must win while the reader can draw");
      assert.equal(selected.sceneDocument, value.document, "planner document identity must survive selection");
      assert.deepEqual(selected.renderScene, value.renderScene, "the final ink must be the planner's compiled presentation");
    });
    verify(`${test.id}/${policyName}/production`, () => {
      // Raw candidate exercises production validation and final save admission;
      // do not inject fastRepresentation or mock either selector.
      const production = selectProductionScene({ question: test.question, turnPlan, problemIR: null,
        candidate: candidate as unknown as Record<string, unknown>, policy: { preferPlanner } });
      assert(production.candidateValidation?.valid && production.candidateValidation.value,
        "production must admit the valid planner candidate");
      assert(production.representation, production.reason);
      assert.equal(production.representation.figureSource, "planner", "production must retain planner provenance");
      assert.equal(production.representation.sceneDocument, production.candidateValidation.value.document,
        "production must retain the validated planner document");
      assert.deepEqual(production.representation.renderScene, value.renderScene,
        "production must present planner ink, including its window and label layout");
      assert.equal(production.visualStatus, "validated");
      assert.equal(production.saveFailure, null);
      assert.equal(production.hasReadableInk, true);
    });
  }

  const invalid = structuredClone(candidate);
  invalid.constructions[0]!.inputs = test.invalidInputs;
  const invalidCompile = compileSceneDocument(invalid);
  assert(!invalidCompile.ok && invalidCompile.renderScene === null,
    `${test.id}: the invalid control must reject atomically`);
  assert(invalidCompile.report.issues.some(issue => issue.severity === "fatal" &&
    (issue.code === "linear_source_mismatch" ||
      issue.code === "invalid_linear_region" && /complete equivalent original two-equation program/.test(issue.message))),
    `${test.id}: invalid control must contradict the supported source, not fail for an unrelated reason`);
  verify(`${test.id}/invalid/representation`, () => {
    const selected = selectVerifiedRepresentation({ question: test.question, turnPlan, preferPlanner: true,
      exact: { sceneDocument: invalid, renderScene: value.renderScene, validationReport: invalidCompile.report } });
    assert.equal(selected.figureSource, "linear_source", "invalid planner ink must fall back to the independently compiled reader");
    assert.deepEqual(selected.renderScene, reader.renderScene);
    assert(selected.renderScene.primitives.every(p => !p.entityId.startsWith("planner_")),
      "rejected planner marks must never leak into the fallback");
  });
  verify(`${test.id}/invalid/production`, () => {
    const production = selectProductionScene({ question: test.question, turnPlan, problemIR: null,
      candidate: invalid as unknown as Record<string, unknown>, policy: { preferPlanner: true } });
    assert.equal(production.candidateValidation?.valid, false);
    assert(production.representation, production.reason);
    assert.equal(production.representation.figureSource, "linear_source");
    assert.deepEqual(production.representation.renderScene, reader.renderScene,
      "production fallback must be independently rebuilt without invalid planner marks");
    assert.equal(production.visualStatus, "validated");
    assert.equal(production.saveFailure, null);
  });
}

if (failures.length) {
  failures.forEach(failure => console.error(failure));
  assert.fail(`linear planner first: ${failures.length}/${checks} selection checks failed`);
}
console.log(`linear planner first: ${cases.length} source-equivalent planner variants, ${checks} selection checks passed (default/explicit planner priority and invalid fallback controls)`);
