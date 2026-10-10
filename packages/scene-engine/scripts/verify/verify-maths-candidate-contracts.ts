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
    // Scanning for the witness reads points without side effects: an
    // unrelated unit-bearing point does not fail the document, while a
    // unit-bearing witness keeps the plain Cartesian refusal.
    const unrelated = structuredClone(scene);
    unrelated.quantities = [{ id: "qx", symbol: "d", value: 2, unit: "m", provenance: "given" }];
    unrelated.entities.push({ id: "q", kind: "point", role: "marker" });
    unrelated.constructions.push({ id: "q_make", operator: "point", inputs: { x: "qx", y: 0, coordinateSpace: "world" }, outputs: ["q"] });
    assert.deepEqual(validateCircleSourceBinding(unrelated), [], "unrelated unit-bearing point must not fail membership");
    const unitWitness = structuredClone(scene);
    unitWitness.quantities = [{ id: "qx", symbol: "x", value: x, unit: "m", provenance: "given" }];
    unitWitness.constructions[1]!.inputs.x = "qx";
    assert(validateCircleSourceBinding(unitWitness).some(i => i.code === "circle_source_mismatch"), "unit-bearing witness still rejected");
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
// Curve-anchor labels: kπ/n is read exactly inside coordinate claims, and a
// value within floating evaluation error of zero at the stated x is zero.
function sineScene(anchors: Array<[number, string]>): SceneDocument {
  const scene = document();
  scene.source.question = "Sketch the graph of y = sin x for 0 <= x <= 2π and mark its zeros and turning points.";
  scene.entities = [{ id: "curve", kind: "polyline", role: "graph" }, ...anchors.map((_, index) => ({ id: `p${index}`, kind: "point" as const, role: "anchor" }))];
  scene.constructions = [
    { id: "curve_make", operator: "function_curve", inputs: { expression: "sin(x)", xMin: 0, xMax: 2 * Math.PI }, outputs: ["curve"] },
    ...anchors.map(([at], index) => ({ id: `p${index}_make`, operator: "curve_anchor", inputs: { curve: "curve", at }, outputs: [`p${index}`] })),
  ];
  scene.annotations = anchors.map(([, text], index) => ({ id: `l${index}`, kind: "label", targetIds: [`p${index}`], text }));
  scene.requiredEntityIds = ["curve"];
  scene.revealGroups = [{ id: "scene", entityIds: scene.entities.map((entity) => entity.id), dependsOn: [], narrationCue: "graph" }];
  scene.teachingTimeline = [{ id: "reveal", action: "reveal", targetId: "scene", dependsOn: [], narrationIntent: "graph" }];
  return scene;
}
const compiles = (scene: SceneDocument): boolean => {
  const validated = validateSceneDocument(scene);
  return validated.document !== null && compileSceneDocument(validated.document).ok;
};
assert(compiles(sineScene([[Math.PI, "(π, 0)"], [Math.PI / 2, "(π/2, 1)"], [3 * Math.PI / 2, "(3π/2, −1)"], [2 * Math.PI, "(2π, 0)"]])), "exact sine anchors with π labels compile");
assert(compiles(sineScene([[Math.PI, "≈(3.14, 0)"]])), "sin π is certified zero at its stated x");
for (const [at, text, reason] of [
  [Math.PI, "(π, 1)", "wrong value at π"],
  [Math.PI / 2, "(π/2, 0.9)", "wrong turning value"],
  [Math.PI, "(π, 0.000001)", "a nonzero claim at a certified zero"],
  [3, "(3, 0)", "sin 3 is not zero"],
  [Math.PI / 2, "(π, 1)", "wrong coordinate"],
] as Array<[number, string, string]>) assert(!compiles(sineScene([[at, text]])), `label must reject: ${reason}`);
console.log("maths candidate contracts: source membership, optional Cartesian basis and exact curve-anchor labels pass; false/ambiguous witnesses reject");
