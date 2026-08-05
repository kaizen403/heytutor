/**
 * Golden corpus verification for Verified Diagram Engine v3.
 * Circuit series/parallel + mirror plan expectations.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSceneDocument } from "../src/compiler";
import {
  REQUIRED_DIAGRAM_DEADLINE_MS,
  REQUIRED_DIAGRAM_TARGET_MS,
  resolveDiagramFailureStatus,
  type TurnPlanV3,
} from "../src/contractsV3";
import { boundsOverlap, placeLabels } from "../src/labelEngine";
import { evaluateTopologyAssertion, buildTopologyGraph } from "../src/topology";
import { validateSceneDocument } from "../src/validation";
import type { SceneAssertion, SceneDocument, SceneIssue } from "../src/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/golden");

function loadJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, name), "utf8")) as Record<string, unknown>;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function runTopologyAssertions(document: SceneDocument): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const assertion of document.assertions) {
    evaluateTopologyAssertion(assertion, document, issues);
  }
  return issues;
}

// --- Circuit golden ---
const circuit = loadJson("circuit-series-parallel-12ohm.json");
const turnPlan = circuit.turnPlan as TurnPlanV3;
assert(turnPlan.schemaVersion === "turn-plan/v3", "circuit turn plan version");
assert(turnPlan.visualRequirement === "required", "circuit visual requirement");
const derivedSeries = turnPlan.derived.find((item) => item.id === "r_series");
const derivedParallel = turnPlan.derived.find((item) => item.id === "r_parallel");
assert(derivedSeries?.value === 36 && derivedSeries.unit === "ohm", "series equivalent 36 ohm");
assert(derivedParallel?.value === 4 && derivedParallel.unit === "ohm", "parallel equivalent 4 ohm");

const scenes = circuit.sceneDocuments as Record<string, SceneDocument>;

const seriesValidated = validateSceneDocument(scenes.series);
assert(seriesValidated.document !== null, `series schema: ${JSON.stringify(seriesValidated.report.issues)}`);
const seriesCompiled = compileSceneDocument(seriesValidated.document!);
assert(seriesCompiled.ok, `series compile: ${JSON.stringify(seriesCompiled.report.issues)}`);
assert(
  !seriesCompiled.report.issues.some((issue) => issue.code === "assertion_failed"),
  `series assertions: ${JSON.stringify(seriesCompiled.report.issues)}`,
);

const parallelDoc = scenes.parallel!;
const parallelValidated = validateSceneDocument(parallelDoc);
assert(parallelValidated.document !== null, `parallel schema: ${JSON.stringify(parallelValidated.report.issues)}`);
const parallelGraph = buildTopologyGraph(parallelValidated.document!);
assert(parallelGraph.edges.length === 3, "parallel should have three branch edges");
const parallelIssues = runTopologyAssertions(parallelValidated.document!);
assert(parallelIssues.length === 0, `parallel topology: ${JSON.stringify(parallelIssues)}`);
const parallelCompiled = compileSceneDocument(parallelValidated.document!);
assert(parallelCompiled.ok && parallelCompiled.renderScene !== null, `parallel compile: ${JSON.stringify(parallelCompiled.report.issues)}`);
const parallelBranchCenters = ["r1", "r2", "r3"].map((entityId) => {
  const points = parallelCompiled.renderScene!.primitives
    .filter((primitive) => primitive.entityId === entityId && primitive.kind !== "label")
    .flatMap((primitive) => primitive.points);
  return points.reduce((sum, point) => sum + point.y, 0) / points.length;
});
assert(new Set(parallelBranchCenters.map((value) => value.toFixed(2))).size === 3, "parallel branches must render in three distinct lanes");

const bypassWithoutAssertions = structuredClone(scenes.series_with_bypass_invalid!);
bypassWithoutAssertions.assertions = [];
const bypassCompiled = compileSceneDocument(bypassWithoutAssertions);
assert(
  !bypassCompiled.ok && bypassCompiled.report.issues.some((issue) => issue.code === "component_chain_bypassed"),
  "bypass mutation must fail compiler invariants without a planner assertion",
);

const wireOverSymbol = structuredClone(scenes.series);
wireOverSymbol.entities.push({ id: "wire_over_r1", kind: "connector", role: "wire" });
wireOverSymbol.constructions.push({ id: "make_wire_over_r1", operator: "connect", inputs: { start: "n0", end: "n1" }, outputs: ["wire_over_r1"] });
wireOverSymbol.requiredEntityIds.push("wire_over_r1");
wireOverSymbol.revealGroups[0]!.entityIds.push("wire_over_r1");
wireOverSymbol.assertions = [];
const wireOverSymbolCompiled = compileSceneDocument(wireOverSymbol);
assert(
  !wireOverSymbolCompiled.ok && wireOverSymbolCompiled.report.issues.some((issue) => issue.code === "component_bypassed"),
  "a connector over a symbol must fail even without planner assertions",
);

const orphan = structuredClone(scenes.series);
orphan.entities.push({ id: "orphan", kind: "point", role: "unexplained point" });
orphan.constructions.push({ id: "make_orphan", operator: "point", inputs: { x: 99, y: 99 }, outputs: ["orphan"] });
const orphanCompiled = compileSceneDocument(orphan);
assert(
  !orphanCompiled.ok && orphanCompiled.report.issues.some((issue) => issue.code === "unrequired_entity" || issue.code === "ungrouped_entity"),
  "unrequired or ungrouped ink must fail before rendering",
);

// Required-retry UX contract
assert(
  resolveDiagramFailureStatus({ visualRequirement: "required", requiredRetryEnabled: true }) === "retry_required",
  "required + flag → retry_required",
);
assert(
  resolveDiagramFailureStatus({ visualRequirement: "required", requiredRetryEnabled: false }) === "text_only",
  "required without flag → text_only",
);
assert(
  resolveDiagramFailureStatus({ visualRequirement: "optional", requiredRetryEnabled: true }) === "text_only",
  "optional → text_only even with flag",
);
assert(
  resolveDiagramFailureStatus({ visualRequirement: "none", requiredRetryEnabled: true }) === "not_required",
  "none → not_required",
);
assert(REQUIRED_DIAGRAM_TARGET_MS === 45_000, "45s target constant");
assert(REQUIRED_DIAGRAM_DEADLINE_MS === 60_000, "60s hard deadline constant");

// Label engine: identical values on different owners are valid when separated.
const repeatedLabels = placeLabels(
  [
    { entityId: "r1", anchor: { x: 100, y: 100 }, text: "12Ω" },
    { entityId: "r2", anchor: { x: 250, y: 100 }, text: "12Ω" },
    { entityId: "r3", anchor: { x: 400, y: 100 }, text: "12Ω" },
  ],
  [],
);
assert(repeatedLabels.ok && repeatedLabels.placements.length === 3, "three separated 12Ω labels must be accepted");
assert(!repeatedLabels.issues.some((issue) => issue.code === "label_duplicate"), "repeated values on distinct owners are not duplicates");
for (let first = 0; first < repeatedLabels.placements.length; first += 1) {
  for (let second = first + 1; second < repeatedLabels.placements.length; second += 1) {
    assert(!boundsOverlap(repeatedLabels.placements[first]!.bounds, repeatedLabels.placements[second]!.bounds), "accepted labels must not overlap");
  }
}

const blockedLabels = placeLabels(
  [{
    entityId: "r1",
    anchor: { x: 100, y: 100 },
    text: "12Ω",
    viewBounds: { x: 0, y: 0, width: 300, height: 300 },
  }],
  [{ id: "protected", kind: "protected", bounds: { x: 0, y: 0, width: 300, height: 300 } }],
);
assert(!blockedLabels.ok, "a label with no collision-free slot must fail closed");
assert(
  blockedLabels.issues.some((issue) => issue.code === "label_overlap_unresolved"),
  "blocked label must report unresolved overlap",
);

const diagonalBoundsLabel = placeLabels(
  [{ entityId: "focus", anchor: { x: 100, y: 100 }, text: "F", viewBounds: { x: 0, y: 0, width: 220, height: 220 } }],
  [{
    id: "diagonal-ray",
    kind: "geometry",
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    segments: [[{ x: 0, y: 0 }, { x: 200, y: 200 }]],
  }],
);
assert(diagonalBoundsLabel.ok, "a diagonal ray must not block empty space inside its coarse bounds");

const distantSlotLabel = placeLabels(
  [{
    entityId: "long_vector",
    anchor: { x: 300, y: 150 },
    text: "I = 0.8 A",
    preferredSlot: "east",
    viewBounds: { x: 0, y: 0, width: 700, height: 300 },
    useOwnerBounds: false,
  }],
  [{ id: "dense-diagram", kind: "protected", bounds: { x: 75, y: 0, width: 450, height: 300 } }],
);
assert(distantSlotLabel.ok, "label search must use a farther in-view slot when the diagram blocks the near field");
assert(
  distantSlotLabel.placements[0]!.bounds.x > 525,
  "the accepted distant label must remain outside protected diagram ink",
);

const constrainedLabelOrder = placeLabels(
  [
    {
      entityId: "short_label",
      anchor: { x: 270, y: 150 },
      text: "R",
      preferredSlot: "east",
      viewBounds: { x: 0, y: 0, width: 420, height: 300 },
      useOwnerBounds: false,
    },
    {
      entityId: "long_label",
      anchor: { x: 210, y: 150 },
      text: "I = 0.8 A",
      preferredSlot: "east",
      viewBounds: { x: 0, y: 0, width: 420, height: 300 },
      useOwnerBounds: false,
    },
  ],
  [
    { id: "upper", kind: "protected", bounds: { x: 0, y: 0, width: 420, height: 126 } },
    { id: "lower", kind: "protected", bounds: { x: 0, y: 174, width: 420, height: 126 } },
    { id: "left", kind: "protected", bounds: { x: 0, y: 126, width: 205, height: 48 } },
  ],
);
assert(constrainedLabelOrder.ok, "label placement must solve the set globally instead of depending on owner order");
for (let first = 0; first < constrainedLabelOrder.placements.length; first += 1) {
  for (let second = first + 1; second < constrainedLabelOrder.placements.length; second += 1) {
    assert(
      !boundsOverlap(
        constrainedLabelOrder.placements[first]!.bounds,
        constrainedLabelOrder.placements[second]!.bounds,
        6,
      ),
      "globally placed labels must retain the minimum readable gap",
    );
  }
}

const compiledSeriesValueLabels = seriesCompiled.renderScene!.primitives.filter((primitive) => primitive.kind === "label" && primitive.text === "12Ω");
assert(compiledSeriesValueLabels.length === 3, "compiler must place all three repeated resistor labels");
assert(new Set(compiledSeriesValueLabels.map((primitive) => `${primitive.points[0]!.x}:${primitive.points[0]!.y}`)).size === 3, "compiled resistor labels must occupy distinct positions");

// --- Mirror golden (plan + quantity lock) ---
const mirror = loadJson("optics-concave-mirror-u20-f15.json");
const mirrorPlan = mirror.turnPlan as TurnPlanV3;
assert(mirrorPlan.derived.find((item) => item.id === "v")?.value === 60, "mirror v=60");
assert(mirrorPlan.derived.find((item) => item.id === "m")?.value === -3, "mirror m=-3");
assert(mirrorPlan.qualitativeClaims.some((claim) => claim.id === "image_inverted"), "inverted claim");
const quantityAgreement = (mirror.expectations as { quantityAgreement: Record<string, number> }).quantityAgreement;
assert(quantityAgreement.v_cm === 60 && quantityAgreement.f_cm === 15, "mirror quantity agreement");
const mirrorScene = mirror.sceneDocument as SceneDocument;
const mirrorValidated = validateSceneDocument(mirrorScene);
assert(mirrorValidated.document !== null, `mirror schema: ${JSON.stringify(mirrorValidated.report.issues)}`);
const mirrorCompiled = compileSceneDocument(mirrorValidated.document!);
assert(mirrorCompiled.ok && mirrorCompiled.renderScene !== null, `mirror compile: ${JSON.stringify(mirrorCompiled.report.issues)}`);
assert(!mirrorCompiled.report.issues.some((issue) => issue.code === "assertion_failed"), "all mirror geometry and ray assertions must pass");
assert(mirrorCompiled.renderScene!.primitives.some((primitive) => primitive.entityId === "reflected_parallel"), "parallel principal ray must render");
assert(mirrorCompiled.renderScene!.primitives.some((primitive) => primitive.entityId === "reflected_focus"), "focus principal ray must render");
assert(!mirrorCompiled.renderScene!.primitives.some((primitive) => primitive.entityId === "normal_parallel" || primitive.entityId === "normal_focus"), "construction-only normals must not render");

// Fixture directory is non-empty and discoverable
const fixtureFiles = readdirSync(root).filter((name) => name.endsWith(".json"));
assert(fixtureFiles.includes("circuit-series-parallel-12ohm.json"), "circuit fixture present");
assert(fixtureFiles.includes("optics-concave-mirror-u20-f15.json"), "mirror fixture present");

// Negative path assertion
const brokenPath: SceneAssertion = {
  id: "bad_path",
  predicate: "path",
  entities: ["r1", "r3"],
  expected: true,
  severity: "fatal",
};
const brokenIssues: SceneIssue[] = [];
evaluateTopologyAssertion(brokenPath, seriesValidated.document!, brokenIssues);
assert(brokenIssues.some((issue) => issue.code === "assertion_failed"), "non-adjacent resistors are not an ordered path");

console.log("verify-golden-corpus: ok");
console.log(`  fixtures=${fixtureFiles.length} deadlineMs=${REQUIRED_DIAGRAM_DEADLINE_MS}`);
