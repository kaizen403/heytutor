/**
 * The completeness checklist reads structured plan data first and narrow,
 * generic stem patterns second, then checks a scene document against it.
 *
 * Every fixture here is invented for this gate (not copied from an eval row):
 * a triangle with given angles and named vertices, a projectile, a free body
 * with named forces, and a circuit with given currents. Each builds a checklist,
 * then a complete scene (nothing missing) and an incomplete one (exactly the
 * right items missing, in priority order). Negative controls: constants,
 * givens the stem never writes, coordinate components, generic force, current
 * in a circuit and velocity from units alone are never demanded; nothing is
 * requested beyond six items.
 */
import assert from "node:assert/strict";
import type { SceneDocument, TurnPlanV3 } from "@heytutor/scene-engine";
import {
  buildCompletenessChecklist,
  checkSceneCompleteness,
  COMPLETENESS_REQUEST_CAP,
  type CompletenessChecklist,
  type CompletenessItem,
} from "../../src/planners/sceneCompleteness";

type Plan = Pick<TurnPlanV3, "givens" | "unknowns" | "derived" | "lawIds">;
type Doc = Pick<SceneDocument, "entities" | "constructions" | "annotations" | "assertions">;

const plan = (partial: Partial<Plan>): Plan => ({ givens: [], unknowns: [], derived: [], lawIds: [], ...partial });
const given = (id: string, symbol: string, value: number, unit: string, provenance: "given" | "derived" = "given") =>
  ({ id, symbol, value, unit, provenance });
const point = (id: string, label?: string) => ({ id, kind: "point", role: "vertex", ...(label ? { label } : {}) });
const doc = (partial: Partial<Doc>): Doc => ({ entities: [], constructions: [], annotations: [], assertions: [], ...partial });

/** rule:symbol-or-name-or-word, the stable shape of an item for assertions. */
const signature = (item: CompletenessItem): string => {
  const { matcher } = item;
  const detail = matcher.type === "name" ? matcher.name
    : matcher.type === "vector" || matcher.type === "construction" ? matcher.word
      : matcher.type === "equation" ? matcher.equation
        : matcher.type === "coordinate" ? matcher.values.join(",")
          : item.symbol ?? (matcher.type === "angle" || matcher.type === "value" ? String(matcher.value) : "");
  return `${item.rule}:${detail}`;
};
const signatures = (items: readonly CompletenessItem[]) => items.map(signature);
const missingOf = (checklist: CompletenessChecklist, scene: Doc, labels: string[] = []) =>
  checkSceneCompleteness(checklist, scene, { primitives: labels.map((text) => ({ kind: "label" as const, text })) });

// 1. Triangle: given angles from the plan, the asked angle with its solved value, named vertices from the stem.
{
  const question = "In triangle PQR, angle P = 40° and angle Q = 75°. Find angle R.";
  const checklist = buildCompletenessChecklist(plan({
    givens: [given("angP", "∠P", 40, "°"), given("angQ", "∠Q", 75, "°")],
    unknowns: [{ id: "angR", symbol: "∠R", unit: "°" }],
    derived: [given("angR", "∠R", 65, "°", "derived")],
  }), null, question);
  assert.deepEqual(signatures(checklist.items), [
    "stated_angle:∠P", "stated_angle:∠Q", "asked_angle:∠R", "point_name:P", "point_name:Q", "point_name:R",
  ], "triangle: plan angles once each (the stem's 40° and 75° are not repeated), the asked angle, then the vertices");
  assert.equal(checklist.items[0]!.text, "mark the angle ∠P = 40° with an angle_mark and label it");
  assert.equal(checklist.items[2]!.text, "mark the asked angle ∠R with an angle_mark labelled 65°");
  assert(checklist.items.every((item) => item.text.length > 0 && item.text.length <= 80), "every request is short");

  const angleMark = (id: string, label: string) => ({ id, kind: "angle_mark", role: "interior angle", label });
  const complete = doc({ entities: [
    point("P", "P"), point("Q", "Q"), point("R", "R"), { id: "tri", kind: "polygon", role: "triangle" },
    angleMark("aP", "40°"), angleMark("aQ", "75°"), angleMark("aR", "65°"),
  ] });
  assert.deepEqual(missingOf(checklist, complete).missing, [], "the complete triangle misses nothing");

  const incomplete = doc({ entities: [point("P", "P"), point("Q", "Q"), point("R"), angleMark("aP", "40°")] });
  const result = missingOf(checklist, incomplete);
  assert.deepEqual(signatures(result.missing), ["stated_angle:∠Q", "point_name:R", "asked_angle:∠R"],
    "incomplete triangle: the unmarked given angle first, then the unlabelled vertex, then the asked angle");
  assert.deepEqual(result.request, result.missing);

  // A compiled label counts: the planner wrote it and layout kept it.
  assert(!signatures(missingOf(checklist, incomplete, ["R"]).missing).includes("point_name:R"),
    "a compiled vertex label satisfies the name");
  // The asked angle's value may come from an angle assertion the compiler prints on the mark.
  const asserted = doc({ entities: [...complete.entities.filter((entity) => entity.id !== "aR"),
    { id: "aR", kind: "angle_mark", role: "interior angle" }],
  assertions: [{ id: "r", predicate: "angle_between", entities: ["aR"], expected: { value: 65 }, severity: "fatal" }] });
  assert.deepEqual(missingOf(checklist, asserted).missing, [], "an angle_between value counts as the printed angle");
}

