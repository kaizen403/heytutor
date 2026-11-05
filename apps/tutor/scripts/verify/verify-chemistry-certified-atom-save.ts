/**
 * A figure that draws because named atoms bound to it must also pass the next resume
 * save of its board, and figures dev built must still pass. The save audit regenerates
 * through the family path (sceneSaveAdmission), and this change refuses nothing there.
 *
 *   tsx --tsconfig tsconfig.json scripts/verify/verify-chemistry-certified-atom-save.ts
 */
import assert from "node:assert/strict";
import { PROBLEM_IR_VERSION, type ProblemIR, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";

let failed = 0;
let passed = 0;
function check(id: string, run: () => void): void {
  try {
    run();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const planFor = (question: string): TurnPlanV3 => ({ schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" });

function problem(question: string, bodies: Array<[string, string]>): ProblemIR {
  const entities = bodies.map(([kind, label], index) => ({ id: `e${index}`, kind, label, evidenceFactIds: ["f0"] }));
  return {
    schemaVersion: PROBLEM_IR_VERSION, id: "atoms", question,
    facts: [{ id: "f0", kind: "requested", statement: question, evidence: { source: "question", start: 0, end: question.length, quote: question } }],
    entities, expressions: [], constraints: [],
    representationIntents: [{ id: "i0", kind: "conceptual", entityIds: entities.map((entity) => entity.id), evidenceFactIds: ["f0"] }],
  } as unknown as ProblemIR;
}

function saved(question: string, bodies: Array<[string, string]>) {
  const turnPlan = planFor(question);
  const selection = selectProductionScene({ question, turnPlan, problemIR: problem(question, bodies), candidate: null, requiredRetryEnabled: true } as Parameters<typeof selectProductionScene>[0]);
  const representation = selection.representation;
  assert.equal(representation?.family, "chem_vsepr", String(selection.reason));
  // What a saved board carries into its next save is plain JSON.
  const document = JSON.parse(JSON.stringify(representation!.sceneDocument));
  return { document, question, turnPlan, tier: "qualitative_verified" as const };
}

for (const [question, bodies] of [
  ["geometry of PCl5", [["other", "PCl5 molecule"], ["point", "central P atom"], ["point", "Cl atoms"]]],
  ["Use VSEPR to predict the shapes of ClF3 and BrF5.", [["other", "ClF3 molecule"], ["other", "BrF5 molecule"], ["point", "central Cl atom"]]],
  // Dev drew these already, and must still save.
  ["Use VSEPR to predict the shapes of ClF3 and BrF5.", [["other", "ClF3 molecule"], ["other", "BrF5 molecule"]]],
  ["shape of NH3 molecule", [["other", "NH3 molecule"]]],
] as Array<[string, Array<[string, string]>]>) {
  check(`next resume save passes: ${question} ${bodies.map(([, label]) => label).join(", ")}`, () => {
    assert.equal(sceneSaveAdmissionFailure(saved(question, bodies)), null);
  });
}

check("a body the figure lacks draws nothing, so nothing new is saved", () => {
  const question = "geometry of PCl5";
  const selection = selectProductionScene({ question, turnPlan: planFor(question), problemIR: problem(question, [["point", "central S atom"]]), candidate: null, requiredRetryEnabled: true } as Parameters<typeof selectProductionScene>[0]);
  assert.equal(selection.representation, null);
});

check("the save still refuses a stated value the plan does not support", () => {
  const input = saved("geometry of PCl5", [["other", "PCl5 molecule"], ["point", "central P atom"]]);
  input.document.annotations = [...input.document.annotations, { id: "extra", kind: "callout", targetIds: [], text: "a force of 5 N" }];
  assert.match(sceneSaveAdmissionFailure(input) ?? "", /./);
});

console.log(`verify-chemistry-certified-atom-save: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
