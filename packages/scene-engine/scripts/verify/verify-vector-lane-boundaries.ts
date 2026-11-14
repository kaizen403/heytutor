import assert from "node:assert/strict";
import { test } from "node:test";
import { SceneBuilder } from "../../src/archetypes/document";
import { compileSceneDocument } from "../../src/compile/compiler";
import { separateSharedOriginVectors } from "../../src/compile/vectorLanes";
import { validateSceneDocument } from "../../src/document/validation";
import type { RenderPrimitive } from "../../src/types";

const viewport = { x: 400, y: 0, width: 760, height: 700 };

function arrows(endpointBound: boolean, dy = 0) {
  const scene = new SceneBuilder("Show two named vectors from O.", "vector lane boundaries", "synthetic");
  scene.point("O", { x: 750, y: 300 }, "origin", "O");
  if (endpointBound) {
    scene.point("A", { x: 850, y: 300 + dy }, "endpoint", "A");
    scene.point("B", { x: 800, y: 300 + dy / 2 }, "endpoint", "B");
  }
  scene.vector("u", "O", endpointBound ? { end: "A" } : { direction: { x: 100, y: dy }, length: Math.hypot(100, dy) }, "first vector", "u");
  scene.vector("v", "O", endpointBound ? { end: "B" } : { direction: { x: 100, y: dy }, length: Math.hypot(50, dy / 2) }, "second vector", "v");
  scene.group("setup", endpointBound ? ["O", "A", "B", "u", "v"] : ["O", "u", "v"], "vectors");
  return scene.build();
}

test("endpoint-bound arrows retain both visible endpoints and fail hidden-arrow admission", () => {
  const document = arrows(true);
  const primitives: RenderPrimitive[] = [
    { id: "u", entityId: "u", groupId: "setup", kind: "vector", points: [{ x: 750, y: 300 }, { x: 850, y: 300 }] },
    { id: "v", entityId: "v", groupId: "setup", kind: "vector", points: [{ x: 750, y: 300 }, { x: 800, y: 300 }] },
  ];
  const before = structuredClone(primitives);
  separateSharedOriginVectors(document, primitives, viewport);
  assert.deepEqual(primitives, before, "an origin witness cannot justify moving a bound tip away from B");
  const parsed = validateSceneDocument(document);
  assert(parsed.document);
  const compiled = compileSceneDocument(parsed.document, { figureConsistency: true });
  assert.equal(compiled.ok, false);
  assert(compiled.report.issues.some(issue => issue.code === "vector_collinear_overlap"));
});

test("exactly parallel free arrows survive two-decimal screen rounding", () => {
  const document = arrows(false, 100 / 3);
  const primitives: RenderPrimitive[] = [
    { id: "u", entityId: "u", groupId: "setup", kind: "vector", points: [{ x: 750, y: 300 }, { x: 850, y: 333.33 }] },
    { id: "v", entityId: "v", groupId: "setup", kind: "vector", points: [{ x: 750, y: 300 }, { x: 800, y: 316.67 }] },
  ];
  separateSharedOriginVectors(document, primitives, viewport);
  assert.equal(primitives[1]!.provenance?.vectorLane, true, "100/3 and 50/3 round to slightly different rendered directions");
  for (const dy of [100 / 3, -100 / 3, 100 * Math.sqrt(2), -100 * Math.sqrt(2)]) {
    const document = arrows(false, dy);
    const parsed = validateSceneDocument(document);
    assert(parsed.document);
    const compiled = compileSceneDocument(parsed.document, {
      figureConsistency: true, viewport: { x: 410, y: 55, width: 740.01, height: 555, padding: 24 },
    });
    assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
    const moved = compiled.renderScene.primitives.find(primitive => primitive.entityId === "v" && primitive.kind === "vector")!;
    assert.equal(moved.provenance?.vectorLane, true, "the shorter arrow needs its own lane after projection and rounding");
    const start = moved.provenance.physicalStart as { x: number; y: number };
    const end = moved.provenance.physicalEnd as { x: number; y: number };
    assert(Math.abs(moved.points[1]!.x - moved.points[0]!.x - (end.x - start.x)) < 1e-9);
    assert(Math.abs(moved.points[1]!.y - moved.points[0]!.y - (end.y - start.y)) < 1e-9);
    const witness = compiled.renderScene.primitives.find(primitive => primitive.entityId === "v" && primitive.provenance?.vectorOriginWitness);
    assert(witness);
    assert.deepEqual(witness.points, [start, moved.points[0]]);
    assert.equal(witness.groupId, moved.groupId);
  }
});

test("nearby directions and downstream angle arms do not acquire free-arrow lanes", () => {
  const document = arrows(false, 100 / 3);
  const primitives: RenderPrimitive[] = [
    { id: "u", entityId: "u", groupId: "setup", kind: "vector", points: [{ x: 750, y: 300 }, { x: 850, y: 333.33 }] },
    { id: "v", entityId: "v", groupId: "setup", kind: "vector", points: [{ x: 750, y: 300 }, { x: 800, y: 317.67 }] },
  ];
  const before = structuredClone(primitives);
  separateSharedOriginVectors(document, primitives, viewport);
  assert.deepEqual(primitives, before, "a real angular difference exceeds screen quantization");

  document.constructions.push({ id: "angle", operator: "angle_mark", inputs: { a: "u", b: "v", vertex: "O" }, outputs: ["angle_arm"] });
  primitives[1]!.points[1]!.y = 316.67;
  const constrained = structuredClone(primitives);
  separateSharedOriginVectors(document, primitives, viewport);
  assert.deepEqual(primitives, constrained, "rounding tolerance cannot move a constrained angle arm");
});
