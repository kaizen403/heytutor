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
 *
 * The completeness round (sections 7 to 9) runs the planner search and the
 * round with a stubbed model call: the request names exactly the missing
 * items and at most six; a reply replaces the figure only when it is valid,
 * misses strictly fewer items and keeps every old id and label; a failed or
 * timed out call keeps the original; and the round does not call with less
 * than SCENE_COMPLETENESS_MIN_REMAINING_MS of the deadline left.
 */
import assert from "node:assert/strict";
import type { SceneDocument, TurnPlanV3 } from "@heytutor/scene-engine";
import {
  buildCompletenessChecklist,
  checkSceneCompleteness,
  COMPLETENESS_REQUEST_CAP,
  type CompletenessChecklist,
  type CompletenessItem,
  type SceneCompletenessResult,
} from "../../src/planners/sceneCompleteness";
import {
  completeScenePlanWithRepairResult,
  decideSceneCompletion,
  SCENE_COMPLETENESS_MIN_REMAINING_MS,
  type SceneCompletenessRoundRecord,
} from "../../src/planners/sceneCompletenessRound";
import {
  buildSceneCompletenessRequest,
  planSceneDocumentWithRepair,
  type SceneCandidateValidation,
  type ScenePlanWithRepairResult,
} from "../../src/planners/scenePlannerV2";

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

/**
 * Named cases: every case runs and each failure is reported by name, and the
 * gate fails after the last case section. A fail-first run against older
 * sources therefore shows every case that fails, not only the first.
 */
const caseFailures: string[] = [];
function runCases(section: string, cases: ReadonlyArray<readonly [string, () => void]>): void {
  for (const [name, run] of cases) {
    try {
      run();
    } catch (error) {
      caseFailures.push(`${section} / ${name}: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`);
    }
  }
}

// 6b. A given angle in radians is asked for, and matched, in degrees; a radian label on the mark still counts.
{
  const question = "A door swings open through θ = π/2 rad about its hinge. Sketch the door before and after.";
  const checklist = buildCompletenessChecklist(plan({ givens: [given("theta", "θ", Math.PI / 2, "rad")] }), null, question);
  const angleItem = () => {
    const angle = checklist.items.find((item) => item.rule === "stated_angle");
    assert(angle && angle.matcher.type === "angle", "the radian given is an angle item");
    return angle as CompletenessItem & { matcher: { type: "angle"; value: number | null } };
  };
  const swing = (label: string) => doc({ entities: [
    { id: "door", kind: "segment", role: "door" }, { id: "turn", kind: "angle_mark", role: "swing angle", label },
  ] });
  runCases("6b radians", [
    ["the request states θ = π/2 rad as 90°", () =>
      assert.equal(angleItem().text, "mark the angle θ = 90° with an angle_mark and label it")],
    ["the matcher holds the angle in degrees", () => {
      const { value } = angleItem().matcher;
      assert(value !== null && Math.abs(value - 90) < 1e-9, `matcher value ${value}`);
    }],
    ["a rounded radian value (1.5708 rad) is asked as a whole 90°", () => {
      const rounded = buildCompletenessChecklist(plan({ givens: [given("theta", "θ", 1.5708, "rad")] }), null, question);
      assert.equal(rounded.items.find((item) => item.rule === "stated_angle")?.text, "mark the angle θ = 90° with an angle_mark and label it");
    }],
    ["a 90° mark satisfies θ = π/2 rad", () => assert.deepEqual(signatures(missingOf(checklist, swing("90°")).missing), [])],
    // Controls: these held before the fix too.
    ["control: a mark labelled in radians still satisfies it", () =>
      assert.deepEqual(signatures(missingOf(checklist, swing("θ = π/2")).missing), [])],
    ["control: a mark with another angle does not", () =>
      assert.deepEqual(signatures(missingOf(checklist, swing("45°")).missing), ["stated_angle:θ"])],
  ]);
}

