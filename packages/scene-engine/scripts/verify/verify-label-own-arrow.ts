/** Finite directed-stroke attachment. Fixture is an authored evaluation example. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { compileSceneDocument, getLabelTransactionDiagnostics } from "../../src/compile/compiler";
import { createStrokeAttachment, labelRespectsStrokeAttachment } from "../../src/labels/strokeAttachment";
import { obstaclesFromPrimitives, placeLabels, type LabelOwner } from "../../src/labels/labelEngine";
import type { RenderPoint, RenderPrimitive, SceneDocument } from "../../src/types";

const bytes = readFileSync(new URL("./fixtures/label-own-arrow-h4.json", import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"), "e9d205ce9b974eab06446726945321ba6d7e79d898bd825ff00600a98d8bc6b4");
const fixture = JSON.parse(bytes.toString()) as { sceneDocument: SceneDocument };
const oracle = JSON.parse(readFileSync(new URL("./fixtures/label-own-arrow-oracles.json", import.meta.url), "utf8")) as {
  cases: Array<{ id: string; physical: RenderPrimitive[]; labels: Array<{ id: string; entityId: string; groupId: string; text: string }> }>;
};
const cases = [
  { id: "exact H4", document: fixture.sceneDocument },
  ...[
    ["rotate 90", 90, 1, false], ["rotate 180", 180, 1, false], ["rotate 37", 37, 1, false],
    ["reflect", 0, 1, true], ["reflect rotate", 127, 1, true],
    ["shorter", 0, 0.65, false], ["longer", 0, 1.7, false],
  ].map(([id, degrees, scale, reflect]) => ({ id: String(id), document: transformed(fixture.sceneDocument, Number(degrees), Number(scale), Boolean(reflect)) })),
  { id: "renamed", document: renamed(fixture.sceneDocument) },
  { id: "lengths 5 12", document: changedLengths(fixture.sceneDocument, 5, 12) },
  { id: "lengths 12 5", document: changedLengths(fixture.sceneDocument, 12, 5) },
  { id: "lengths 8 15", document: changedLengths(fixture.sceneDocument, 8, 15) },
];
const evidence: unknown[] = [];
let failures = 0;
for (const item of cases) {
 try { check(item.id, item.document); }
 catch (error) { failures++; console.error(`FAIL ${item.id}: ${error instanceof Error ? error.message : String(error)}`); }
}
if (process.env.OWN_ARROW_EVIDENCE) writeFileSync(process.env.OWN_ARROW_EVIDENCE, JSON.stringify(evidence, null, 2) + "\n");
console.log(`own arrow: ${cases.length - failures}/${cases.length} passed`);
if (failures) process.exitCode = 1;
if (!process.argv.includes("--compile-only")) {
  checkGeometricControls();
  checkNativeControls();
}

function check(id: string, document: SceneDocument): void {
const result = compileSceneDocument(document);
assert.ok(result.ok && result.renderScene, `exact H4 must draw: ${JSON.stringify(result.report.issues)}`);
assert.equal(getLabelTransactionDiagnostics(result)?.selectedPolicy, "attached", "own-arrow positive must use the enhanced verified transaction");
const primitives = result.renderScene.primitives;
const expected = oracle.cases.find((item) => item.id === id)!;
assert.equal(JSON.stringify(primitives.filter((primitive) => primitive.kind !== "label" && primitive.provenance?.labelLeader !== true)), JSON.stringify(expected.physical),
  "all physical primitives remain exact");
assert.deepEqual(primitives.filter((primitive) => primitive.kind === "label").map(({ id, entityId, groupId, text }) => ({ id, entityId, groupId, text })), expected.labels,
  "every whole native label, owner and reveal group remains exact");
const output = document.constructions.find((construction) => construction.operator === "relative_velocity")!.outputs[2]!;
const own = primitives.find((primitive) => primitive.entityId === output && primitive.kind === "vector")!;
const label = primitives.find((primitive) => primitive.entityId === output && primitive.kind === "label")!;
assert.ok(label && own, "the ordered native resultant output retains its whole label and directed stroke");
const competitor = primitives.find((primitive) => primitive.kind === "vector" && primitive.entityId !== output &&
  close(primitive.points.at(-1)!, own.points.at(-1)!))!;
assert.ok(competitor, "subtraction triangle has its distinct second stroke");
const ownDistance = project(label.points[0]!, own.points).distance;
const competingDistance = project(label.points[0]!, competitor.points).distance;
const leader = primitives.find((primitive) => primitive.id === `${label.id}_leader` && primitive.provenance?.labelLeader === true);
evidence.push({ id,
  label: { id: label.id, entityId: label.entityId, groupId: label.groupId, text: label.text, center: label.points[0] },
  own: { entityId: own.entityId, points: own.points, distance: ownDistance },
  competing: { entityId: competitor.entityId, points: competitor.points, distance: competingDistance },
  leader: leader?.points ?? null,
  physical: primitives.filter((primitive) => primitive.kind !== "label" && primitive.provenance?.labelLeader !== true),
  labels: primitives.filter((primitive) => primitive.kind === "label").map(({ id, entityId, groupId, text }) => ({ id, entityId, groupId, text })),
});
assert.equal(label.text, "vRel", "native ordered output keeps the complete generated name");
assert.equal(label.groupId, "subtract");
assert.ok(leader
  ? project(leader.points[0]!, own.points).distance <= 0.02
  : ownDistance <= competingDistance + 0.02,
`exact H4 resultant must attach to its own stroke: own=${ownDistance.toFixed(4)}, competitor=${competingDistance.toFixed(4)}`);
console.log(`PASS ${id} own arrow: own=${ownDistance.toFixed(4)}, competitor=${competingDistance.toFixed(4)}, leader=${Boolean(leader)}`);
}

function transformed(source: SceneDocument, degrees: number, scale: number, reflect: boolean): SceneDocument {
  const document = structuredClone(source);
  const angle = degrees * Math.PI / 180;
  const apply = (x: number, y: number, length = 1) => {
    const reflected = reflect ? -x : x;
    return { x: (reflected * Math.cos(angle) - y * Math.sin(angle)) * length, y: (reflected * Math.sin(angle) + y * Math.cos(angle)) * length };
  };
  for (const construction of document.constructions) {
    if (construction.operator === "point") {
      const point = apply(Number(construction.inputs.x), Number(construction.inputs.y), scale);
      construction.inputs.x = point.x; construction.inputs.y = point.y;
    }
    if (construction.operator === "relative_velocity") {
      const a = apply(9, 0), b = apply(0, 12);
      construction.inputs.velocityA = [a.x, a.y]; construction.inputs.velocityB = [b.x, b.y];
      construction.inputs.displayScale = 15 * scale;
    }
    if (construction.operator === "angle_mark") construction.inputs.radius = 3 * scale;
  }
  return document;
}

function renamed(source: SceneDocument): SceneDocument {
  const ids = new Set([...source.entities.map((entity) => entity.id), ...source.constructions.map((construction) => construction.id)]);
  const map = new Map([...ids].map((id, index) => [id, `renamed_${index}`]));
  return JSON.parse(JSON.stringify(source), (_key, value) => typeof value === "string" ? map.get(value) ?? value : value) as SceneDocument;
}

function changedLengths(source: SceneDocument, a: number, b: number): SceneDocument {
  const document = structuredClone(source);
  document.quantities[0]!.value = a; document.quantities[1]!.value = b;
  document.source.question = `Car A travels due east at ${a} m/s and car B travels due north at ${b} m/s on flat ground. Find the magnitude and direction of the velocity of A relative to B.`;
  for (const construction of document.constructions) {
    if (construction.operator === "relative_velocity") construction.inputs.displayScale = Math.hypot(a, b);
    if (construction.operator === "point") {
      if (construction.inputs.x === 9) construction.inputs.x = a;
      if (construction.inputs.y === 12) construction.inputs.y = b;
      if (construction.inputs.y === -12) construction.inputs.y = -b;
    }
  }
  for (const entity of document.entities) {
    if (entity.label === "A: 9 m/s") entity.label = `A: ${a} m/s`;
    if (entity.label === "B: 12 m/s") entity.label = `B: ${b} m/s`;
  }
  return document;
}

function checkGeometricControls(): void {
  const own = { entityId: "any native output", points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] };
  const sibling = { entityId: "unrelated identity", points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] };
  const relation = createStrokeAttachment(own.entityId, [own, sibling])!;
  const at = (x: number, y: number) => ({ bounds: { x: x - 10, y: y - 10, width: 20, height: 20 }, usesLeader: false });
  assert.equal(labelRespectsStrokeAttachment(relation, at(120, 50)), false, "distinct interior sibling is not the owner");
  assert.equal(labelRespectsStrokeAttachment(relation, at(30, 50)), true, "own finite stroke wins");
  assert.equal(labelRespectsStrokeAttachment(relation, { ...at(120, 50), usesLeader: true, leaderFrom: { x: 100, y: 50 }, leaderTo: { x: 110, y: 50 } }), false,
    "a connector beginning on the sibling is not an own-stroke witness");
  assert.equal(labelRespectsStrokeAttachment(relation, { ...at(120, 50), usesLeader: true, leaderFrom: { x: 50, y: 50 }, leaderTo: { x: 110, y: 50 } }), true,
    "an exact own-stroke connector can explain text outside the nearest region");
  const horizontal = { entityId: "horizontal", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  const junction = { entityId: "junction", points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] };
  assert.equal(labelRespectsStrokeAttachment(createStrokeAttachment(horizontal.entityId, [horizontal])!, at(50, 20)), true, "isolated directed stroke");
  assert.equal(labelRespectsStrokeAttachment(createStrokeAttachment(horizontal.entityId, [horizontal, junction])!, at(120, -20)), true,
    "shared endpoint remains one honest visible locus");
  const reverse = { entityId: "coincident reverse", points: [...horizontal.points].reverse() };
  assert.equal(labelRespectsStrokeAttachment(createStrokeAttachment(horizontal.entityId, [horizontal, reverse])!, at(50, 20)), true,
    "coincident strokes do not demand impossible strict-nearest ownership");
  const parallel = { entityId: "parallel", points: [{ x: 0, y: 40 }, { x: 100, y: 40 }] };
  assert.equal(labelRespectsStrokeAttachment(createStrokeAttachment(horizontal.entityId, [horizontal, parallel])!, at(50, 20)), false,
    "a tie between distinct strokes needs a leader");
  const short = { entityId: "finite", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
  const beyond = { entityId: "beyond", points: [{ x: 20, y: 0 }, { x: 20, y: 100 }] };
  assert.equal(labelRespectsStrokeAttachment(createStrokeAttachment(short.entityId, [short, beyond])!, at(100, 0)), false,
    "projection is clamped to the finite stroke, never its extension");
  assert.equal(createStrokeAttachment("missing", [horizontal]), undefined);

  const physical: RenderPrimitive[] = [own, sibling].map((stroke, index) => ({
    id: `stroke_${index}`, entityId: stroke.entityId, groupId: "group", kind: "vector", points: stroke.points.map((point) => ({ x: point.x + 500, y: point.y + 100 })),
  }));
  const screenRelation = createStrokeAttachment(own.entityId, physical)!;
  const owner: LabelOwner = { entityId: own.entityId, text: "whole name", anchor: { x: 570, y: 170 }, useOwnerBounds: false,
    alternateAnchors: [{ x: 530, y: 130 }], tetherPx: 56, leaderGeometrySafe: true, strokeAttachment: screenRelation,
    viewBounds: { x: 450, y: 30, width: 400, height: 300 } };
  for (const mode of ["compass", "leader", "local fallback"] as const) {
    const variant: LabelOwner = mode === "leader" ? { ...owner, requireLeader: true }
      : mode === "local fallback" ? { ...owner, anchor: { x: 800, y: 300 }, tetherPx: 1, fallbackPlacement: {
        anchor: owner.anchor, useOwnerBounds: false, tetherPx: 56, leaderGeometrySafe: true, alternateAnchors: owner.alternateAnchors,
      } } : owner;
    const placement = placeLabels([variant], obstaclesFromPrimitives(physical));
    assert.ok(placement.ok && placement.placements.length === 1, `${mode} retains a complete drawable name`);
    assert.ok(labelRespectsStrokeAttachment(screenRelation, placement.placements[0]!), `${mode} respects the same native relation`);
  }
  const pinned = placeLabels([{ ...owner, pinToAnchor: true, anchor: { x: 620, y: 150 } }], obstaclesFromPrimitives(physical));
  assert.equal(pinned.ok, false, "pinned text cannot bypass its native stroke relation");
  console.log("PASS isolated/shared/coincident/finite/leader and candidate-family controls");
}

function checkNativeControls(): void {
  for (const mode of ["isolated", "shared endpoint", "coincident"] as const) {
    const document = structuredClone(fixture.sceneDocument);
    document.quantities = [];
    document.entities = [
      { id: "a", kind: "point", role: "endpoint" }, { id: "b", kind: "point", role: "endpoint" },
      ...(mode === "shared endpoint" ? [{ id: "c", kind: "point" as const, role: "endpoint" }] : []),
      { id: "first", kind: "vector", role: "directed stroke", label: "u" },
      ...(mode !== "isolated" ? [{ id: "second", kind: "vector" as const, role: "directed stroke", label: "w" }] : []),
    ];
    document.constructions = [
      { id: "a_point", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["a"] },
      { id: "b_point", operator: "point", inputs: { x: 6, y: 4, coordinateSpace: "world" }, outputs: ["b"] },
      ...(mode === "shared endpoint" ? [{ id: "c_point", operator: "point", inputs: { x: 6, y: -3, coordinateSpace: "world" }, outputs: ["c"] }] : []),
      { id: "first_vector", operator: "vector", inputs: { start: "a", end: "b" }, outputs: ["first"] },
      ...(mode !== "isolated" ? [{ id: "second_vector", operator: "vector", inputs: { start: mode === "coincident" ? "a" : "b", end: mode === "coincident" ? "b" : "c" }, outputs: ["second"] }] : []),
    ];
    document.assertions = [];
    document.requiredEntityIds = document.entities.map((entity) => entity.id);
    document.revealGroups = [{ id: "native", entityIds: document.requiredEntityIds, dependsOn: [] }];
    document.teachingTimeline = [{ id: "show", action: "reveal", targetId: "native", dependsOn: [] }];
    const before = JSON.stringify(document);
    const result = compileSceneDocument(document);
    assert.equal(JSON.stringify(document), before, `${mode} retains original native document`);
    if (mode === "coincident") {
      assert.ok(!result.ok && !result.renderScene && result.report.issues.some((issue) => issue.code === "duplicate_geometry"),
        "independently declared duplicate arrows retain native geometry rejection");
      console.log("PASS native coincident arrows retain geometry rejection");
      continue;
    }
    assert.ok(result.ok && result.renderScene, `${mode} must draw: ${JSON.stringify(result.report.issues)}`);
    assert.equal(getLabelTransactionDiagnostics(result)?.selectedPolicy, "attached", `${mode} is not forced to native fallback by an impossible nearest-arrow constraint`);
    for (const entity of document.entities.filter((entity) => entity.kind === "vector")) {
      assert.ok(result.renderScene.primitives.some((primitive) => primitive.kind === "label" && primitive.entityId === entity.id &&
        primitive.text === entity.label && primitive.groupId === "native"), `${mode} retains complete name and native owner`);
    }
    console.log(`PASS native ${mode} arrows`);
  }
}

function close(a: RenderPoint, b: RenderPoint): boolean { return Math.hypot(a.x - b.x, a.y - b.y) <= 0.02; }
function project(point: RenderPoint, path: RenderPoint[]): { distance: number; point: RenderPoint; t: number } {
  let best = { distance: Number.POSITIVE_INFINITY, point: path[0]!, t: 0 };
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1]!, b = path[index]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    const nearest = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = Math.hypot(point.x - nearest.x, point.y - nearest.y);
    if (distance < best.distance) best = { distance, point: nearest, t };
  }
  return best;
}
