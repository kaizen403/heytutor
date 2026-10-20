import assert from "node:assert/strict";
import { compileSceneDocument, type SceneDocument } from "../../src/index";

function document(hasAxes = true, title?: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", source: { question: "Show a Cartesian curve." },
    visualDecision: { mode: "scene", reason: "Native coordinate frame" }, quantities: [],
    entities: [...(hasAxes ? [{ id: "frame", kind: "axes" as const, role: "coordinate frame", ...(title ? { label: title } : {}) }] : []),
      { id: "curve", kind: "polyline", role: "curve" }],
    constructions: [...(hasAxes ? [{ id: "make_frame", operator: "axes", inputs: { xMin: -1, xMax: 5, yMin: -1, yMax: 5 }, outputs: ["frame"] }] : []),
      { id: "make_curve", operator: "function_curve", inputs: { expression: "exp(-x)", variable: "x", xMin: 0, xMax: 4, samples: 65 }, outputs: ["curve"] }],
    annotations: [], relations: [], assertions: [], requiredEntityIds: hasAxes ? ["frame", "curve"] : ["curve"],
    revealGroups: [{ id: "setup", entityIds: hasAxes ? ["frame", "curve"] : ["curve"], dependsOn: [], narrationCue: "Show the curve." }], teachingTimeline: [],
  };
}

let passed = 0;
const ordinary = document();
const source = JSON.stringify(ordinary);
const result = compileSceneDocument(ordinary);
assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
const letters = result.renderScene.primitives.filter(p => p.kind === "label" && p.entityId === "frame");
assert.deepEqual(letters.map(p => p.text).sort(), ["x", "y"], "A native Cartesian frame identifies both coordinate axes");
assert(letters.every(p => p.groupId === "setup"), "Letters retain their frame's reveal group");
const axes = result.renderScene.primitives.find(p => p.kind === "axes")!;
for (const [name, index] of [["x", 1], ["y", 3]] as const) {
  const letter = letters.find(p => p.text === name)!;
  assert(Math.hypot(letter.points[0]!.x-axes.points[index]!.x, letter.points[0]!.y-axes.points[index]!.y) < 65, "Coordinate names stay by the correct native terminal");
}
assert.equal(JSON.stringify(ordinary), source, "Letter completion never mutates the source document");
passed++;
for (const input of [document(false), document(true, "custom frame")]) {
  const compiled = compileSceneDocument(input);
  assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  assert(!compiled.renderScene.primitives.some(p => p.kind === "label" && p.entityId === "frame" && ["x", "y"].includes(p.text ?? "")),
    "A curve alone cannot invent axes, and a caller-named frame keeps its naming contract");
  passed++;
}
const collision = document();
collision.entities.push({ id: "frame_cartesian_x", kind: "point", role: "independent point", label: "P" });
collision.constructions.push({ id: "make_point", operator: "point", inputs: { x: 2, y: 2, coordinateSpace: "world" }, outputs: ["frame_cartesian_x"] });
collision.requiredEntityIds.push("frame_cartesian_x");
collision.revealGroups[0]!.entityIds.push("frame_cartesian_x");
const collisionResult = compileSceneDocument(collision);
assert(collisionResult.ok && collisionResult.renderScene, JSON.stringify(collisionResult.report.issues));
assert.equal(new Set(collisionResult.renderScene.primitives.map(p=>p.id)).size, collisionResult.renderScene.primitives.length,
  "Optional coordinate identity must never collide with an existing native primitive ID");
assert(collisionResult.renderScene.primitives.some(p=>p.entityId==="frame_cartesian_x"&&p.kind==="point"));
passed++;
console.log(`native-cartesian-labels: ${passed}/4 passed`);