// 6c. An angle value is matched only on an angle mark: a length, or a number anywhere else, never satisfies it.
{
  const question = "In triangle PQR, angle P = 40° and angle Q = 75°. Sketch the triangle.";
  const checklist = buildCompletenessChecklist(plan({ givens: [given("angP", "∠P", 40, "°"), given("angQ", "∠Q", 75, "°")] }), null, question);
  assert.deepEqual(signatures(checklist.items), ["stated_angle:∠P", "stated_angle:∠Q", "point_name:P", "point_name:Q", "point_name:R"]);
  const vertices = [point("P", "P"), point("Q", "Q"), point("R", "R")];
  const markP = { id: "aP", kind: "angle_mark", role: "given angle", label: "40°" };
  const markQ = { id: "aQ", kind: "angle_mark", role: "given angle" };
  const side = (label?: string) => ({ id: "pq", kind: "segment", role: "side", ...(label ? { label } : {}) });
  type SceneWithQuantities = Doc & { quantities?: Array<Record<string, unknown> & { id: string }> };
  const missingAngles = (scene: SceneWithQuantities, labels: Array<{ text: string; entityId?: string }> = []) =>
    signatures(checkSceneCompleteness(checklist, scene, { primitives: labels.map((label) => ({ kind: "label" as const, ...label })) }).missing);
  const missingQ = ["stated_angle:∠Q"];

  runCases("6c angle marks", [
    // The review's example: only the 40° mark, and a side labelled 75 cm.
    ["a side labelled 75 cm does not stand in for the 75° angle", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, side("75 cm")] })), missingQ)],
    ["nor does a bare 75 on a side", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, side("75")] })), missingQ)],
    ["a length never satisfies an angle, even on a mark (75 cm)", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, { ...markQ, label: "75 cm" }] })), missingQ)],
    ["nor an area on a mark (75 cm²)", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, { ...markQ, label: "75 cm²" }] })), missingQ)],
    ["a bare 75 labelled at the vertex point is not an angle label", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP], annotations: [{ id: "q", kind: "label", targetIds: ["Q"], text: "75" }] })), missingQ)],
    ["a compiled length label owned by the side does not count", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, side()] }), [{ text: "75 cm", entityId: "pq" }]), missingQ)],
    ["a compiled 75° owned by the vertex point, not a mark, does not count", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP] }), [{ text: "75°", entityId: "Q" }]), missingQ)],
    ["an angle assertion between two sides, with no mark on it, does not count", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, side()],
        assertions: [{ id: "q75", predicate: "angle_between", entities: ["pq", "qr"], expected: { value: 75 }, severity: "fatal" }] })), missingQ)],
    ["a bare compiled 75 whose owner is unknown does not count", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, markQ] }), [{ text: "75" }]), missingQ)],
    // Controls: an angle mark carries its value in every way the compiler prints one.
    ["control: the mark's own label", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, { ...markQ, label: "∠Q = 75°" }, side("75 cm")] })), [])],
    ["control: a label annotation aimed at the mark", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, markQ], annotations: [{ id: "lq", kind: "label", targetIds: ["aQ"], text: "75°" }] })), [])],
    ["control: a label operator aimed at the mark", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, markQ],
        constructions: [{ id: "tq", operator: "label", inputs: { target: "aQ", text: "75°" }, outputs: [] }] })), [])],
    ["a text-less label aimed at the mark counts through the quantity it binds", () =>
      assert.deepEqual(missingAngles({ ...doc({ entities: [...vertices, markP, markQ],
        annotations: [{ id: "lq", kind: "label", targetIds: ["aQ"], quantityId: "angQ" }] }),
      quantities: [{ id: "angQ", symbol: "∠Q", value: 75, unit: "°" }] }), [])],
    ["control: an angle assertion on the mark", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, markQ],
        assertions: [{ id: "q75", predicate: "angle_between", entities: ["aQ"], expected: { value: 75 }, severity: "fatal" }] })), [])],
    ["control: a compiled label the mark owns", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, markQ] }), [{ text: "75°", entityId: "aQ" }]), [])],
    ["control: a compiled degree label whose owner is unknown (text only)", () =>
      assert.deepEqual(missingAngles(doc({ entities: [...vertices, markP, markQ] }), [{ text: "75°" }]), [])],
  ]);
}

