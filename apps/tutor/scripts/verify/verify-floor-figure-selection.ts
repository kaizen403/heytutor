/**
 * DIAGRAM_FLOOR_FIGURE through the production selector: off changes nothing;
 * on, a required figure whose planner candidates all failed gets the engine's
 * stated-setup floor figure, which faces save admission and both yield
 * policies; it never draws over a valid planner figure, a solver
 * contradiction, a source veto, or a turn that asks for no figure.
 * Synthetic questions only.
 */
import assert from "node:assert/strict";
import { FIGURE_SOURCES, parseDiagramFloorFigure, type TurnPlanV3 } from "@heytutor/scene-engine";
import { diagramStrategyAllowsFigureSource, liveDiagramStrategyDecision } from "../../features/tutor-session/lib/scene/diagramStrategy";
import {
  selectProductionScene, validateProductionSceneCandidate, type ProductionSceneSelectionInput,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { resolveDiagramFloorFigure } from "../../lib/scene/diagramStrategy.server";

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  assert.ok(condition, message);
}

const strict = liveDiagramStrategyDecision({ assignedStrategy: "current", subject: "physics", strictSubjects: ["maths", "physics"],
  chemistryLane: false, codeLesson: false, dsa: false, doubt: false });
check(strict.strategy === "strict", "physics runs strict");
const policy = { preferPlanner: true, allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(strict, source)) };
check(policy.allowedFigureSources.includes("floor"), "strict admits the floor source; the flag gates it");
check(!policy.allowedFigureSources.includes("archetype") && !policy.allowedFigureSources.includes("family"), "strict still suppresses archetype and family figures");

check(parseDiagramFloorFigure("on") && parseDiagramFloorFigure(" ON ") && !parseDiagramFloorFigure("1") && !parseDiagramFloorFigure(undefined) &&
  !parseDiagramFloorFigure("off"), "only DIAGRAM_FLOOR_FIGURE=on enables the floor");
check(resolveDiagramFloorFigure(undefined) === false && resolveDiagramFloorFigure("on") === true, "the server flag defaults off");

const QUESTION = "A 12 V battery and two 3.3 kΩ resistors in series. Find the voltage at the junction.";
const turnPlan = (visualRequirement: TurnPlanV3["visualRequirement"] = "required"): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question: QUESTION, visualRequirement,
  givens: [
    { id: "V", symbol: "V", value: 12, unit: "V", provenance: "given", sourceText: "12 V battery" },
    { id: "R_1", symbol: "R_1", value: 3.3, unit: "kΩ", provenance: "given", sourceText: "two 3.3 kΩ resistors" },
    { id: "R_2", symbol: "R_2", value: 3.3, unit: "kΩ", provenance: "given", sourceText: "two 3.3 kΩ resistors" },
  ],
  unknowns: [{ id: "V_j", symbol: "V_j", unit: "V" }], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
});
const span = (text: string) => ({ source: "question" as const, start: QUESTION.indexOf(text), end: QUESTION.indexOf(text) + text.length, quote: text });
const problemIR = {
  schemaVersion: "problem-ir/v1" as const, id: "junction", question: QUESTION,
  facts: [
    { id: "f1", kind: "given" as const, statement: "12 V battery", evidence: span("12 V battery") },
    { id: "f2", kind: "given" as const, statement: "two resistors in series", evidence: span("two 3.3 kΩ resistors in series") },
    { id: "f3", kind: "requested" as const, statement: "junction voltage", evidence: span("Find the voltage at the junction") },
  ],
  entities: [
    { id: "battery", kind: "component" as const, label: "12 V battery", evidenceFactIds: ["f1"] },
    { id: "r1", kind: "component" as const, label: "3.3 kΩ resistor", evidenceFactIds: ["f2"] },
    { id: "r2", kind: "component" as const, label: "3.3 kΩ resistor", evidenceFactIds: ["f2"] },
    { id: "junction", kind: "point" as const, label: "junction", evidenceFactIds: ["f3"] },
  ],
  expressions: [], constraints: [], solveRequests: [],
  representationIntents: [{ id: "i1", kind: "network" as const, entityIds: ["battery", "r1", "r2", "junction"], evidenceFactIds: ["f2"] }],
};

const base = (overrides: Partial<ProductionSceneSelectionInput> = {}): ProductionSceneSelectionInput => ({
  question: QUESTION, turnPlan: turnPlan(), problemIR, candidateValidation: null, fastRepresentation: null,
  exactFigureSource: "planner", solverAuthorityBlocked: false, requiredRetryEnabled: true, policy, ...overrides,
});

// Off: the turn is taught as today, and nothing about the floor is recorded.
const off = selectProductionScene(base());
check(off.representation === null && off.floor === undefined, "flag off draws nothing new and records no floor attempt");

