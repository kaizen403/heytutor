/** Synthetic picture-demand safety; inventories are vetoes, never topology proofs. */
import assert from "node:assert/strict";
import { circuitTopologyFromProblemStructure, sceneDemand, demandRejection, compileSceneDocument, type ProblemStructureView, type SceneDocument } from "../../src/index";

const inventory = {
  entities: [
    { kind: "component", label: "voltage source" },
    ...Array.from({ length: 4 }, (_, index) => ({ kind: "component", label: `resistor ${index + 1}` })),
  ],
  representationIntents: [{ kind: "network" }],
  constraints: [],
  solveRequests: [{ kind: "evaluate" }],
};
assert.equal(circuitTopologyFromProblemStructure(inventory)?.twoLoop, false,
  "An inventory cannot prove a multi-loop graph to the planner");
assert.equal(sceneDemand("Explain the supplied electrical network.", inventory).forbids.includes("resistor_chain"), true,
  "A source plus four loads with no explicit branch graph must retain main's chain veto");
let checks = 2;
function check(value: unknown, message: string): asserts value { checks += 1; assert.ok(value, message); }
const stem = "Explain the supplied electrical network.";
function inventoryCase(sources: number, loads: number, network = true): ProblemStructureView {
  return {
    entities: [...Array.from({ length: sources }, (_, index) => ({ kind: "component", label: `source ${index}` })),
      ...Array.from({ length: loads }, (_, index) => ({ kind: "component", label: `resistor ${index}` }))],
    representationIntents: network ? [{ kind: "network" }] : [],
    constraints: [], solveRequests: [{ kind: "evaluate" }],
  };
}
for (const [name, ir, expected] of [
  ["two sources and one load", inventoryCase(2, 1), true],
  ["five source-free components", inventoryCase(0, 5), true],
  ["small simple inventory", inventoryCase(1, 2), false],
  ["network intent alone", inventoryCase(0, 0), false],
  ["main connected-junction rule", { ...inventoryCase(1, 2), constraints: [
    { kind: "connected", entityIds: ["left", "right"] }, { kind: "connected", entityIds: ["left", "right"] },
  ] }, true],
  ["junctions without network intent", { ...inventoryCase(1, 2, false), constraints: [
    { kind: "connected", entityIds: ["left", "right"] }, { kind: "connected", entityIds: ["left", "right"] },
  ] }, false],
] satisfies Array<[string, ProblemStructureView, boolean]>) {
  check(circuitTopologyFromProblemStructure(ir)?.twoLoop === false, `${name}: inventory must not invent guidance topology`);
  check(sceneDemand(stem, ir).forbids.includes("resistor_chain") === expected, `${name}: preserve main's exact inventory veto`);
}
function graph(edges: Array<[string, string, string]>, coarse?: ProblemStructureView): ProblemStructureView {
  return { ...coarse, solveRequests: [{ kind: "dc_network", network: {
    model: "ideal_dc", nodes: [...new Set(edges.flatMap(([a, b]) => [a, b]))],
    branches: edges.map(([from, to, kind], index) => ({ id: `edge_${index}`, from, to, kind })),
  } }] };
}
const oneLoop = graph([["a", "b", "voltage_source"], ["b", "a", "resistor"]]);
const twoLoops = graph([["a", "b", "voltage_source"], ["a", "b", "resistor"], ["a", "b", "resistor"]]);
check(circuitTopologyFromProblemStructure(oneLoop)?.twoLoop === false, "A valid one-loop graph remains one-loop guidance");
check(!sceneDemand(stem, oneLoop).forbids.includes("resistor_chain"), "A small graph-only single loop keeps its chain option");
check(circuitTopologyFromProblemStructure(twoLoops)?.twoLoop === true, "Explicit graph evidence still proves multiple cycles");
check(sceneDemand(stem, twoLoops).forbids.includes("resistor_chain"), "An explicit multi-loop graph vetoes a chain without inventory");
const conservativeOneLoop = { ...inventory, solveRequests: oneLoop.solveRequests };
check(circuitTopologyFromProblemStructure(conservativeOneLoop)?.twoLoop === false, "Explicit single-loop guidance remains truthful despite inventory");
check(sceneDemand(stem, conservativeOneLoop).forbids.includes("resistor_chain"), "An explicit one-loop graph cannot silently relax main's inventory veto");
const malformed = { ...inventory, solveRequests: [{ kind: "dc_network", network: {
  model: "ideal_dc", nodes: ["a", "b"], branches: [{ id: "bad", kind: "resistor", from: "a", to: "undeclared" }],
} }] };
check(circuitTopologyFromProblemStructure(malformed)?.twoLoop === false, "Malformed graph evidence cannot create guidance");
check(sceneDemand(stem, malformed).forbids.includes("resistor_chain"), "Malformed graph evidence cannot remove the inventory veto");
const conflicting = { ...inventory, solveRequests: [...oneLoop.solveRequests!, ...twoLoops.solveRequests!] };
check(circuitTopologyFromProblemStructure(conflicting)?.twoLoop === false, "Conflicting graphs cannot create guidance");
check(sceneDemand(stem, conflicting).forbids.includes("resistor_chain"), "Conflicting graphs cannot remove the inventory veto");

const points = [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 2, y: 0 }, { id: "p2", x: 4, y: 0 }, { id: "p3", x: 4, y: 3 }, { id: "p4", x: 0, y: 3 }];
const components = ["source", "load1", "load2", "load3", "load4"];
const chain: SceneDocument = {
  schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "synthetic all-series candidate" }, source: { question: stem },
  quantities: [], entities: [...points.map(({ id }) => ({ id, kind: "point", role: "node" })),
    ...components.map((id, index) => ({ id, kind: "component", role: index === 0 ? "battery" : "resistor" }))],
  constructions: [...points.map(({ id, x, y }) => ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "layout" }, outputs: [id] })),
    ...components.map((id, index) => ({ id: `make_${id}`, operator: "symbol", inputs: {
      symbol: index === 0 ? "battery" : "resistor", start: `p${(index + 4) % 5}`, end: `p${index}`,
    }, outputs: [id] }))],
  relations: [], assertions: [], annotations: [], requiredEntityIds: components,
  revealGroups: [{ id: "circuit", entityIds: [...points.map(({ id }) => id), ...components], dependsOn: [], narrationCue: "candidate circuit" }],
  teachingTimeline: [],
};
check(compileSceneDocument(chain).ok, "The all-series synthetic candidate is independently drawable so the demand veto must decide");
check(demandRejection(chain, sceneDemand(stem, inventory))?.includes("resistor_chain"), "Actual picture-demand rejection refuses collapsing a possible network into a series chain");
check(demandRejection(chain, sceneDemand(stem, twoLoops))?.includes("resistor_chain"), "Actual picture-demand rejection also respects a proved multi-loop graph");
check(demandRejection(chain, sceneDemand(stem, oneLoop)) === null, "A genuinely small single-loop circuit remains drawable");
console.log(`verify-circuit-demand-veto: ${checks} checks passed`);
