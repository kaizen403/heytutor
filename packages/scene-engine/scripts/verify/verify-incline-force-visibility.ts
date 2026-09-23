import assert from "node:assert/strict";
import { compileSceneDocument, synthesizeFamilyScene } from "../../src";

const questions = [
  "Explain how to draw a free-body diagram for a block on a rough incline, and show how friction enters Newton's second law.",
  "A block rests on a rough inclined plane. Show its forces.",
];
for (const question of questions) {
  const scene = synthesizeFamilyScene({ question, families: ["contact_body"] });
  assert(scene, "the generic incline family must compile");
  const arrows = scene.renderScene.primitives.filter((primitive) => primitive.kind === "vector");
  assert(arrows.some((primitive) => primitive.entityId === "normal"), "a normal reaction is a visible force, not an optical construction helper");
  assert(arrows.some((primitive) => primitive.entityId === "friction"), "a rough incline FBD must include friction");
  const incline = scene.renderScene.primitives.find((primitive) => primitive.entityId === "incline" && primitive.kind === "line");
  assert(incline);
  const delta = (points: typeof incline.points) => ({ x: points[1]!.x - points[0]!.x, y: points[1]!.y - points[0]!.y });
  const slope = delta(incline.points);
  const normal = delta(arrows.find((primitive) => primitive.entityId === "normal")!.points);
  const friction = delta(arrows.find((primitive) => primitive.entityId === "friction")!.points);
  assert(Math.abs(slope.x * normal.x + slope.y * normal.y) / Math.hypot(slope.x, slope.y) / Math.hypot(normal.x, normal.y) < 0.001);
  assert(Math.abs(slope.x * friction.y - slope.y * friction.x) / Math.hypot(slope.x, slope.y) / Math.hypot(friction.x, friction.y) < 0.001);
  assert(scene.document.revealGroups.some((group) => /if|case/i.test(group.narrationCue) && /friction/i.test(group.narrationCue)), "friction direction must be explained conditionally");
  // The same operator still hides an optical construction helper.
  const helperDocument = structuredClone(scene.document);
  helperDocument.entities.find((entity) => entity.id === "normal")!.role = "surface normal";
  const helper = compileSceneDocument(helperDocument);
  assert(helper.renderScene);
  assert(!helper.renderScene.primitives.some((primitive) => primitive.entityId === "normal"), "optical surface normals retain their helper behavior");
}
const smooth = synthesizeFamilyScene({ question: "A block rests on a smooth incline.", families: ["contact_body"] });
assert(smooth);
assert(!smooth.document.entities.some((entity) => entity.id === "friction"), "a smooth incline must not invent friction");
console.log("verified visible normal reactions and conditional rough-incline friction");