// 2. Projectile: speed and launch angle are demanded; g, an unstated given, and velocity from units are not.
{
  const question = "A ball is thrown from the ground with speed 20 m/s at 30° above the horizontal. Find its maximum height. Take g = 9.8 m/s².";
  const checklist = buildCompletenessChecklist(plan({
    givens: [
      given("u", "u", 20, "m/s"), given("theta", "θ", 30, "°"), given("g", "g", 9.8, "m/s²"),
      // A value the solution needs but the stem never writes is not source grounded.
      given("tUp", "t_up", 1.02, "s"),
    ],
    unknowns: [{ id: "H", symbol: "H", unit: "m" }],
  }), null, question);
  assert.deepEqual(signatures(checklist.items), ["given_value:u", "stated_angle:θ"],
    "projectile: the speed label and the launch angle only");
  assert(!checklist.items.some((item) => item.symbol === "g"), "negative control: the constant g is never demanded as a label");
  assert(!checklist.items.some((item) => item.symbol === "t_up"),
    "negative control: a time the stem never writes has no place on the figure and is not demanded");
  assert(!checklist.items.some((item) => item.kind === "vector"),
    "negative control: a velocity unit alone does not demand an arrow");

  const complete = doc({ entities: [
    { id: "ground", kind: "line", role: "ground" }, { id: "path", kind: "polyline", role: "trajectory" },
    { id: "u", kind: "vector", role: "launch velocity", label: "u = 20 m/s" },
    { id: "launch", kind: "angle_mark", role: "launch angle", label: "θ = 30°" },
  ] });
  assert.deepEqual(missingOf(checklist, complete).missing, []);
  // Values match numerically, not as strings: 20.0 m/s and π/6 rad are the same givens.
  const reformatted = doc({ entities: [
    { id: "u", kind: "vector", role: "launch velocity", label: "u = 20.0 m/s" },
    { id: "launch", kind: "angle_mark", role: "launch angle", label: "π/6" },
  ] });
  assert.deepEqual(missingOf(checklist, reformatted).missing, [], "20.0 matches 20 and π/6 matches 30°");
  const unmarked = doc({ entities: [{ id: "u", kind: "vector", role: "launch velocity", label: "u = 20 m/s" }] });
  assert.deepEqual(signatures(missingOf(checklist, unmarked).missing), ["stated_angle:θ"], "a missing angle mark is reported");
}

// 3. Free body: the named forces become vector items; the generic word force does not.
{
  const question = "A 4 kg crate rests on a rough plane inclined at 25° to the horizontal. Show the weight, the normal reaction and the friction force acting on the crate.";
  const checklist = buildCompletenessChecklist(plan({
    givens: [given("m", "m", 4, "kg"), given("alpha", "α", 25, "°"), given("g", "g", 9.81, "m/s²")],
    unknowns: [{ id: "f", symbol: "f", unit: "N" }],
  }), null, question);
  assert.deepEqual(signatures(checklist.items), [
    "given_value:m", "stated_angle:α", "vector:weight", "vector:friction", "vector:normal_force",
  ], "free body: the written mass and angle, then the three named forces");
  assert(!checklist.items.some((item) => item.matcher.type === "vector" && item.matcher.word === "force"),
    "negative control: generic force is never demanded (it measured 23% judge agreement)");
  assert.equal(checklist.items.find((item) => item.rule === "vector")!.text, "draw the weight vector arrow");

  const arrow = (id: string, role: string, label: string) => ({ id, kind: "vector", role, label });
  const forces = [arrow("W", "weight", "mg"), arrow("N", "normal reaction", "N"), arrow("f", "friction", "f")];
  const complete = doc({ entities: [
    { id: "crate", kind: "rectangle", role: "crate", label: "4 kg" }, { id: "slope", kind: "segment", role: "incline" },
    { id: "tilt", kind: "angle_mark", role: "incline angle", label: "25°" }, ...forces,
  ] });
  assert.deepEqual(missingOf(checklist, complete).missing, [], "the complete free body misses nothing");
  const noFriction = doc({ entities: complete.entities.filter((entity) => entity.id !== "f") });
  assert.deepEqual(signatures(missingOf(checklist, noFriction).missing), ["vector:friction"],
    "the missing friction arrow is the only missing item");
  const unlabelledCrate = doc({ entities: complete.entities.map((entity) =>
    entity.id === "crate" ? { id: "crate", kind: "rectangle", role: "crate" } : entity) });
  assert.deepEqual(signatures(missingOf(checklist, unlabelledCrate).missing), ["given_value:m"],
    "the design keeps a written mass: judges listed it missing 92% of the time when absent");
}

