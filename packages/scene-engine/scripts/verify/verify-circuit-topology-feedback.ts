/** Synthetic branch/node contract and repair feedback; no model or network calls. */
import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import { evaluateTopologyAssertion } from "../../src/topology/topology";
import type { SceneDocument, SceneIssue } from "../../src/types";

let checks = 0;
function check(value: unknown, message: string): asserts value {
  checks += 1;
  assert(value, message);
}
export function parallel(loads = 2): SceneDocument {
  const branchIds = ["supply", ...Array.from({ length: loads }, (_, i) => `load_${i + 1}`)];
  const ids = ["rail_a", "rail_b", ...branchIds];
  return {
    schemaVersion: "scene-document/v2",
    source: { question: "Explain parallel branches across the same two electrical nodes.", representationTier: "qualitative_verified", nonMetric: true },
    visualDecision: { mode: "scene", reason: "Explicit nonnumeric branch topology" },
    quantities: [],
    entities: [
      { id: "rail_a", kind: "point", role: "node" }, { id: "rail_b", kind: "point", role: "node" },
      ...branchIds.map((id, i) => ({ id, kind: "component" as const, role: i === 0 ? "source" : "resistor", label: i === 0 ? "source" : `R${i}` })),
    ],
    constructions: [
      { id: "node_a", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["rail_a"] },
      { id: "node_b", operator: "point", inputs: { x: 5, y: 0, coordinateSpace: "layout" }, outputs: ["rail_b"] },
      ...branchIds.map((id, i) => ({ id: `make_${id}`, operator: "symbol", inputs: { symbol: i === 0 ? "battery" : "resistor", start: "rail_a", end: "rail_b" }, outputs: [id] })),
    ],
    relations: [], assertions: [
      { id: "load_pair", predicate: "sameTerminalPair", entities: branchIds.slice(1), expected: true, severity: "fatal" },
      { id: "all_paths", predicate: "pathCount", entities: ["rail_a", "rail_b"], expected: loads + 1, severity: "fatal" },
    ], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "network", entityIds: ids, dependsOn: [], narrationCue: "The loads share the same two nodes" }], teachingTimeline: [],
  };
}
for (const loads of [2, 3, 5]) {
  const scene = parallel(loads);
  const validated = validateSceneDocument(scene);
  check(validated.document, `nonnumeric parallel network must validate: ${JSON.stringify(validated.report.issues)}`);
  const compiled = compileSceneDocument(validated.document);
  check(compiled.ok && compiled.renderScene, `nonnumeric parallel network must compile: ${JSON.stringify(compiled.report.issues)}`);
  check(!scene.quantities.length && !scene.entities.some((x) => x.kind === "vector"), "concept must not invent currents or quantities");
  const centers = scene.entities.filter((x) => x.kind === "component").map((entity) => {
    const points = compiled.renderScene.primitives.filter((p) => p.entityId === entity.id && p.kind !== "label").flatMap((p) => p.points);
    check(points.length > 0, `branch ${entity.id} must have engine-generated geometry`);
    return points.reduce((sum, point) => sum + point.y, 0) / points.length;
  });
  check(new Set(centers.map((n) => n.toFixed(2))).size === loads + 1, "all parallel branches must occupy distinct lanes");
}
const mismatch = parallel();
mismatch.assertions[1]!.expected = 2;
mismatch.assertions[1]!.reason = "Planner insists there are two paths";
// Without a complete fatal load proof this remains a strict graph-path claim.
mismatch.assertions[0]!.severity = "warning";
const refused = compileSceneDocument(mismatch);
check(!refused.ok, "omitting the source branch without a complete fatal load proof must remain refused");
const issue = refused.report.issues.find((x) => x.code === "assertion_failed" && x.expected === 2 && x.actual === 3);
check(issue, "branch mismatch must retain the machine-readable expected and actual counts");
check(/all.*(?:symbol|edge)/i.test(issue.message) && /source.*(?:included|counted)|(?:included|counted).*source/i.test(issue.message), "repair must explain all edges including sources count");
check(issue.message.includes("supply") && issue.message.includes("load_1") && issue.message.includes("load_2"), "repair must show the three concrete path witnesses even with planner reason");
check(issue.message.includes("rail_a") && issue.message.includes("rail_b") && issue.message.includes("all_paths"), "repair must name failed assertion and terminal nodes");

