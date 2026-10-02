import { strict as assert } from "node:assert";
import {
  evaluateCircleConstruction,
  validateCircleConstruction,
  type CircleEvaluationContext,
  type CircleGeometry,
} from "../../src/compile/circleGeometry";
import type { RenderPoint, RenderPrimitive, SceneConstruction, SceneDocument, SceneIssue } from "../../src/types";

const geometry = new Map<string, CircleGeometry>();
const quantities = new Map<string, number>([["extent", 8]]);
const context: CircleEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    const result = typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value);
    if (!Number.isFinite(result)) throw new Error("non-numeric input");
    return result;
  },
  point(value) {
    if (typeof value === "string") {
      const resolved = geometry.get(value);
      if (resolved?.kind === "point") return resolved.point;
      throw new Error("not a point");
    }
    if (Array.isArray(value) && value.length === 2) return { x: Number(value[0]), y: Number(value[1]) };
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) return { x: Number(value.x), y: Number(value.y) };
    throw new Error("not a point");
  },
  geometry(value) { return typeof value === "string" ? geometry.get(value) : undefined; },
};
let checks = 0;
function close(actual: number, expected: number, message: string, tolerance = 1e-8): void {
  checks++;
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function evaluate(operator: string, inputs: Record<string, unknown>): CircleGeometry[] {
  return evaluateCircleConstruction(operator, inputs, context);
}
function reject(operator: string, inputs: Record<string, unknown>): void {
  checks++;
  assert.throws(() => evaluate(operator, inputs), undefined, `${operator} must reject ${JSON.stringify(inputs)}`);
}
function distance(a: RenderPoint, b: RenderPoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function transformed(point: RenderPoint, scale: number, angle: number, origin: RenderPoint): RenderPoint {
  const radians = angle * Math.PI / 180;
  return {
    x: origin.x + scale * (point.x * Math.cos(radians) - point.y * Math.sin(radians)),
    y: origin.y + scale * (point.x * Math.sin(radians) + point.y * Math.cos(radians)),
  };
}

// A 6-by-8 right triangle has circumradius 5 and center at its hypotenuse midpoint.
for (const scale of [0.01, 1, 1e4]) {
  for (const angle of [0, 37, -123]) {
    for (const origin of [{ x: 0, y: 0 }, { x: 19, y: -31 }]) {
      const [a, b, c] = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 8 }].map((point) => transformed(point, scale, angle, origin));
      const output = evaluate("circle_from_three_points", { a, b, c });
      assert.equal(output.length, 1);
      const circle = output[0]!;
      assert.equal(circle.kind, "circle");
      if (circle.kind !== "circle") throw new Error("circumcircle output must be a circle");
      const expectedCenter = transformed({ x: 3, y: 4 }, scale, angle, origin);
      close(circle.center.x, expectedCenter.x, "circumcenter x");
      close(circle.center.y, expectedCenter.y, "circumcenter y");
      close(circle.radius, 5 * scale, "Pythagorean circumradius");
      for (const point of [a!, b!, c!]) close(distance(point, circle.center), circle.radius, "source/circle incidence");
    }
  }
}
for (const c of [[2, 2], [1, 1], [2, 2 + 1e-12], [Infinity, 2], [1e13, 2]]) {
  reject("circle_from_three_points", { a: [0, 0], b: [1, 1], c });
}
reject("circle_from_three_points", { a: [0, 0], b: [6, 0], c: [0, 8], center: [1, 1] });
for (const angles of [[0, 79, 213], [21, 174, 299]]) {
  const center = { x: -11, y: 27 };
  const points = angles.map((angle) => ({ x: center.x + 7 * Math.cos(angle * Math.PI / 180), y: center.y + 7 * Math.sin(angle * Math.PI / 180) }));
  const result = evaluate("circle_from_three_points", { a: points[0], b: points[1], c: points[2] })[0]!;
  assert.equal(result.kind, "circle");
  if (result.kind !== "circle") throw new Error("general circumcircle must be a circle");
  close(distance(result.center, center), 0, "non-right triangle circumcenter");
  close(result.radius, 7, "non-right triangle circumradius");
}