// 4. Circuit: given currents are value labels and resistor names are points; current is not demanded as an arrow.
{
  const question = "In a circuit, a current of 2 A flows through resistor R1 and 3 A flows through resistor R2. Both currents combine at J and pass through resistor R3. Find the current in R3.";
  const checklist = buildCompletenessChecklist(plan({
    givens: [given("I1", "I₁", 2, "A"), given("I2", "I₂", 3, "A")],
    unknowns: [{ id: "I3", symbol: "I₃", unit: "A" }],
  }), null, question);
  assert.deepEqual(signatures(checklist.items), [
    "given_value:I₁", "given_value:I₂", "point_name:R1", "point_name:R2", "point_name:R3", "point_name:J",
  ], "circuit: the two given currents, then the named resistors, then the junction");
  assert(!checklist.items.some((item) => item.kind === "vector"),
    "negative control: current in a circuit is a branch label, not a demanded vector");

  const resistor = (id: string, label: string) => ({ id, kind: "resistor", role: "resistor", label });
  const complete = doc({
    entities: [resistor("r1", "R₁"), resistor("r2", "R₂"), resistor("r3", "R₃"), point("J", "J")],
    annotations: [
      { id: "i1", kind: "label", targetIds: ["r1"], text: "I₁ = 2 A" },
      { id: "i2", kind: "label", targetIds: ["r2"], text: "I₂ = 3 A" },
      { id: "say", kind: "narration", targetIds: [], text: "R3 carries 5 A" },
    ],
  });
  assert.deepEqual(missingOf(checklist, complete).missing, [], "subscript labels R₁ match the stem's R1");
  const narratedOnly = doc({ ...complete, annotations: complete.annotations.filter((annotation) => annotation.id !== "i2") });
  assert.deepEqual(signatures(missingOf(checklist, narratedOnly).missing), ["given_value:I₂"],
    "narration is not visible text, so the second current is still missing");
}

// 5. The request is capped at six, in priority order; the full missing list is kept.
{
  const question = "Plot the points A(1, 2), B(3, 4), C(5, 6), D(7, 8), E(9, 1), F(2, 3) and G(4, 5), and join A to G. The angle at D is 35°.";
  const checklist = buildCompletenessChecklist(plan({}), null, question);
  const result = checkSceneCompleteness(checklist, doc({}));
  assert.equal(COMPLETENESS_REQUEST_CAP, 6);
  assert.equal(result.missing.length, checklist.items.length, "an empty scene misses every item");
  assert(result.missing.length > COMPLETENESS_REQUEST_CAP, "the fixture has more items than the cap");
  assert.equal(result.request.length, COMPLETENESS_REQUEST_CAP, "nothing is requested beyond six");
  assert.deepEqual(signatures(result.request), [
    "stated_angle:35", "coordinate:1,2", "coordinate:3,4", "coordinate:5,6", "coordinate:7,8", "coordinate:9,1",
  ], "the given angle outranks coordinates, and coordinates keep stem order");
  assert(!checklist.items.some((item) => item.rule === "point_name" && ["A", "B", "C"].includes(item.symbol ?? "")),
    "a point that carries coordinates is one coordinate item, not also a name item");
}

// 6. Coordinate components and plan law words.
{
  const question = "The line through P(2, -1) is perpendicular to 3x + 4y = 12. Find the foot of the perpendicular from P.";
  const checklist = buildCompletenessChecklist(plan({
    givens: [given("xP", "x_P", 2, ""), given("yP", "y_P", -1, "")],
    lawIds: ["normal form of a line"],
  }), null, question);
  assert(!checklist.items.some((item) => item.rule === "given_value"),
    "negative control: coordinate components are part of the point item, not separate value labels");
  assert.deepEqual(signatures(checklist.items), [
    "right_angle:", "coordinate:2,-1", "construction:perpendicular", "construction:normal", "equation:3x + 4y = 12",
  ], "the stated right angle, the point, the perpendicular, the plan's normal law and the stem equation");
  const scene = doc({
    entities: [point("P", "P(2, −1)"), { id: "foot", kind: "point", role: "foot of perpendicular", label: "F" },
      { id: "line", kind: "line", role: "given line", label: "3x + 4y = 12" },
      { id: "ra", kind: "right_angle_mark", role: "right angle" }],
    constructions: [{ id: "drop", operator: "perpendicular_through", inputs: {}, outputs: ["perp"] }],
  });
  assert.deepEqual(missingOf(checklist, scene).missing, [], "the unicode minus and the right-angle mark satisfy the items");
}

console.log("scene completeness: triangle, projectile, free body, circuit, cap of six and negative controls pass");
