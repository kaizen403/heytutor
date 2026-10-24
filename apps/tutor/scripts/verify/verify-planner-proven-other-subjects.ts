/**
 * Lessons the plan does not place in maths, physics or the chemistry lane
 * draw only planner proven figures. A $0 audit of 5,592 recorded lab
 * questions through today's deterministic selection found the physics
 * families, archetypes and last resort drawing wrong or misleading figures
 * about half the time on the non strict lane (an RL circuit as three
 * resistors, a Carnot explanation as a P-V rectangle through the origin, a
 * cubical Gaussian surface as two charges), and production 21 Oct drew a two
 * battery network for an emitter follower lesson the plan called "other".
 * The stems below are written for this gate.
 */
import assert from "node:assert/strict";
import { FIGURE_SOURCES, type FigureSource, type TurnPlanV3 } from "@heytutor/scene-engine";
import { diagramStrategyAllowsFigureSource, liveDiagramStrategyDecision, plannerProvenFiguresOnly } from "../../features/tutor-session/lib/scene/diagramStrategy";
import { deriveSceneGate, selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

type Subject = "maths" | "physics" | "chemistry" | "other";
// Production classifies subjects (strict subjects maths,physics); strict
// switched off for a subject keeps it on the current lane.
const decide = (subject: Subject | undefined, chemistryLane = false, extra: Partial<{ dsa: boolean; codeLesson: boolean; doubt: boolean }> = {},
  strictSubjects: Subject[] = ["maths"]) =>
  liveDiagramStrategyDecision({ assignedStrategy: "current", subject, strictSubjects: strictSubjects as never, chemistryLane, codeLesson: false, dsa: false, doubt: false, ...extra });

const deterministic: FigureSource[] = ["fast_family", "family", "archetype", "last_resort"];
for (const source of deterministic) {
  assert.equal(diagramStrategyAllowsFigureSource(decide("other"), source), false, `other subject must not draw ${source}`);
  assert.equal(diagramStrategyAllowsFigureSource(decide("chemistry"), source), false, `chemistry outside its lane must not draw ${source}`);
  assert.equal(diagramStrategyAllowsFigureSource(decide("physics"), source), true, `physics with strict switched off for it keeps ${source}`);
  assert.equal(diagramStrategyAllowsFigureSource(decide(undefined), source), true, `a decision without a subject keeps ${source}`);
}
// With subject classification off every live turn reads "other": main's sources stay.
for (const source of deterministic) {
  assert.equal(diagramStrategyAllowsFigureSource(decide("other", false, {}, []), source), true, `other with classification off keeps ${source}`);
}
for (const source of ["planner", "verified_recovery", "linear_source", "text_only"] as FigureSource[]) {
  assert.equal(diagramStrategyAllowsFigureSource(decide("other"), source), true, `other subject keeps ${source}`);
}
assert.equal(diagramStrategyAllowsFigureSource(decide("other", true), "chemistry_family"), true, "the chemistry lane keeps its families");
assert.equal(plannerProvenFiguresOnly(decide("other", false, { dsa: true, codeLesson: true })), false, "a DSA lesson keeps its trace figures");
assert.equal(plannerProvenFiguresOnly(decide("other", false, { doubt: true })), false, "doubts are unchanged");

function plan(question: string, lawIds: string[], visualRequirement: TurnPlanV3["visualRequirement"] = "optional"): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds, assumptions: [], visualRequirement };
}
function drawn(question: string, turnPlan: TurnPlanV3, subject: Subject): FigureSource | null {
  const gate = deriveSceneGate({ question, turnPlan, problemIR: null });
  const decision = decide(subject, gate.chemistryLane);
  const fast = selectFastVerifiedRepresentation({ question, turnPlan: gate.turnPlan, problemIR: null, families: gate.sceneCapabilities.families });
  const selection = selectProductionScene({
    question, turnPlan: gate.turnPlan, problemIR: null, sceneCapabilities: gate.sceneCapabilities, candidateValidation: undefined,
    fastRepresentation: fast, exactFigureSource: "planner", solverAuthorityBlocked: false, requiredRetryEnabled: true,
    completionEnabled: false, solverAuthority: null,
    policy: { preferPlanner: false, allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(decision, source)) },
  } as Parameters<typeof selectProductionScene>[0]);
  return selection.representation?.figureSource ?? null;
}

const otherStems: Array<[string, string[]]> = [
  ["Explain the Carnot engine and its efficiency.", ["Carnot efficiency", "second law of thermodynamics"]],
  ["Using Kirchhoff's laws, explain current in each branch of a circuit with two batteries.", ["Kirchhoff voltage law"]],
  ["A closed cubical surface encloses a point charge away from its centre. Draw the field.", ["Gauss law"]],
];
let blocked = 0;
for (const [question, laws] of otherStems) {
  const asOther = drawn(question, plan(question, laws), "other");
  assert.equal(asOther, null, `"${question}" drew ${asOther} for a lesson the plan calls other`);
  if (drawn(question, plan(question, laws), "physics") !== null) blocked += 1;
}
assert(blocked >= 1, "the gate must exercise at least one figure the current lane would draw");

const vsepr = "Explain VSEPR theory and the shape of SF4 and XeF4.";
assert.notEqual(drawn(vsepr, plan(vsepr, ["VSEPR theory"], "required"), "chemistry"), null, "the chemistry lane still draws its figure");

console.log(`planner proven figures for other subjects: ${deterministic.length} deterministic sources refused, ${blocked} previously drawn stems blocked, chemistry lane kept`);