for (const scale of [0.01, 1, 1e4]) {
  for (const angle of [0, 51, -142]) {
    for (const origin of [{ x: 0, y: 0 }, { x: -17, y: 23 }]) {
      const center = transformed({ x: 0, y: 0 }, scale, angle, origin);
      geometry.set("circle", { kind: "circle", center, radius: 3 * scale });
      const at = transformed({ x: 3, y: 0 }, scale, angle, origin);
      const line = evaluate("circle_tangent_at", { circle: "circle", point: at, span: 8 * scale })[0]!;
      assert.equal(line.kind, "path");
      if (line.kind !== "path") throw new Error("tangent output must be a line path");
      assert.equal(line.infinite, true);
      const [a, b] = line.points;
      close(distance(a!, b!), 8 * scale, "tangent represented span");
      close((a!.x + b!.x) / 2, at.x, "tangent passes through source x");
      close((a!.y + b!.y) / 2, at.y, "tangent passes through source y");
      close(dot(subtract(at, center), subtract(b!, a!)) / (3 * scale * distance(a!, b!)), 0, "tangent/radius perpendicularity");
      const external = transformed({ x: 5, y: 0 }, scale, angle, origin);
      const contacts = evaluate("circle_tangency_points", { circle: "circle", externalPoint: external });
      assert.equal(contacts.length, 2);
      for (const [index, contact] of contacts.entries()) {
        assert.equal(contact.kind, "point");
        if (contact.kind !== "point") throw new Error("contact must be a point");
        close(distance(contact.point, center), 3 * scale, "tangency circle incidence");
        close(distance(contact.point, external), 4 * scale, "3-4-5 tangent length");
        close(dot(subtract(contact.point, center), subtract(external, contact.point)) / (12 * scale * scale), 0, "contact/radius perpendicularity");
        assert.equal(Math.sign(cross(subtract(external, center), subtract(contact.point, center))), index === 0 ? 1 : -1, "contact ordering follows oriented external radial vector");
      }
    }
  }
}
geometry.set("circle", { kind: "circle", center: { x: 0, y: 0 }, radius: 3 });
for (const span of ["extent", "8", { value: "extent" }]) evaluate("circle_tangent_at", { circle: "circle", point: [3, 0], span });
for (const point of [[0, 0], [2, 0], [4, 0], [3, 0.001]]) reject("circle_tangent_at", { circle: "circle", point, span: 8 });
for (const span of [0, -2, 1e-8, 1e12, Infinity, undefined]) reject("circle_tangent_at", { circle: "circle", point: [3, 0], span });
for (const externalPoint of [[0, 0], [2, 0], [3, 0], [3 + 1e-12, 0], [Infinity, 0], [1e12, 0]]) reject("circle_tangency_points", { circle: "circle", externalPoint });
reject("circle_tangency_points", { circle: "circle", externalPoint: [5, 0], side: 1 });
reject("circle_tangent_at", { circle: "missing", point: [3, 0], span: 8 });