const compatible = parallel();
compatible.assertions[1]!.expected = 2;
const admitted = compileSceneDocument(compatible);
check(admitted.ok, "a complete fatal parallel load proof enables the bounded legacy interpretation");
const compatibility = admitted.report.issues.find((x) => x.code === "path_count_load_branch_compatibility");
check(compatibility?.severity === "warning" && JSON.stringify(compatibility.actual) === JSON.stringify({ graphPaths: 3, loadBranches: 2 }),
  "compatibility must preserve both measured counts instead of silently changing graph paths");

const series = parallel();
series.entities.push({ id: "middle", kind: "point", role: "node" });
series.constructions.push({ id: "make_middle", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "layout" }, outputs: ["middle"] });
series.constructions.find((x) => x.id === "make_load_1")!.inputs.end = "middle";
series.constructions.find((x) => x.id === "make_load_2")!.inputs.start = "middle";
series.assertions[0]!.reason = "Planner calls these parallel";
const issues: SceneIssue[] = [];
check(evaluateTopologyAssertion(series.assertions[0]!, series, issues) === false, "a series pair must not satisfy sameTerminalPair");
check(issues[0]?.message.includes("load_1") && issues[0].message.includes("load_2") && issues[0].message.includes("middle"), "parallel repair must identify each mismatching terminal pair");

const negative = parallel();
negative.assertions[0]!.expected = false;
const negativeIssues: SceneIssue[] = [];
check(evaluateTopologyAssertion(negative.assertions[0]!, negative, negativeIssues) === false, "a false parallelism assertion must stay false");
check(negativeIssues[0]?.message.includes("expected false, found true"), "negative assertion feedback must describe the measured mismatch");

const missingEdges = parallel();
missingEdges.assertions[0]!.entities = ["rail_a", "rail_b"];
const missingIssues: SceneIssue[] = [];
check(evaluateTopologyAssertion(missingEdges.assertions[0]!, missingEdges, missingIssues) === false, "node ids must not be accepted as component ids");
check(missingIssues[0]?.message.includes("rail_a, rail_b") && missingIssues[0].message.includes("symbol/connect output ids"), "missing-edge feedback must name wrong operands and the expected output kind");

const separatedTerminals = parallel();
separatedTerminals.entities.push({ id: "alias_a", kind: "point", role: "node" }, { id: "alias_b", kind: "point", role: "node" });
separatedTerminals.constructions.push(
  { id: "alias_a_point", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["alias_a"] },
  { id: "alias_b_point", operator: "point", inputs: { x: 5, y: 0 }, outputs: ["alias_b"] },
);
separatedTerminals.constructions.find((x) => x.id === "make_load_2")!.inputs.start = "alias_a";
separatedTerminals.constructions.find((x) => x.id === "make_load_2")!.inputs.end = "alias_b";
check(evaluateTopologyAssertion(separatedTerminals.assertions[0]!, separatedTerminals, []) === false, "coincident points must not create undeclared electrical joins");
separatedTerminals.constructions.push(
  { id: "join_a", operator: "connect", inputs: { start: "rail_a", end: "alias_a" }, outputs: ["wire_a"] },
  { id: "join_b", operator: "connect", inputs: { start: "rail_b", end: "alias_b" }, outputs: ["wire_b"] },
);
check(evaluateTopologyAssertion(separatedTerminals.assertions[0]!, separatedTerminals, []) === true, "explicit wire joins must prove a shared node pair");

const manyPaths = parallel(5);
manyPaths.assertions[1]!.expected = 5;
manyPaths.assertions[0]!.severity = "warning";
const manyIssues: SceneIssue[] = [];
check(evaluateTopologyAssertion(manyPaths.assertions[1]!, manyPaths, manyIssues) === false, "a bounded witness list must not reduce the total path count");
check(manyIssues[0]?.actual === 6 && manyIssues[0].message.includes("; ..."), "diagnostics must show the true count while truncating concrete witnesses");
console.log(`circuit topology feedback: ${checks} checks passed`);
