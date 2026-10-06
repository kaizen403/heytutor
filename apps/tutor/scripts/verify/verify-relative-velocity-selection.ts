/**
 * Live selection for relative motion and river crossing: a plan whose
 * numbers disagree with the source gets no figure, so narration never speaks
 * a stale value over a picture; an agreeing plan gets the source figure even
 * when a planner scene compiled.
 */
import { synthesizeFamilyScene, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

let failures = 0;
function check(condition: unknown, message: string): void {
  if (!condition) { failures++; console.error(`FAIL ${message}`); }
}
const plan = (question: string, givens: Array<[string, number, string]>, derived: Array<[string, number, string]>): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, unknowns: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  givens: givens.map(([symbol, value, unit], index) => ({ id: `g${index}`, symbol, value, unit, provenance: "question" as const })),
  derived: derived.map(([symbol, value, unit], index) => ({ id: `d${index}`, symbol, value, unit, provenance: "derived" as const })),
}) as unknown as TurnPlanV3;

const trains = "Two trains A and B are moving in the same direction on parallel tracks with speeds 72 km/h and 54 km/h. Train A is 100 m behind B. How long does A take to catch up with B?";
const givens: Array<[string, number, string]> = [["v_A", 72, "km/h"], ["v_B", 54, "km/h"], ["d", 100, "m"]];
// A compiled foreign scene standing in for a planner candidate.
const planner = synthesizeFamilyScene({ question: "Car A travels east at 20 m/s and car B travels east at 5.0 m/s on the same straight road. Find the velocity of A relative to B." })!;
const exact = { sceneDocument: planner.document as SceneDocument, renderScene: planner.renderScene, validationReport: planner.validationReport };

const agreeing = selectVerifiedRepresentation({ question: trains, turnPlan: plan(trains, givens, [["v_AB", 5, "m/s"], ["t", 20, "s"]]), exact: null });
check(agreeing.sceneDocument.source.sourceModel === "relative_motion_1d" && agreeing.sceneDocument.visualDecision.mode === "scene", "agreeing plan: source relative-motion figure");
const overPlanner = selectVerifiedRepresentation({ question: trains, turnPlan: plan(trains, givens, [["t", 20, "s"]]), exact });
check(overPlanner.sceneDocument.source.sourceModel === "relative_motion_1d", "agreeing plan: source figure preferred over a compiled planner scene");
for (const [id, derived] of [["t=25 s", [["t", 25, "s"]]], ["vAB=35 m/s", [["v_AB", 35, "m/s"]]]] as const) {
  for (const candidate of [null, exact]) {
    const selected = selectVerifiedRepresentation({ question: trains, turnPlan: plan(trains, givens, derived as unknown as Array<[string, number, string]>), exact: candidate });
    check(selected.sceneDocument.visualDecision.mode === "text_only" && /disagree/.test(selected.reason), `stale ${id} (${candidate ? "with" : "without"} planner scene): text only, got ${selected.reason}`);
  }
}
const river = "A boat can row at 5 km/h in still water. A river 1 km wide flows at 3 km/h. Find the time to cross by the shortest path.";
const riverStale = selectVerifiedRepresentation({ question: river, turnPlan: plan(river, [["v_b", 5, "km/h"], ["v_c", 3, "km/h"]], [["t", 0.2, "h"]]), exact: null });
check(riverStale.sceneDocument.visualDecision.mode === "text_only", `river stale shortest-path time 0.2 h: text only, got ${riverStale.reason}`);
const riverOk = selectVerifiedRepresentation({ question: river, turnPlan: plan(river, [["v_b", 5, "km/h"], ["v_c", 3, "km/h"]], [["t", 0.25, "h"]]), exact: null });
check(riverOk.sceneDocument.visualDecision.mode === "scene" && riverOk.sceneDocument.source.archetype === "river_boat", `river agreeing plan: figure, got ${riverOk.reason}`);

console.log(JSON.stringify({ gate: "relative-velocity-selection", failures }));
process.exit(failures ? 1 : 0);