// Two radius-5 circles six units apart meet at the endpoints of a 3-4-5 triangle.
for (const scale of [0.01, 1, 1e4]) {
  for (const angle of [0, 73, -151]) {
    for (const origin of [{ x: 0, y: 0 }, { x: 11, y: -27 }]) {
      const centerA = transformed({ x: 0, y: 0 }, scale, angle, origin);
      const centerB = transformed({ x: 6, y: 0 }, scale, angle, origin);
      geometry.set("circleA", { kind: "circle", center: centerA, radius: 5 * scale });
      geometry.set("circleB", { kind: "circle", center: centerB, radius: 5 * scale });
      const contacts = evaluate("circle_intersections", { circleA: "circleA", circleB: "circleB", mode: "two" });
      assert.equal(contacts.length, 2);
      for (const [index, contact] of contacts.entries()) {
        assert.equal(contact.kind, "point");
        if (contact.kind !== "point") throw new Error("intersection must be a point");
        const expected = transformed({ x: 3, y: index === 0 ? 4 : -4 }, scale, angle, origin);
        close(distance(contact.point, expected), 0, "independent intersection position");
        close(distance(contact.point, centerA), 5 * scale, "first circle incidence");
        close(distance(contact.point, centerB), 5 * scale, "second circle incidence");
      }
      for (const [radiusA, radiusB, d, expectedX] of [[3, 2, 5, 3], [5, 2, 3, 5]]) {
        geometry.set("circleA", { kind: "circle", center: centerA, radius: radiusA! * scale });
        geometry.set("circleB", { kind: "circle", center: transformed({ x: d!, y: 0 }, scale, angle, origin), radius: radiusB! * scale });
        const contact = evaluate("circle_intersections", { circleA: "circleA", circleB: "circleB", mode: "tangent" });
        assert.equal(contact.length, 1);
        assert.equal(contact[0]!.kind, "point");
        if (contact[0]!.kind !== "point") throw new Error("tangent intersection must be a point");
        close(distance(contact[0]!.point, transformed({ x: expectedX!, y: 0 }, scale, angle, origin)), 0, "external/internal tangent contact");
      }
    }
  }
}
geometry.set("circleA", { kind: "circle", center: { x: 0, y: 0 }, radius: 5 });
for (const [x, radius] of [[0, 5], [0, 3], [12, 5], [1, 3], [10, 5], [10 - 1e-12, 5], [1e-12, 5]]) {
  geometry.set("circleB", { kind: "circle", center: { x: x!, y: 0 }, radius: radius! });
  reject("circle_intersections", { circleA: "circleA", circleB: "circleB", mode: "two" });
}
for (const x of [6, 10 - 1e-12, 10 + 1e-12, 12]) {
  geometry.set("circleB", { kind: "circle", center: { x, y: 0 }, radius: 5 });
  reject("circle_intersections", { circleA: "circleA", circleB: "circleB", mode: "tangent" });
}
reject("circle_intersections", { circleA: "circleA", circleB: "circleB" });
reject("circle_intersections", { circleA: "circleA", circleB: "circleB", mode: "nearest" });
for (const [firstRadius, secondRadius, x] of [[5, 3, 4], [3, 5, 0]]) {
  geometry.set("circleA", { kind: "circle", center: { x: 0, y: 0 }, radius: firstRadius! });
  geometry.set("circleB", { kind: "circle", center: { x: 4, y: 0 }, radius: secondRadius! });
  const points = evaluate("circle_intersections", { circleA: "circleA", circleB: "circleB", mode: "two" });
  for (const [index, point] of points.entries()) {
    assert.equal(point.kind, "point");
    if (point.kind !== "point") throw new Error("unequal circle intersection must be a point");
    close(point.point.x, x!, "unequal circle intersection x");
    close(point.point.y, index === 0 ? 3 : -3, "unequal circle intersection y");
  }
}
for (const radius of [0, -1, 1e-8, NaN, Infinity, 1e12]) {
  geometry.set("badCircle", { kind: "circle", center: { x: 0, y: 0 }, radius });
  reject("circle_tangent_at", { circle: "badCircle", point: [3, 0], span: 8 });
}
geometry.set("badCircle", { kind: "circle", center: { x: 1e13, y: 0 }, radius: 3 });
reject("circle_tangency_points", { circle: "badCircle", externalPoint: [1e13 + 5, 0] });
geometry.set("badCircle", { kind: "circle", center: { x: 1e12, y: 1e12 }, radius: 0.01 });
reject("circle_tangency_points", { circle: "badCircle", externalPoint: [1e12 + 0.03, 1e12] });
reject("circle_tangent_at", { circle: "circle", point: [3, 0], span: 8, angleDeg: 90 });

