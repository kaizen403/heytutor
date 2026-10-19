/** Native MAIN-valid label contracts; frozen attachment and identity oracles stay unchanged. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { attemptArchetypeScene } from "../../src/archetypes";
import { buildUnitCellScene } from "../../src/chemistry/unitCell";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { placeLabels } from "../../src/labels/labelEngine";
import type { RenderPrimitive, RenderScene, SceneDocument } from "../../src/types";

interface NativeOracle {
  id: string;
  kind: string;
  question: string;
  geometrySha256: string;
  labels: Array<{ entityId: string; text: string }>;
}
const oracles = JSON.parse(readFileSync(new URL("./fixtures/label-placement-regression-oracles.json", import.meta.url), "utf8")) as { records: NativeOracle[] };
const identity = JSON.parse(readFileSync(new URL("./fixtures/space-view-byte-identity.json", import.meta.url), "utf8")) as {
  documents: Record<string, SceneDocument>; hashes: Record<string, string>;
};
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const failures: string[] = [];
let passed = 0;
function check(name: string, body: () => void): void {
  try { body(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
function compile(document: SceneDocument): RenderScene {
  const validated = validateSceneDocument(pruneDeadSceneEntities(structuredClone(document) as unknown as Record<string, unknown>));
  assert.ok(validated.document, `native fixture must validate: ${JSON.stringify(validated.report.issues)}`);
  const result = compileSceneDocument(validated.document);
  assert.ok(result.ok && result.renderScene, `native fixture must compile: ${JSON.stringify(result.report.issues)}`);
  return result.renderScene;
}
function labelKeys(primitives: RenderPrimitive[]): string[] {
  return primitives.filter((primitive) => primitive.kind === "label")
    .map((primitive) => `${primitive.entityId}\u0000${primitive.text}`).sort();
}
for (const oracle of oracles.records) check(`native ${oracle.id} keeps ink and labels`, () => {
  let scene: RenderScene;
  if (oracle.kind === "archetype") {
    const attempt = attemptArchetypeScene({ question: oracle.question });
    assert.ok(attempt.scene, `native archetype remains drawable: ${attempt.declined}: ${JSON.stringify(attempt.issues)}`);
    scene = attempt.scene.renderScene;
  } else {
    const document = buildUnitCellScene(oracle.question, [], false);
    assert.ok(document, "native unit-cell builder supplies its document");
    scene = compile(document);
  }
  assert.equal(hash(scene.primitives.filter((primitive) => primitive.kind !== "label" && primitive.provenance?.labelLeader !== true)), oracle.geometrySha256,
    "label repair preserves every non-label/non-leader primitive byte");
  assert.deepEqual(labelKeys(scene.primitives), oracle.labels.map((label) => `${label.entityId}\u0000${label.text}`).sort(),
    "every original owner keeps its complete native text");
  if (oracle.id === "cscl") {
    const stroke = scene.primitives.find((primitive) => primitive.id === "primitive_cell_diag");
    const label = scene.primitives.find((primitive) => primitive.id === "primitive_cell_diag_label");
    assert.ok(stroke?.points[0] && stroke.points[1] && label?.points[0], "the formula retains its exact original diagonal carrier");
    const [a, b] = stroke.points; const center = label.points[0];
    const dx = b!.x - a!.x; const dy = b!.y - a!.y;
    const at = Math.max(0, Math.min(1, ((center.x - a!.x) * dx + (center.y - a!.y) * dy) / (dx * dx + dy * dy)));
    assert.ok(Math.hypot(center.x - a!.x - at * dx, center.y - a!.y - at * dy) <= 103,
      "the formula stays within its measured 102.782px tether of the actual diagonal, without name fallback");
  }
});

for (const [name, id, total] of [
  ["series component result stays a summary", "fixtures/golden/circuit-series-parallel-12ohm.json.sceneDocuments.series", "36Ω"],
  ["parallel component result stays a summary", "fixtures/golden/circuit-series-parallel-12ohm.json.sceneDocuments.parallel", "4Ω"],
] as const) check(name, () => {
  const scene = compile(identity.documents[id]!);
  const result = scene.primitives.find((primitive) => primitive.kind === "label" && primitive.text === total);
  assert.ok(result?.provenance?.summary, "equivalent circuit value stays in its native result summary");
  assert.ok(scene.primitives.some((primitive) => primitive.entityId === result.entityId && primitive.kind === "label" && primitive.text === "12Ω"),
    "the physical component keeps its independent 12Ω label");
  assert.equal(hash(scene), identity.hashes[id], "frozen native circuit render remains byte-identical");
});
for (const id of ["physics-probe:modern-easy-photoelectric", "physics-probe:modern-medium-hydrogen-transition"]) check(`native level placement ${id}`, () => {
  assert.equal(hash(compile(identity.documents[id]!)), identity.hashes[id], "already attached native level names keep their frozen render bytes");
});

function pressureVolumeScene(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", source: { question: "Derive the explicit pressure-volume process and state." },
    visualDecision: { mode: "scene", reason: "verified physical PV law" }, quantities: [],
    entities: [{ id: "process", kind: "polyline", role: "computed PV process" }, { id: "state", kind: "point", role: "computed PV state" }],
    constructions: [
      { id: "construct_process", operator: "polytropic_process", inputs: { pressureStart: 100, volumeStart: 1, volumeEnd: 2, exponent: 1, pressureUnit: "kPa", volumeUnit: "L", pressureScale: 0.02, volumeScale: 3, samples: 9 }, outputs: ["process"] },
      { id: "construct_state", operator: "process_state", inputs: { process: "process", at: 0.5 }, outputs: ["state"] },
    ], relations: [], assertions: [], annotations: [], requiredEntityIds: ["process", "state"],
    revealGroups: [{ id: "setup", entityIds: ["process", "state"], dependsOn: [], narrationCue: "show PV process" }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "show verified pressure-volume behavior" }],
  };
}
check("independent process equation and requested work both survive", () => {
  const document = pressureVolumeScene();
  document.quantities.push({ id: "source_work", value: 69.31471805599453, unit: "J" });
  document.annotations.push({ id: "requested_work", kind: "label", targetIds: ["process"], text: "W", quantityId: "source_work" });
  const scene = compile(document);
  const labels = scene.primitives.filter((primitive) => primitive.entityId === "process" && primitive.kind === "label");
  assert.ok(labels.some((label) => label.text === "P=P0(V0/V)^1"), "the complete independent source law survives");
  assert.ok(labels.some((label) => label.id === "requested_work" && label.text === "W"),
    "the independent native quantity annotation keeps its identity, owner and complete text");
  assert.equal(labels.length, 2, "neither statement is duplicated or consumed into the other");
});
check("unrequested process work is not exposed", () => {
  const labels = compile(pressureVolumeScene()).primitives.filter((primitive) => primitive.kind === "label");
  assert.ok(labels.some((label) => label.text === "P=P0(V0/V)^1"));
  assert.ok(!labels.some((label) => label.text?.startsWith("W")));
});
check("explicit native work name retains computed value", () => {
  const document = pressureVolumeScene(); document.entities[0]!.label = "W";
  assert.ok(compile(document).primitives.some((primitive) => primitive.entityId === "process" && primitive.text === "W=69.3 J"));
});
check("independent work annotation retains exact quantity authority", () => {
  const document = pressureVolumeScene();
  document.quantities.push({ id: "source_work", value: 1, unit: "J" });
  document.annotations.push({ id: "requested_work", kind: "label", targetIds: ["process"], text: "W", quantityId: "source_work" });
  const result = compileSceneDocument(document);
  assert.equal(result.ok, false, "an independent label cannot hide a source quantity that disagrees with the exact work");
  assert.equal(result.renderScene, null);
});

function contourScene(closed: boolean, endpointClosed = false, leader = false, height = 0.05): SceneDocument {
  const points = [[0, 0], [5, height], [10, 0]];
  if (endpointClosed) points.push([0, 0]);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "stroke versus planar region" },
    source: { question: "Show the supplied curve or closed region without changing its geometry." }, quantities: [],
    entities: [{ id: "shape", kind: closed ? "polygon" : "polyline", role: "supplied geometry",
      ...(leader ? { label: "contour", provenance: { requireLabelLeader: true } } : {}) }],
    constructions: [{ id: "make_shape", operator: closed ? "polygon" : "polyline", inputs: { points }, outputs: ["shape"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["shape"],
    revealGroups: [{ id: "setup", entityIds: ["shape"], dependsOn: [], narrationCue: "Show the supplied geometry." }], teachingTimeline: [],
  };
}
// Two branch-only extent-hardening oracles are archived unchanged as pending
// in transaction-20261018/extent-pending; this packet retains MAIN admission.
const sourceFlaggedClosedRegion = contourScene(true);
sourceFlaggedClosedRegion.entities[0]!.provenance = { labelLeader: true };
for (const [name, document] of [
  ["closed thin polygon remains rejected", contourScene(true)],
  ["endpoint-closed thin contour remains rejected", contourScene(false, true)],
  ["source cannot disguise a closed region as a label leader", sourceFlaggedClosedRegion],
] as const) check(name, () => {
  const result = compileSceneDocument(document);
  assert.equal(result.ok, false, "a closed region below the unchanged minimum planar extent cannot render");
  assert.equal(result.renderScene, null);
  assert.ok(result.report.issues.some((issue) => issue.code === "degenerate_projected_geometry"));
});
check("valid closed area keeps its native extent", () => {
  assert.ok(compile(contourScene(true, false, false, 5)).primitives.some((primitive) => primitive.kind === "polygon"));
});

check("layout fallback retains native identity and text", () => {
  const result = placeLabels([{
    labelId: "native_B", entityId: "field", text: "B", anchor: { x: 500, y: 500 },
    useOwnerBounds: false, tetherPx: 2, viewBounds: { x: 0, y: 0, width: 200, height: 100 },
    fallbackPlacement: { anchor: { x: 50, y: 50 }, useOwnerBounds: false, tetherPx: undefined, allowLeader: false },
  }], []);
  assert.ok(result.ok, "a native name with no local candidates can use its valid prior layout");
  assert.equal(result.placements.length, 1);
  assert.equal(result.placements[0]!.labelId, "native_B");
  assert.equal(result.placements[0]!.entityId, "field");
  assert.equal(result.placements[0]!.text, "B");
});
check("layout fallback cannot erase final side and clip constraints", () => {
  const result = placeLabels([{
    labelId: "native_B", entityId: "field", text: "B", anchor: { x: 500, y: 500 },
    useOwnerBounds: false, tetherPx: 2, viewBounds: { x: 0, y: 0, width: 80, height: 100 },
    sideRegions: [{ kind: "half_plane", point: { x: 140, y: 0 }, normal: { x: 1, y: 0 } }],
    fallbackPlacement: { anchor: { x: 50, y: 50 }, useOwnerBounds: false, tetherPx: undefined, allowLeader: false },
  }], []);
  assert.equal(result.ok, false, "no candidate can satisfy both the final clip and medium side");
  assert.equal(result.placements.length, 0);
});

console.log(`label placement regressions: ${passed}/${passed + failures.length} passed`);
if (failures.length > 0) process.exitCode = 1;
