/**
 * A ProblemIR often lists the reaction itself as an unlabelled `state` entity
 * in its representation intent. A state is not a body, and with no source
 * label its only identity is the planner's own id, which no engine figure is
 * built from. Production refused a correct first order decay figure with
 * missing_named_body for exactly that entity.
 *
 *   tsx scripts/chemistry-lab/obligation-abstract-state.ts
 *
 *   draws     an unlabelled state in a conceptual or graph intent is a
 *             declared limit: the kinetics figure is kept and the obligation
 *             is reported as unsupported, never as a miss.
 *   refused   a labelled state the figure does not name, an unlabelled body,
 *             an unlabelled other entity and a named species the figure does
 *             not draw are still missing_named_body.
 */
import { PROBLEM_IR_VERSION, type ProblemEntity, type ProblemIR, type RepresentationIntent } from "../../src/ir/problemIR";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { checkVisualObligations, deriveVisualObligations, visualObligationIssues } from "../../src/synthesize/visualObligations";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";

const STEM = "A first order reaction is 40% complete in 50 minutes. Calculate the time for 80% completion.";
const turnPlan = {
  schemaVersion: "turn-plan/v3", question: STEM,
  givens: [
    { id: "g1", symbol: "x_1", value: 40, unit: "%", provenance: "given", sourceText: "40%" },
    { id: "g2", symbol: "t_1", value: 50, unit: "min", provenance: "given", sourceText: "50 minutes" },
    { id: "g3", symbol: "x_2", value: 80, unit: "%", provenance: "given", sourceText: "80%" },
  ],
  unknowns: [{ id: "u1", symbol: "t_2", unit: "min" }],
  derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
} as unknown as TurnPlanV3;

function problem(entities: ProblemEntity[], intent: RepresentationIntent["kind"] = "conceptual"): ProblemIR {
  const quote = "first order reaction";
  const start = STEM.indexOf(quote);
  return {
    schemaVersion: PROBLEM_IR_VERSION, id: "abstract_state", question: STEM,
    facts: [{ id: "f0", kind: "given", statement: "first order", evidence: { source: "question", start, end: start + quote.length, quote } }],
    entities, expressions: [], constraints: [],
    representationIntents: [{ id: "i0", kind: intent, entityIds: entities.map((entity) => entity.id), evidenceFactIds: ["f0"] } as RepresentationIntent],
    solveRequests: [],
  };
}

const failures: string[] = [];
let passed = 0;
function check(id: string, run: () => string | null): void {
  let failure: string | null;
  try { failure = run(); } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  if (failure) { failures.push(id); console.log(`FAIL ${id}: ${failure}`); } else passed++;
}

const unconstrained = synthesizeFamilyScene({ question: STEM, turnPlan, problemIR: null });
check("baseline/kinetics-draws", () => unconstrained?.family === "chem_kinetics" ? null : `family ${unconstrained?.family ?? "none"}`);

const progress: ProblemEntity = { id: "progress", kind: "state", evidenceFactIds: ["f0"] };
for (const intent of ["conceptual", "graph"] as const) {
  check(`draws/${intent}`, () => {
    const ir = problem([progress], intent);
    const drawn = synthesizeFamilyScene({ question: STEM, turnPlan, problemIR: ir });
    if (drawn?.family !== "chem_kinetics") return `the figure was refused (${drawn?.family ?? "none"})`;
    const result = checkVisualObligations(deriveVisualObligations(ir), drawn.document, STEM);
    if (!result.satisfied) return result.missing.map((miss) => miss.code).join(",");
    if (!result.unsupportedIds.includes("body:progress")) return "the unlabelled state is not declared as a limit";
    const issues = visualObligationIssues(ir, unconstrained!.document, STEM);
    return issues.length === 0 ? null : `recorded ${issues.map((issue) => issue.code).join(",")}`;
  });
}
check("draws/blank-label", () => {
  const ir = problem([{ ...progress, label: "  " }]);
  return synthesizeFamilyScene({ question: STEM, turnPlan, problemIR: ir })?.family === "chem_kinetics" ? null : "a blank label refused the figure";
});

const refused: Array<[string, ProblemEntity]> = [
  ["labelled-state", { id: "stateB", kind: "state", label: "state B", evidenceFactIds: ["f0"] }],
  ["unlabelled-body", { id: "flask", kind: "body", evidenceFactIds: ["f0"] }],
  ["unlabelled-other", { id: "catalyst", kind: "other", evidenceFactIds: ["f0"] }],
  ["named-species", { id: "n2o5", kind: "other", label: "N2O5", evidenceFactIds: ["f0"] }],
];
for (const [id, entity] of refused) {
  check(`refused/${id}`, () => {
    const ir = problem([progress, entity]);
    if (synthesizeFamilyScene({ question: STEM, turnPlan, problemIR: ir })) return "the figure was drawn without the obligated body";
    const codes = visualObligationIssues(ir, unconstrained!.document, STEM).map((issue) => `${issue.code}@${issue.path}`);
    const expected = `missing_named_body@visualObligations/body:${entity.id}`;
    return codes.length === 1 && codes[0] === expected ? null : `expected only ${expected}, got ${codes.join(",") || "none"}`;
  });
}

console.log(`obligation-abstract-state: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