const sourceCircle: SceneConstruction = { id: "source_circle", operator: "circle", inputs: { center: [0, 0], radius: 3 }, outputs: ["circle"] };
const tangentConstruction: SceneConstruction = { id: "tangent", operator: "circle_tangent_at", inputs: { circle: "circle", point: [3, 0], span: 8 }, outputs: ["tangent"] };
function documentFor(constructions: SceneConstruction[]): SceneDocument {
  constructions = constructions.map((construction) => ({ ...construction, id: `construct_${construction.id}` }));
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-grounded circle geometry" },
    source: { question: "Construct circle geometry from the explicit measurements." }, quantities: [],
    entities: constructions.flatMap((construction) => construction.outputs.map((id) => ({
      id, kind: construction.operator === "circle" || construction.operator === "circle_from_three_points" ? "circle" : construction.operator === "circle_tangent_at" ? "line" : "point", role: "verified circle geometry",
    }))),
    constructions, relations: [], assertions: [], annotations: [], requiredEntityIds: constructions.flatMap((construction) => construction.outputs),
    revealGroups: [{ id: "setup", entityIds: constructions.flatMap((construction) => construction.outputs), dependsOn: [], narrationCue: "show circle geometry" }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "show verified circle geometry" }],
  };
}
function validationIssues(scene: SceneDocument): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const byOutput = new Map(scene.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const)));
  scene.constructions.forEach((construction, index) => validateCircleConstruction(construction, index, scene, byOutput, issues));
  return issues;
}
function rejectDocument(scene: SceneDocument, code: string): void {
  checks++;
  assert.ok(validationIssues(scene).some((issue) => issue.code === code && issue.severity === "fatal"), `document must reject with ${code}: ${JSON.stringify(validationIssues(scene))}`);
}
const tangentDocument = (): SceneDocument => documentFor([structuredClone(sourceCircle), structuredClone(tangentConstruction)]);
assert.deepEqual(validationIssues(tangentDocument()), []);
for (const span of ["extent", "8", { value: "extent" }]) {
  const scene = tangentDocument();
  scene.quantities.push({ id: "extent", value: 8, unit: "cm" });
  scene.constructions[1]!.inputs.span = span;
  assert.deepEqual(validationIssues(scene), []);
}
for (const [key, value] of [["circle", "missing"], ["point", "circle"], ["point", [2, 0]], ["span", Infinity], ["span", undefined]] as const) {
  const scene = tangentDocument();
  scene.constructions[1]!.inputs[key] = value;
  rejectDocument(scene, `invalid_circle_tangent_at_${key}`);
}
for (const output of [[], ["tangent", "circle"], ["missing"]]) {
  const scene = tangentDocument();
  scene.constructions[1]!.outputs = output;
  rejectDocument(scene, output.length === 1 ? "invalid_circle_tangent_at_output_kind" : "invalid_circle_tangent_at_outputs");
}
const unknownInput = tangentDocument();
unknownInput.constructions[1]!.inputs.direction = [1, 0];
rejectDocument(unknownInput, "invalid_circle_tangent_at_input");
const collinearDocument = documentFor([{ id: "circumcircle", operator: "circle_from_three_points", inputs: { a: [0, 0], b: [1, 1], c: [2, 2] }, outputs: ["circle"] }]);
rejectDocument(collinearDocument, "invalid_circle_from_three_points_geometry");
// A constructed point whose coordinates are unavailable statically must remain usable.
const deferredDocument = documentFor([
  { id: "derived", operator: "triangle_center", inputs: { kind: "centroid", a: "A", b: "B", c: "C" }, outputs: ["derived"] },
  { id: "circumcircle", operator: "circle_from_three_points", inputs: { a: "derived", b: [1, 1], c: [2, 2] }, outputs: ["circle"] },
  { id: "contact", operator: "circle_tangency_points", inputs: { circle: "circle", externalPoint: [7, 0] }, outputs: ["contactA", "contactB"] },
]);
assert.deepEqual(validationIssues(deferredDocument), []);
const deferredWithInvalidKnownPoint = structuredClone(deferredDocument);
deferredWithInvalidKnownPoint.entities.push({ id: "invalidKnownPoint", kind: "point", role: "invalid source point" });
deferredWithInvalidKnownPoint.constructions.push({ id: "construct_invalid_known_point", operator: "point", inputs: { x: Infinity, y: 0 }, outputs: ["invalidKnownPoint"] });
deferredWithInvalidKnownPoint.constructions[1]!.inputs.b = "invalidKnownPoint";
rejectDocument(deferredWithInvalidKnownPoint, "invalid_circle_from_three_points_b");
for (const [firstUnit, secondUnit, valid] of [["cm", "Centimeters", true], ["cm", "m", false], ["cm", "rad", false], ["cm", "seconds", false]] as const) {
  const scene = tangentDocument();
  scene.quantities = [{ id: "radius", value: 3, unit: firstUnit }, { id: "span", value: 8, unit: secondUnit }];
  scene.constructions[0]!.inputs.radius = "radius";
  scene.constructions[1]!.inputs.span = { value: "span" };
  if (valid) assert.deepEqual(validationIssues(scene), []);
  else rejectDocument(scene, "invalid_circle_tangent_at_units");
}
const pointUnits = tangentDocument();
pointUnits.quantities = [{ id: "x", value: 3, unit: "cm" }, { id: "y", value: 0, unit: "m" }];
pointUnits.constructions.unshift({ id: "point", operator: "point", inputs: { x: "x", y: "y" }, outputs: ["at"] });
pointUnits.entities.push({ id: "at", kind: "point", role: "given circle point" });
pointUnits.constructions[2]!.inputs.point = "at";
rejectDocument(pointUnits, "invalid_circle_tangent_at_units");
const prefixCircle = documentFor([
  { id: "a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
  { id: "b", operator: "point", inputs: { x: { value: 6, unit: "Mm" }, y: 0 }, outputs: ["b"] },
  { id: "c", operator: "point", inputs: { x: 0, y: { value: 8, unit: "mm" } }, outputs: ["c"] },
  { id: "circle", operator: "circle_from_three_points", inputs: { a: "a", b: "b", c: "c" }, outputs: ["circle"] },
]); rejectDocument(prefixCircle, "invalid_circle_from_three_points_units");
for (const outputs of [null, undefined, "tangent"]) {
  const scene = tangentDocument();
  const construction = scene.constructions[1]!;
  Reflect.set(construction, "outputs", outputs);
  const issues: SceneIssue[] = [];
  validateCircleConstruction(construction, 1, scene, new Map([["circle", scene.constructions[0]!]]), issues);
  assert.ok(issues.some((issue) => issue.code === "invalid_circle_tangent_at_outputs"), "malformed outputs must be a fatal structural error");
  checks++;
}
const cyclicQuantity = tangentDocument();
cyclicQuantity.quantities = [{ id: "cycleA", value: "cycleB" }, { id: "cycleB", value: "cycleA" }];
cyclicQuantity.constructions[1]!.inputs.span = "cycleA";
rejectDocument(cyclicQuantity, "invalid_circle_tangent_at_span");

// Unit mode keeps this chapter's numeric gate independent while other modules
// are being integrated; the default invocation also checks the live compiler.
if (!process.argv.includes("--unit-only")) {
  const { compileSceneDocument } = await import("../../src/compile/compiler");
  const { validateSceneDocument } = await import("../../src/document/validation");
  const rejectedPrefix = compileSceneDocument(prefixCircle); checks++; assert.ok(!rejectedPrefix.ok && rejectedPrefix.renderScene === null, "mixed-prefix point sources cannot certify a raw circumcircle");
  function compiled(scene: SceneDocument): RenderPrimitive[] {
    const validated = validateSceneDocument(scene);
    assert.ok(validated.document, `circle document validation failed: ${JSON.stringify(validated.report.issues)}`);
    const result = compileSceneDocument(validated.document);
    assert.ok(result.ok && result.renderScene, `circle compile failed: ${JSON.stringify(result.report.issues)}`);
    for (const primitive of result.renderScene.primitives) {
      assert.ok(primitive.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), "all circle marks must have finite coordinates");
    }
    checks++;
    return result.renderScene.primitives;
  }
  function pointFor(primitives: RenderPrimitive[], id: string): RenderPoint {
    const point = primitives.find((primitive) => primitive.entityId === id && primitive.kind === "point")?.points[0];
    assert.ok(point, `missing rendered point ${id}`);
    return point;
  }
  compiled(tangentDocument());
  for (const headingDeg of [0, 43, -107]) {
    for (const origin of [[0, 0], [19, -31]]) {
      const scene = documentFor([
        { id: "triangle", operator: "triangle_from_sides", inputs: { sideAB: 3, sideBC: 5, sideCA: 4, origin, headingDeg }, outputs: ["A", "B", "C", "outline"] },
        { id: "circumcircle", operator: "circle_from_three_points", inputs: { a: "A", b: "B", c: "C" }, outputs: ["circle"] },
        { id: "tangent", operator: "circle_tangent_at", inputs: { circle: "circle", point: "B", span: 8 }, outputs: ["tangent"] },
        { id: "external", operator: "point", inputs: { x: 30, y: 30 }, outputs: ["external"] },
        { id: "contacts", operator: "circle_tangency_points", inputs: { circle: "circle", externalPoint: "external" }, outputs: ["contactA", "contactB"] },
      ]);
      scene.entities.find((entity) => entity.id === "outline")!.kind = "polygon";
      scene.constructions.reverse();
      const primitives = compiled(scene);
      const circle = primitives.find((primitive) => primitive.entityId === "circle" && primitive.kind === "circle");
      assert.ok(circle?.radius && circle.points[0], "derived circumcircle must render as one circle");
      const center = circle.points[0];
      const radius = circle.radius;
      for (const id of ["A", "B", "C", "contactA", "contactB"]) close(distance(pointFor(primitives, id), center) - radius, 0, "compiled circle incidence", 0.025);
      const tangent = primitives.find((primitive) => primitive.entityId === "tangent" && primitive.kind === "line");
      assert.ok(tangent && tangent.points.length >= 2, "derived tangent line must render");
      const point = pointFor(primitives, "B");
      const direction = subtract(tangent.points[1]!, tangent.points[0]!);
      close(dot(subtract(point, center), direction) / Math.hypot(direction.x, direction.y), 0, "compiled tangent/radius perpendicularity", 0.025);
      close(Math.abs(cross(subtract(point, tangent.points[0]!), direction)) / Math.hypot(direction.x, direction.y), 0, "compiled tangent source incidence", 0.025);
      const external = pointFor(primitives, "external");
      close(distance(pointFor(primitives, "contactA"), external) - distance(pointFor(primitives, "contactB"), external), 0, "compiled equal external tangent lengths", 0.03);
      const invalid = structuredClone(scene);
      invalid.constructions.find((construction) => construction.operator === "circle_tangent_at")!.inputs.point = "external";
      assert.deepEqual(validationIssues(invalid), [], "dynamic point feasibility must be deferred");
      const result = compileSceneDocument(invalid);
      assert.equal(result.ok, false, "dynamic off-circle point must fail the live compiler");
      assert.equal(result.renderScene, null, "invalid circle candidate must never partially render");
      checks++;
    }
  }
  for (const mode of ["two", "tangent"] as const) {
    const scene = documentFor([
      { id: "circleA", operator: "circle", inputs: { center: [0, 0], radius: 5 }, outputs: ["circleA"] },
      { id: "circleB", operator: "circle", inputs: { center: [mode === "two" ? 6 : 10, 0], radius: 5 }, outputs: ["circleB"] },
      { id: "intersections", operator: "circle_intersections", inputs: { circleA: "circleA", circleB: "circleB", mode }, outputs: mode === "two" ? ["meetA", "meetB"] : ["meetA"] },
    ]);
    scene.constructions.reverse();
    const primitives = compiled(scene);
    for (const id of mode === "two" ? ["meetA", "meetB"] : ["meetA"]) {
      const point = pointFor(primitives, id);
      for (const circleId of ["circleA", "circleB"]) {
        const circle = primitives.find((primitive) => primitive.entityId === circleId && primitive.kind === "circle")!;
        close(distance(point, circle.points[0]!) - circle.radius!, 0, "compiled circle intersection incidence", 0.025);
      }
    }
  }
}

console.log(`circle operators verified: ${checks} independent metric and rejection checks`);

function subtract(a: RenderPoint, b: RenderPoint): RenderPoint { return { x: a.x - b.x, y: a.y - b.y }; }
function dot(a: RenderPoint, b: RenderPoint): number { return a.x * b.x + a.y * b.y; }
function cross(a: RenderPoint, b: RenderPoint): number { return a.x * b.y - a.y * b.x; }
