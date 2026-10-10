import assert from "node:assert/strict";
import { validateTurnPlanSceneProofs, type SceneDocument, type TurnPlanV3 } from "../../src/index";

function circuit(edges: Array<[string, string, string, string]>, groupId = "network"): SceneDocument {
  const nodes = [...new Set(edges.flatMap(([, , start, end]) => [start, end]))];
  const ids = [...nodes, ...edges.map(([id]) => id)];
  return { schemaVersion: "scene-document/v2", source: {}, visualDecision: { mode: "scene", reason: "source circuit" }, quantities: [],
    entities: [...nodes.map((id) => ({ id, kind: "point", role: "terminal" })), ...edges.map(([id, symbol]) => ({ id, kind: symbol === "wire" ? "connector" : "component", role: symbol }))],
    constructions: [
      ...nodes.map((id, index) => ({ id: `node_${id}`, operator: "point", inputs: { x: index, y: index % 2 }, outputs: [id] })),
      ...edges.map(([id, symbol, start, end]) => ({ id: `edge_${id}`, operator: symbol === "wire" ? "connect" : "symbol", inputs: { ...(symbol === "wire" ? {} : { symbol }), start, end }, outputs: [id] })),
    ], relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: groupId, entityIds: ids, dependsOn: [], narrationCue: "source circuit" }], teachingTimeline: [] };
}
const plan = (question: string): TurnPlanV3 => ({ schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] });
let checks = 0;
const failures: string[] = [];
const check = (value: unknown, message: string) => { checks++; if (!value) failures.push(message); };
const openCells = circuit([["cell1", "cell", "A", "B"], ["cell2", "cell", "B", "C"]]);
const unloaded = plan("Show two cells connected in series as a two-terminal source.");
check(validateTurnPlanSceneProofs(openCells, unloaded).length === 0, "unloaded source-only open terminals remain valid");
const stringClaim = structuredClone(unloaded); stringClaim.qualitativeClaims = [{ id: "behavior", claim: "cell_behavior", expected: "The same current flows through each cell." }];
check(validateTurnPlanSceneProofs(openCells, stringClaim).some((issue) => issue.code === "source_loop_not_closed"), "string-valued expected current requires a closed path");
const currentKey = structuredClone(unloaded); currentKey.qualitativeClaims = [{ id: "behavior", claim: "current flows through both cells", expected: true }];
check(validateTurnPlanSceneProofs(openCells, currentKey).some((issue) => issue.code === "source_loop_not_closed"), "existing current-key demand remains enforced");
const booleanClaim = structuredClone(unloaded); booleanClaim.qualitativeClaims = [{ id: "behavior", claim: "cell_behavior", expected: true }];
check(validateTurnPlanSceneProofs(openCells, booleanClaim).length === 0, "unrelated boolean expectation does not invent a current demand");
for (const expected of ["No current flows through the open terminals.", "Zero current flows through each cell.", "The current is zero because the terminals are open.", "Current cannot flow until the terminals are connected.", "Current=0.00 A.", "The current in an open circuit is zero."]) {
  const noCurrent = structuredClone(unloaded); noCurrent.qualitativeClaims = [{ id: "behavior", claim: "cell_behavior", expected }];
  check(validateTurnPlanSceneProofs(openCells, noCurrent).length === 0, "a declared zero/no-current unloaded source still permits open terminals");
}
for (const expected of ["Current=0.01 A.", "Current is 0.000001 A.", "No current flows initially, but current flows through each cell now.", "The same current flows through the cells in an open circuit.", "Current through cell1 is positive and current through cell2 is zero."]) {
  const demanded = structuredClone(unloaded); demanded.qualitativeClaims = [{ id: "behavior", claim: "cell_behavior", expected }];
  check(validateTurnPlanSceneProofs(openCells, demanded).some((issue) => issue.code === "source_loop_not_closed"), "positive/tiny or contradictory expectation still requires a closed current path");
}
const closed = circuit([["cell1", "cell", "A", "B"], ["cell2", "cell", "B", "C"], ["load", "resistor", "C", "A"]]);
check(validateTurnPlanSceneProofs(closed, stringClaim).length === 0, "closed loaded circuit satisfies string-valued current claim");
const mixed = circuit([["R0", "resistor", "A", "B"], ["R1", "resistor", "B", "C"], ["R2", "resistor", "B", "C"]]);
const parallelOnly = plan("Show resistors connected in parallel.");
check(validateTurnPlanSceneProofs(mixed, parallelOnly).some((issue) => issue.code === "turnplan_parallel_not_proven"), "parallel-only view cannot hide one series resistor behind a subset proof");
const namedMixed = structuredClone(mixed); namedMixed.revealGroups[0]!.id = "parallel_view";
check(validateTurnPlanSceneProofs(namedMixed, parallelOnly).some((issue) => issue.code === "turnplan_parallel_not_proven"), "parallel view name cannot authorize a mixed network");
const hiddenSeries = structuredClone(mixed); hiddenSeries.revealGroups = [
  { id: "parallel", entityIds: ["B", "C", "R1", "R2"], dependsOn: [], narrationCue: "parallel view" },
  { id: "other", entityIds: ["A", "R0"], dependsOn: [], narrationCue: "other view" },
];
check(validateTurnPlanSceneProofs(hiddenSeries, parallelOnly).some((issue) => issue.code === "turnplan_parallel_not_proven"), "reveal groups cannot hide a requested series resistor in a parallel-only scene");
check(validateTurnPlanSceneProofs(mixed, plan("Show resistors connected only in parallel.")).some((issue) => issue.code === "turnplan_parallel_not_proven"), "parallel-only qualifier retains the complete topology demand");
const mixedPlan = plan("Explain the series and parallel resistance in this mixed network."); mixedPlan.lawIds = ["series_resistance", "parallel_resistance"];
check(validateTurnPlanSceneProofs(mixed, mixedPlan).length === 0, "mixed-network series/parallel subset proofs remain valid");
check(validateTurnPlanSceneProofs(mixed, plan("Explain the series and parallel resistance in this mixed network.")).length === 0, "mixed concept grammar does not require supplemental law tags");
check(validateTurnPlanSceneProofs(namedMixed, mixedPlan).length === 0, "one combined mixed view may use verified subsets despite its name");
const negativeTopology = plan("Show this resistor network."); negativeTopology.qualitativeClaims = [{ id: "relationship", claim: "connection_behavior", expected: "These resistors are not connected in parallel." }];
check(validateTurnPlanSceneProofs(mixed, negativeTopology).length === 0, "string expectations do not create unrelated topology demands");
const allParallel = circuit([["R0", "resistor", "A", "B"], ["R1", "resistor", "A", "B"], ["R2", "resistor", "A", "B"], ["lead", "wire", "A", "L"]]);
check(validateTurnPlanSceneProofs(allParallel, parallelOnly).length === 0, "all requested resistors sharing a terminal pair with a port pass");
const missingParallel = structuredClone(mixed); const changedBranch = missingParallel.constructions.find((construction) => construction.outputs.includes("R2"))!; changedBranch.inputs.start = "C"; changedBranch.inputs.end = "A";
check(validateTurnPlanSceneProofs(missingParallel, mixedPlan).some((issue) => issue.code === "turnplan_parallel_not_proven"), "mixed-network permission still requires a genuine parallel subset");
assert.equal(failures.length, 0, failures.join("\n"));
console.log(`125 circuit review: ${checks} source-proof checks passed`);
