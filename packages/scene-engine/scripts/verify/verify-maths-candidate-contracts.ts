import assert from "node:assert/strict";
import { validateCircleSourceBinding } from "../../src/compile/circleGeometry";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";

function document(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "contract regression" },
    source: { question: "" }, quantities: [], entities: [], constructions: [],
    relations: [], assertions: [], annotations: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [],
  };
}

// Membership is a unique world-coordinate witness, independent of display metadata.
for (const [x, y, radius] of [[3, 4, 5], [5, 12, 13], [8, 15, 17]]) {
  for (const role of ["given_point", "given point", "named point", "contact"]) {
    const scene = document();
    scene.source.question = `Draw the circle x^2+y^2=${radius * radius} and its tangent at the point (${x},${y}).`;
    scene.entities = [{ id: "o", kind: "point", role: "centre" }, { id: "p", kind: "point", role, label: `(${x},${y})` }, { id: "c", kind: "circle", role: "locus" }];
    scene.constructions = [
      { id: "o_make", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["o"] },
      { id: "p_make", operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: ["p"] },
      { id: "c_make", operator: "circle", inputs: { center: "o", radius }, outputs: ["c"] },
    ];
    assert.deepEqual(validateCircleSourceBinding(scene), [], `valid membership role ${role}`);
    const bad = structuredClone(scene);
    bad.constructions[1]!.inputs.x = x + 0.5;
    assert(validateCircleSourceBinding(bad).some(i => i.code === "circle_source_mismatch"), "wrong member still rejected");
    bad.constructions[1]!.inputs.x = x;
    bad.constructions[1]!.inputs.coordinateSpace = "canvas";
    assert(validateCircleSourceBinding(bad).length > 0, "screen point cannot prove world membership");
    const duplicate = structuredClone(scene);
    duplicate.entities.push({ id: "p2", kind: "point", role: "contact" });
    duplicate.constructions.push({ id: "p2_make", operator: "point", inputs: { x, y }, outputs: ["p2"] });
    assert(validateCircleSourceBinding(duplicate).length > 0, "ambiguous membership still rejected");
    const wrongRadius = structuredClone(scene);
    wrongRadius.constructions[2]!.inputs.radius = radius + 1;
    assert(validateCircleSourceBinding(wrongRadius).length > 0, "wrong circle still rejected");
  }
}

for (const [dx, dy] of [[3, 4], [-2, 5], [7, -3]]) {
  const scene = document();
  scene.entities = [
    { id: "o", kind: "point", role: "origin" }, { id: "v", kind: "vector", role: "vector" },
    { id: "vx", kind: "vector", role: "component" }, { id: "vy", kind: "vector", role: "component" },
  ];
  scene.constructions = [
    { id: "o_make", operator: "point", inputs: { x: -1, y: 2 }, outputs: ["o"] },
    { id: "v_make", operator: "vector", inputs: { start: "o", end: [-1 + dx, 2 + dy] }, outputs: ["v"] },
    { id: "components", operator: "vector_components", inputs: { origin: "o", vector: "v" }, outputs: ["vx", "vy"] },
  ];
  scene.requiredEntityIds = ["v", "vx", "vy"];
  scene.revealGroups = [{ id: "scene", entityIds: ["o", "v", "vx", "vy"], dependsOn: [], narrationCue: "components" }];
  scene.teachingTimeline = [{ id: "reveal", action: "reveal", targetId: "scene", dependsOn: [], narrationIntent: "components" }];
  const validated = validateSceneDocument(scene);
  assert(validated.document, JSON.stringify(validated.report.issues));
  const compiled = compileSceneDocument(validated.document);
  assert(compiled.ok, JSON.stringify(compiled.report.issues));
  assert(compiled.renderScene!.primitives.some(p => p.entityId === "vx"), "Cartesian x component drawn");
  assert(compiled.renderScene!.primitives.some(p => p.entityId === "vy"), "Cartesian y component drawn");
  for (const basis of [[[0, 0], [1, 0]], [[0, 0], [1, 2]]]) {
    const explicit = structuredClone(validated.document);
    explicit.constructions[2]!.inputs.basis = basis;
    assert(compileSceneDocument(explicit).ok, "explicit nondegenerate basis preserved");
  }
  for (const basis of [null, "missing", [[0, 0], [0, 0]]]) {
    const invalid = structuredClone(validated.document);
    invalid.constructions[2]!.inputs.basis = basis;
    assert(!compileSceneDocument(invalid).ok, "invalid explicit basis must not fall back");
  }
}
console.log("maths candidate contracts: source membership and optional Cartesian basis pass; false/ambiguous witnesses reject");