if (caseFailures.length > 0) {
  throw new assert.AssertionError({ message: `${caseFailures.length} named cases fail\n  ${caseFailures.join("\n  ")}` });
}

console.log("scene completeness: triangle, projectile, free body, circuit, cap of six and negative controls pass");

/* ------------------------------------------------------------------------- */
/* The completeness round                                                    */
/* ------------------------------------------------------------------------- */

// 7. The request block lists exactly the missing items, numbered, at most six, with the keep rule.
{
  const question = "Plot the points A(1, 2), B(3, 4), C(5, 6), D(7, 8), E(9, 1), F(2, 3) and G(4, 5), and join A to G. The angle at D is 35°.";
  const missing = checkSceneCompleteness(buildCompletenessChecklist(plan({}), null, question), doc({})).missing;
  assert(missing.length > COMPLETENESS_REQUEST_CAP, "the fixture misses more items than the cap");
  const text = buildSceneCompletenessRequest(missing);
  const numbered = text.split("\n").filter((line) => /^\d+\. /.test(line));
  assert.deepEqual(numbered, missing.slice(0, COMPLETENESS_REQUEST_CAP).map((item, index) => `${index + 1}. ${item.text}`),
    "the request numbers exactly the first six missing items in priority order");
  for (const item of missing.slice(COMPLETENESS_REQUEST_CAP)) assert(!text.includes(item.text), `nothing beyond the cap: ${item.text}`);
  assert(/add exactly these items; keep everything else as it is; every new mark must come from an existing operator/i.test(text),
    "the request carries the add-exactly, keep-everything, existing-operator rule");
  assert(text.startsWith("COMPLETENESS REQUEST\n"));
}

// Fixture for the round: a triangle whose given angle is the one missing item.
type Value = { document: SceneDocument; renderScene: null; completeness: SceneCompletenessResult };
const roundQuestion = "In triangle ABC, angle B = 50°. Sketch the triangle.";
const roundChecklist = buildCompletenessChecklist(plan({ givens: [given("angB", "∠B", 50, "°")] }), null, roundQuestion);
const triangleDoc = (options: { markAngle?: boolean; dropTriangle?: boolean; relabel?: [string, string]; broken?: boolean; decline?: boolean } = {}): SceneDocument => {
  const entities: SceneDocument["entities"] = (["A", "B", "C"] as const)
    .map((name) => ({ id: name, kind: "point", role: "vertex", label: options.relabel?.[0] === name ? options.relabel[1] : name }));
  if (!options.dropTriangle) entities.push({ id: "tri", kind: "polygon", role: "triangle" });
  if (options.markAngle) entities.push({ id: "angB", kind: "angle_mark", role: "given angle", label: "50°" });
  return {
    schemaVersion: "scene-document/v2", source: { question: roundQuestion },
    visualDecision: options.decline ? { mode: "text_only", reason: "declined" } : { mode: "scene", reason: "the triangle" },
    quantities: [], entities: options.decline ? [] : entities, constructions: [], relations: [],
    assertions: [], annotations: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [],
    ...(options.broken ? { broken: true } : {}),
  } as SceneDocument;
};
const roundValidator = (candidate: Record<string, unknown>): SceneCandidateValidation<Value> => {
  if (candidate.broken) return { valid: false, errors: [{ code: "assertion_failed", message: "stub proof failed", severity: "fatal" }] };
  const document = candidate as unknown as SceneDocument;
  const completeness = checkSceneCompleteness(roundChecklist, document);
  return {
    valid: true, errors: [], qualityScore: completeness.missing.length * 10_000_000 + document.entities.length,
    value: { document, renderScene: null, completeness },
  };
};

