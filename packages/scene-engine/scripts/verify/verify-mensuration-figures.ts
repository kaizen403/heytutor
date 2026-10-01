/** Public synthesis seam: the same fallback used when a live planner declines. */
import assert from "node:assert/strict";
import { synthesizeFamilyScene, type TurnPlanV3 } from "../../src/index";

const question = "A solid consists of a cylinder of radius 3 cm and height 8 cm, topped by a cone of height 4 cm. Find its volume and total exposed surface area, including the bottom.";
const turnPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
  givens: [
    { id: "r", symbol: "r", value: 3, unit: "cm", provenance: "given" },
    { id: "h_cyl", symbol: "h_cyl", value: 8, unit: "cm", provenance: "given" },
    { id: "h_cone", symbol: "h_cone", value: 4, unit: "cm", provenance: "given" },
  ], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
};
const figure = synthesizeFamilyScene({ question, turnPlan, families: ["solid_figure"] });
assert(figure, "the named mensuration solid must have a usable scene");
const readable = figure.renderScene.primitives.filter((primitive) =>
  (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text?.trim());
assert(readable.length > 0, "live readable-figure guard must accept the diagram instead of leaving the board empty");
const solids = figure.document.constructions.filter((c) => c.operator === "solid_projection");
assert.equal(solids.length, 2, "both named solids must be visible");
const cylinder = solids.find((c) => c.inputs.kind === "cylinder");
const cone = solids.find((c) => c.inputs.kind === "cone");
assert(cylinder && cone);
assert.equal(cylinder.inputs.radius, 3);
assert.equal(cylinder.inputs.height, 8);
assert.equal(cone.inputs.radius, 3);
assert.equal(cone.inputs.height, 4);
const centerOf = (id: unknown) => figure.document.constructions.find((c) => c.outputs.includes(String(id)))?.inputs;
const cylinderBase = centerOf(cylinder.inputs.center);
const coneBase = centerOf(cone.inputs.center);
assert(cylinderBase && coneBase);
assert.equal(coneBase.x, cylinderBase.x, "joined solids must share their axis");
assert.equal(coneBase.y, Number(cylinderBase.y) + 8, "cone base must coincide with the cylinder top");
assert(readable.some((p) => p.text?.includes("3 cm")));
assert(readable.some((p) => p.text?.includes("8 cm")));
assert(readable.some((p) => p.text?.includes("4 cm")));
const coneLabel = figure.renderScene.primitives.find((p) => p.entityId === "cone" && p.kind === "label");
const coneBaseEllipse = figure.renderScene.primitives.find((p) => p.entityId === "cone" && p.kind === "polyline" && p.points.length > 2);
assert(coneLabel && coneBaseEllipse);
assert(coneLabel.points[0]!.y < coneBaseEllipse.points[0]!.y, "the cone's name must stay beside the cone rather than inside the cylinder");
assert.deepEqual(synthesizeFamilyScene({ question, turnPlan, families: ["solid_figure"] })?.renderScene, figure.renderScene);

for (const variant of [
  "A cone of height 4 cm is mounted on a cylinder of radius 3 cm and height 8 cm. Find the volume and surface area.",
  "A cylinder of height 8 cm is topped by a cone of radius 3 cm and height 4 cm. Find its volume.",
]) {
  const composite = synthesizeFamilyScene({ question: variant, families: ["solid_figure"] });
  assert(composite, "word order and a common radius on either solid must preserve the composite");
  const projections = composite.document.constructions.filter((c) => c.operator === "solid_projection");
  assert.equal(projections.length, 2);
  assert(projections.every((c) => c.inputs.radius === 3));
  assert.equal(projections.find((c) => c.inputs.kind === "cylinder")?.inputs.height, 8);
  assert.equal(projections.find((c) => c.inputs.kind === "cone")?.inputs.height, 4);
}

for (const [kind, stem] of [
  ["cylinder", "A cylinder has radius 5 cm and height 12 cm. Find its volume."],
  ["cone", "A right circular cone has radius 3 cm and height 4 cm. Find its surface area."],
  ["sphere", "A sphere has radius 6 cm. Find its volume."],
  ["hemisphere", "A hemisphere has radius 7 cm. Find its surface area."],
  ["frustum", "A frustum has lower radius 5 cm, upper radius 2 cm, and height 6 cm. Find its volume."],
]) {
  const single = synthesizeFamilyScene({ question: stem!, families: ["solid_figure"] });
  assert(single, `${kind} must compile with readable source dimensions`);
  assert(single.renderScene.primitives.some((p) => p.text?.includes("cm")));
  const solid = single.document.constructions.find((c) => c.operator === "solid_projection");
  assert.equal(solid?.inputs.kind, kind);
  if (kind === "sphere" || kind === "hemisphere") assert.equal(solid?.inputs.height, undefined);
}

const diameter = synthesizeFamilyScene({ question: "A cylinder has diameter 6 cm and height 8 cm. Find its volume.", families: ["solid_figure"] });
assert.equal(diameter?.document.constructions.find((c) => c.operator === "solid_projection")?.inputs.radius, 3);
const mixedUnits = synthesizeFamilyScene({ question: "A cylinder of radius 3 cm and height 80 mm is topped by a cone of height 0.04 m. Find the volume.", families: ["solid_figure"] });
assert(mixedUnits);
assert.equal(mixedUnits.document.constructions.find((c) => c.inputs.kind === "cylinder")?.inputs.height, 8);
assert.equal(mixedUnits.document.constructions.find((c) => c.inputs.kind === "cone")?.inputs.height, 4);
const missing = synthesizeFamilyScene({ question: "A frustum has radius 5 cm and height 6 cm. Find its volume.", families: ["solid_figure"] });
assert(!missing?.document.constructions.some((c) => c.operator === "solid_projection"), "never invent the unstated second radius");
const stalePlan = { ...turnPlan, givens: turnPlan.givens.map((q) => ({ ...q, value: 99 })) };
assert.deepEqual(synthesizeFamilyScene({ question, turnPlan: stalePlan, families: ["solid_figure"] })?.renderScene, figure.renderScene, "stale planner numbers must not override the source dimensions");
const repeated = synthesizeFamilyScene({ question: question + " The cone has height 4 cm; the cylinder has height 8 cm.", families: ["solid_figure"] });
assert.deepEqual(repeated?.renderScene, figure.renderScene, "repeating a solid name must not move its dimensions onto the other part");
const melting = synthesizeFamilyScene({ question: "A sphere of radius 6 cm is melted into identical cones of radius 3 cm and height 4 cm. Find the number of cones.", families: ["solid_figure"] });
assert(melting);
assert.equal(melting.document.constructions.find((c) => c.inputs.kind === "sphere")?.inputs.radius, 6);
assert.equal(melting.document.constructions.find((c) => c.inputs.kind === "cone")?.inputs.radius, 3);
const multiple = synthesizeFamilyScene({ question: "A solid consists of two cylinders of radius 3 cm and height 8 cm. Find its volume.", families: ["solid_figure"] });
assert(!multiple?.document.constructions.some((c) => c.operator === "solid_projection"), "never show one cylinder as a two-cylinder assembly");
for (const stem of [
  "A cube has edge 5 cm. Find its volume and surface area.",
  "A cuboid has length 8 cm, width 5 cm and height 3 cm. Find its surface area.",
  "A square pyramid has base side 6 cm and height 4 cm. Find its volume.",
  "A regular hexagonal prism has base side 4 cm and height 10 cm. Find its volume.",
  "A right triangular prism has base 6 cm, base height 8 cm and length 10 cm. Find its volume.",
]) {
  // Live uses source-grounded ProblemIR kind=solid to select this family;
  // this does not rely on adding names to the fallback keyword router.
  const polyhedral = synthesizeFamilyScene({ question: stem, problemIR: { entities: [{ id: "body", kind: "solid" }] } });
  assert(polyhedral?.document.constructions.some((c) => c.operator === "solid_projection" && c.inputs.kind === "polyhedron"), `${stem}: missing labelled polyhedral solid`);
  assert(polyhedral.renderScene.primitives.some((p) => p.kind === "dimension"));
  assert(polyhedral.renderScene.primitives.some((p) => p.text?.includes("cm")));
  assert(synthesizeFamilyScene({ question: stem })?.document.constructions.some((c) => c.operator === "solid_projection" && c.inputs.kind === "polyhedron"), "source dimensions must still supply structure when the planner is unavailable");
}
const hollowFigure = synthesizeFamilyScene({ question: "A hollow cylinder has outer radius 5 cm, inner radius 3 cm and height 8 cm. Find its volume.", families: ["solid_figure"] });
assert.equal(hollowFigure?.document.constructions.find((c) => c.operator === "solid_projection")?.inputs.innerRadius, 3, "hollow cylinders must show their actual cavity");
const irregular = synthesizeFamilyScene({ question: "An irregular hexagonal prism has one side 4 cm and height 10 cm. Find its volume.", families: ["solid_figure"] });
assert(!irregular?.document.constructions.some((c) => c.operator === "solid_projection" && c.inputs.kind === "polyhedron"), "one edge must not be invented into a regular base");
const garden = synthesizeFamilyScene({ question: "A rectangular garden is 12 m long and 8 m wide. A circular pond of radius 2 m is at its centre. Find the garden area excluding the pond." });
assert(garden?.document.constructions.some((c) => c.operator === "rectangle"));
assert(garden?.document.constructions.some((c) => c.operator === "circle"));
for (const stem of [
  "A cylinder has radius 3 cm, radius 5 cm and height 8 cm. Find its volume.",
  "A cylinder of radius 3 cm and height 8 cm is topped by another cylinder of radius 3 cm and height 8 cm. Find its volume.",
  "A cube has length 8 cm, width 5 cm and height 3 cm. Find its volume.",
  "A cube has edge 5 cm and height 3 cm. Find its surface area.",
]) {
  const ambiguous = synthesizeFamilyScene({ question: stem, families: ["solid_figure"] });
  assert(!ambiguous?.document.constructions.some((c) => c.operator === "solid_projection"), `${stem}: conflicting or multiple bodies must not collapse into an invented source solid`);
}
console.log("mensuration figure regression verification passed");