// On: the stated setup draws, as a nonmetric question representation, and saves.
const on = selectProductionScene(base({ floorFigureEnabled: true }));
check(on.representation?.figureSource === "floor", `flag on draws the floor figure: ${on.floor?.reason ?? on.reason}`);
check(on.representation.tier === "question_representation" && on.representation.nonMetric, "the floor is a nonmetric question representation");
check(on.floor?.drawn === true && on.floor.kind === "circuit", "the floor admission names its kind");
check(on.visualStatus === "validated", "a drawn floor validates the turn");
check(liveSceneSaveFailure({ document: on.representation.sceneDocument, question: QUESTION, turnPlan: turnPlan(), tier: on.representation.tier }) === null,
  "the floor figure passes save admission");
for (const yieldPolicy of ["off", "verified_parts"] as const) {
  const admitted = validateProductionSceneCandidate({ candidate: structuredClone(on.representation.sceneDocument) as unknown as Record<string, unknown>,
    question: QUESTION, turnPlan: turnPlan(), yieldPolicy });
  check(admitted.valid && admitted.value?.document.source.yieldDemotions === undefined, `the floor passes ${yieldPolicy} admission untrimmed`);
}
const shown = on.representation.renderScene.primitives.flatMap((primitive) => primitive.text ? [primitive.text] : []);
check(shown.includes("V_j = ?") && !shown.some((text) => /\b6(?:\.0+)?\s*V\b/.test(text)), "the asked value is a question mark, never the solved one");

// Never over a solver contradiction, a figure the turn does not require, or one it asks to omit.
check(selectProductionScene(base({ floorFigureEnabled: true, solverAuthorityBlocked: true })).representation === null, "no floor over a solver contradiction");
// "Required" is the plan's vote or the stem's own figure request, the rule the
// selector already uses for retry; a stem that asks for nothing visual and a
// plan that says none end before any fallback, the floor included.
const optional = selectProductionScene(base({ floorFigureEnabled: true, turnPlan: turnPlan("optional") }));
check(optional.floor?.attempted === true, "a stem that asks for a figure keeps the floor even when the plan says optional");
const plain = "What is the sum of 2 and 3?";
const none = selectProductionScene({ ...base(), question: plain, problemIR: null, floorFigureEnabled: true,
  turnPlan: { ...turnPlan("none"), question: plain, givens: [], unknowns: [] } });
check(none.representation === null && none.floor === undefined && none.reason === "the question asks for no figure", "a turn that asks for no figure gets no floor");

// Never over a source veto: stated lines whose plan contradicts the source's own solution.
{
  const question = "Solve the pair x + y = 6 and x - y = 2 by the graphical method.";
  const lines: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
    givens: [], unknowns: [{ id: "x", symbol: "x" }, { id: "y", symbol: "y" }],
    derived: [{ id: "x", symbol: "x", value: 5, provenance: "derived" }, { id: "y", symbol: "y", value: 1, provenance: "derived" }],
    qualitativeClaims: [], lawIds: [], assumptions: [],
  };
  const vetoed = selectProductionScene({ ...base(), question, turnPlan: lines, problemIR: null, floorFigureEnabled: true });
  check(/linear_source/.test(vetoed.reason) && vetoed.representation === null && vetoed.floor === undefined,
    `no floor over a source veto: ${vetoed.reason}`);
  const honest = selectProductionScene({ ...base(), question, problemIR: null, floorFigureEnabled: true,
    turnPlan: { ...lines, derived: [{ id: "x", symbol: "x", value: 4, provenance: "derived" }, { id: "y", symbol: "y", value: 2, provenance: "derived" }] } });
  check(honest.representation !== null, "the same stated lines draw when the plan agrees");
}

// Never over a valid planner figure.
{
  const document = structuredClone(on.representation.sceneDocument) as unknown as Record<string, unknown>;
  document.source = { question: QUESTION };
  const planner = validateProductionSceneCandidate({ candidate: document, question: QUESTION, turnPlan: turnPlan() });
  check(planner.valid, "the planner-shaped control validates");
  const kept = selectProductionScene(base({ floorFigureEnabled: true, candidateValidation: planner }));
  check(kept.representation?.figureSource === "planner" && kept.floor === undefined, "a valid planner figure is drawn and the floor is not tried");
}

// A stated part the floor cannot draw declines the whole figure: the turn stays text only.
{
  const question = "A 12 V battery, a switch and two 3.3 kΩ resistors are in series. Find the current.";
  const declined = selectProductionScene({ ...base(), question, problemIR: null, floorFigureEnabled: true,
    turnPlan: { ...turnPlan(), question, unknowns: [{ id: "I", symbol: "I", unit: "A" }] } });
  check(declined.representation === null && declined.floor?.drawn === false, `an undrawable stated part declines: ${declined.floor?.reason}`);
}

console.log(`verify-floor-figure-selection: ${checks} checks passed`);