type Seen = { phase: string; prompt: string; deadline: string | null };
async function withStubbedPlanner<T>(replies: { plan: SceneDocument; complete?: SceneDocument | "fail" }, run: (seen: Seen[]) => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    const phase = headers.get("x-scene-planner-phase") ?? "";
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    seen.push({ phase, prompt: body.messages.at(-1)!.content, deadline: headers.get("x-planner-deadline-ms") });
    const reply = phase === "complete" ? replies.complete : replies.plan;
    if (!reply || reply === "fail") return new Response("upstream failed", { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    return await run(seen);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/** The planner search (two initial candidates, stubbed), then the round. */
async function plannedRound(complete: SceneDocument | "fail" | undefined, remainingMs = 40_000, budget = 6) {
  return withStubbedPlanner({ plan: triangleDoc(), complete }, async (seen) => {
    const searched = await planSceneDocumentWithRepair(roundQuestion, roundValidator, { proxyUrl: "http://planner.test", timeoutMs: 5_000 });
    assert(searched?.validation.valid, "the stubbed search returns the valid sparse triangle");
    const requestBudget = { remaining: budget };
    const round = await completeScenePlanWithRepairResult(roundQuestion, searched, roundValidator, {
      proxyUrl: "http://planner.test", remainingMs, requestBudget,
    });
    return { searched, round, seen, requestBudget };
  });
}
const keptOriginal = (searched: ScenePlanWithRepairResult<Value>, round: { result: ScenePlanWithRepairResult<Value> }) =>
  round.result.response === searched.response && round.result.validation === searched.validation;
const recordOf = (round: { record: SceneCompletenessRoundRecord | null }) => {
  assert(round.record, "a valid figure with a checklist always gets a record");
  return round.record;
};

// 8. The replacement rule, through the driven planner loop.
{
  // A more complete valid reply replaces the figure.
  const accepted = await plannedRound(triangleDoc({ markAngle: true }));
  const record = recordOf(accepted.round);
  const completeCalls = accepted.seen.filter((call) => call.phase === "complete");
  assert.equal(completeCalls.length, 1, "exactly one completeness call");
  const prompt = completeCalls[0]!.prompt;
  assert(prompt.includes(`PREVIOUS DOCUMENT (VALID)\n${JSON.stringify(accepted.searched.response.document)}`),
    "the call sends the whole valid document, labels included");
  const requested = prompt.split("COMPLETENESS REQUEST")[1]!.split("\n").filter((line) => /^\d+\. /.test(line));
  assert.deepEqual(requested, ["1. mark the angle ∠B = 50° with an angle_mark and label it"],
    "the call lists exactly the missing item");
  assert.deepEqual(record.itemsRequested, ["mark the angle ∠B = 50° with an angle_mark and label it"]);
  assert.equal(record.attempted, true);
  assert.equal(record.accepted, true);
  assert.equal(record.outcome, "replaced");
  assert.deepEqual(record.itemsStillMissing, []);
  assert.equal(accepted.round.result.response.phase, "complete");
  assert.deepEqual(accepted.round.result.validation.value?.completeness.missing, [], "the selected figure is the complete reply");
  assert.deepEqual(accepted.round.result.candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.response.phase), ["complete"],
    "only the reply is selected; the original stays listed, unselected");
  assert.equal(accepted.requestBudget.remaining, 5, "the call spends one request from the shared budget");
  assert(record.extraMs >= 0);

  // Refused: invalid, a decline, not more complete, a lost id, a lost label, a failed call.
  const refusals: Array<[string, SceneDocument | "fail", SceneCompletenessRoundRecord["outcome"]]> = [
    ["an invalid reply", triangleDoc({ markAngle: true, broken: true }), "invalid"],
    ["a text-only reply", triangleDoc({ decline: true }), "invalid"],
    ["an equally incomplete reply", triangleDoc(), "not_more_complete"],
    ["a reply that drops the old polygon id", triangleDoc({ markAngle: true, dropTriangle: true }), "lost_content"],
    ["a reply that drops vertex C", triangleDoc({ markAngle: true, relabel: ["C", ""] }), "not_more_complete"],
    ["a reply that relabels vertex A", triangleDoc({ markAngle: true, relabel: ["A", "A′"] }), "lost_content"],
    ["a failed call", "fail", "timeout"],
  ];
  for (const [name, reply, outcome] of refusals) {
    const refused = await plannedRound(reply);
    const refusedRecord = recordOf(refused.round);
    assert.equal(refusedRecord.outcome, outcome, `${name}: ${outcome}`);
    assert.equal(refusedRecord.accepted, false, `${name} never replaces the figure`);
    assert(keptOriginal(refused.searched, refused.round), `${name}: the original figure is kept`);
    assert.deepEqual(refusedRecord.itemsStillMissing, refusedRecord.itemsMissingBefore, `${name}: nothing counts as added`);
    assert.equal(refused.round.result.candidates.filter((candidate) => candidate.selected).length, 1);
  }
  const lost = recordOf((await plannedRound(triangleDoc({ markAngle: true, dropTriangle: true }))).round);
  assert.deepEqual(lost.lostIds, ["tri"], "the dropped id is named");
  const relabelled = recordOf((await plannedRound(triangleDoc({ markAngle: true, relabel: ["A", "A′"] }))).round);
  assert.deepEqual(relabelled.lostLabels, ["A"], "the dropped label text is named");

  // The pure rule agrees, and a reply that is merely different never wins.
  const original = roundValidator(triangleDoc() as unknown as Record<string, unknown>);
  assert.equal(decideSceneCompletion(original, roundValidator(triangleDoc({ markAngle: true }) as unknown as Record<string, unknown>)).accept, true);
  assert.equal(decideSceneCompletion(original, null).outcome, "timeout");
  assert.equal(decideSceneCompletion(original, original).outcome, "not_more_complete", "the same figure is not more complete");
}

// 9. The deadline floor, the budget and a figure that misses nothing: no call at all.
{
  const floor = SCENE_COMPLETENESS_MIN_REMAINING_MS;
  assert.equal(floor, 20_000, "the round needs at least 20 s of the figure deadline");
  const short = await plannedRound(triangleDoc({ markAngle: true }), floor - 1);
  assert.equal(recordOf(short.round).outcome, "skipped_deadline");
  assert.equal(recordOf(short.round).attempted, false);
  assert.equal(short.seen.filter((call) => call.phase === "complete").length, 0, "no completeness call with less than 20 s left");
  assert(keptOriginal(short.searched, short.round), "a skipped round keeps the original");
  assert.equal(short.requestBudget.remaining, 6, "a skipped round spends nothing");

  const atFloor = await plannedRound(triangleDoc({ markAngle: true }), floor);
  const call = atFloor.seen.find((entry) => entry.phase === "complete");
  assert(call, "exactly 20 s left still runs the round");
  assert.equal(call.deadline, "17000", "the call ends 3 s before the figure deadline");
  const roomy = await plannedRound(triangleDoc({ markAngle: true }), 55_000);
  assert.equal(roomy.seen.find((entry) => entry.phase === "complete")?.deadline, "20000", "the call never waits more than 20 s");

  const spent = await plannedRound(triangleDoc({ markAngle: true }), 40_000, 0);
  assert.equal(recordOf(spent.round).outcome, "skipped_budget");
  assert.equal(spent.seen.filter((entry) => entry.phase === "complete").length, 0, "no call once the turn's budget is spent");

  const nothingMissing = await withStubbedPlanner({ plan: triangleDoc({ markAngle: true }) }, async (seen) => {
    const searched = await planSceneDocumentWithRepair(roundQuestion, roundValidator, { proxyUrl: "http://planner.test", timeoutMs: 5_000 });
    assert(searched);
    const round = await completeScenePlanWithRepairResult(roundQuestion, searched, roundValidator, { proxyUrl: "http://planner.test", remainingMs: 40_000 });
    return { round, seen };
  });
  assert.equal(recordOf(nothingMissing.round).outcome, "complete");
  assert.equal(nothingMissing.seen.filter((entry) => entry.phase === "complete").length, 0, "a complete figure is never re-asked");
}

console.log("scene completeness round: request lists the missing items under the cap, the replacement rule, failures keep the original, the 20 s floor skips the call");
