import { compileSceneDocument, validateSceneDocument, type SceneDocument } from "../../src/index";
import { validateTriangleConstruction } from "../../src/compile/triangleGeometry";
import type { RenderPoint, RenderPrimitive, SceneConstruction, SceneIssue } from "../../src/types";

type TriangleOperator = "triangle_from_sides" | "triangle_from_sas" | "triangle_from_asa";
type Triangle = readonly [RenderPoint, RenderPoint, RenderPoint];
type CenterKind = "centroid" | "incenter" | "circumcenter" | "orthocenter";
const distance = (a: RenderPoint, b: RenderPoint): number => Math.hypot(a.x - b.x, a.y - b.y);
const subtract = (a: RenderPoint, b: RenderPoint): RenderPoint => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: RenderPoint, b: RenderPoint): number => a.x * b.x + a.y * b.y;
const cross = (a: RenderPoint, b: RenderPoint): number => a.x * b.y - a.y * b.x;
const angle = (vertex: RenderPoint, a: RenderPoint, b: RenderPoint): number => {
  const u = subtract(a, vertex);
  const v = subtract(b, vertex);
  return Math.atan2(Math.abs(cross(u, v)), dot(u, v)) * 180 / Math.PI;
};
let compiledCases = 0;
let rejectedCases = 0;

// These oracles inspect rendered geometry, independent of the construction's formula.
for (const origin of [[0, 0], [17, -11]]) {
  for (const headingDeg of [0, 37, -90, 163]) {
    for (const orientation of [1, -1]) {
      const pose = { origin, headingDeg, orientation };
      for (const sides of [[3, 4, 5], [5, 6, 7], [9, 3, 8], [5, 5, 8], [6, 6, 6]]) {
        const [sideAB, sideBC, sideCA] = sides as [number, number, number];
        const candidate = triangleDocument("triangle_from_sides", { ...pose, sideAB, sideBC, sideCA });
        const [a, b, c] = compileTriangle(candidate);
        const scale = distance(a, b) / sideAB;
        near(distance(b, c), sideBC * scale, 0.025, "SSS BC");
        near(distance(c, a), sideCA * scale, 0.025, "SSS CA");
        assertPose([a, b, c], headingDeg, orientation);
      }
      for (const angleADeg of [30, 90, 135]) {
        const [a, b, c] = compileTriangle(triangleDocument("triangle_from_sas", {
          ...pose, sideAB: 5, sideCA: 3, angleADeg,
        }));
        near(distance(c, a) / distance(a, b), 3 / 5, 0.0001, "SAS adjacent side ratio");
        near(angle(a, b, c), angleADeg, 0.02, "SAS included angle");
        assertPose([a, b, c], headingDeg, orientation);
      }
      for (const [angleADeg, angleBDeg] of [[30, 60], [65, 45], [105, 25]]) {
        const [a, b, c] = compileTriangle(triangleDocument("triangle_from_asa", {
          ...pose, sideAB: 7, angleADeg, angleBDeg,
        }));
        near(angle(a, b, c), angleADeg!, 0.02, "ASA angle A");
        near(angle(b, a, c), angleBDeg!, 0.02, "ASA angle B");
        assertPose([a, b, c], headingDeg, orientation);
      }
    }
  }
}

for (const operator of ["triangle_from_sides", "triangle_from_sas", "triangle_from_asa"] as const) {
  for (const form of ["id", "numeric_string", "wrapped"] as const) {
    const candidate = baseTriangle(operator);
    const construction = triangleConstruction(candidate);
    candidate.quantities.push({ id: "given_base", value: 5, unit: "cm", source: "question" });
    construction.inputs.sideAB = form === "id" ? "given_base" : form === "numeric_string" ? "5" : { value: "given_base" };
    compileTriangle(candidate);
  }
}

// Centre checks use their defining incidence/distance laws in rendered space.
for (const kind of ["centroid", "incenter", "circumcenter", "orthocenter"] as const) {
  for (const orientation of [1, -1]) {
    for (const headingDeg of [0, 53, -120]) {
      const candidate = triangleDocument("triangle_from_sides", {
        sideAB: 5, sideBC: 6, sideCA: 7, origin: [11, -9], headingDeg, orientation,
      });
      appendCenter(candidate, kind);
      // A consumer declared before its producer must still use the computed triangle.
      candidate.constructions.reverse();
      const primitives = compile(candidate);
      const [a, b, c] = vertices(primitives);
      const center = pointFor(primitives, "center");
      if (kind === "centroid") {
        near(center.x, (a.x + b.x + c.x) / 3, 0.015, "centroid x");
        near(center.y, (a.y + b.y + c.y) / 3, 0.015, "centroid y");
      } else if (kind === "incenter") {
        const residuals = [[a, b], [b, c], [c, a]].map(([u, v]) => lineDistance(center, u!, v!));
        near(residuals[0]!, residuals[1]!, 0.02, "incenter distances AB/BC");
        near(residuals[1]!, residuals[2]!, 0.02, "incenter distances BC/CA");
        const winding = Math.sign(cross(subtract(b, a), subtract(c, a)));
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
          if (Math.sign(cross(subtract(v!, u!), subtract(center, u!))) !== winding) {
            throw new Error("incenter lies outside triangle");
          }
        }
      } else if (kind === "circumcenter") {
        near(distance(center, a), distance(center, b), 0.02, "circumcenter radii A/B");
        near(distance(center, b), distance(center, c), 0.02, "circumcenter radii B/C");
      } else {
        for (const [vertex, oppositeA, oppositeB] of [[a, b, c], [b, a, c], [c, a, b]]) {
          const altitude = subtract(center, vertex!);
          const opposite = subtract(oppositeB!, oppositeA!);
          near(dot(altitude, opposite) / Math.max(1, distance(oppositeA!, oppositeB!)), 0, 0.025, "orthocenter altitude");
        }
      }
    }
  }
}

for (const operator of ["triangle_from_sides", "triangle_from_sas", "triangle_from_asa"] as const) {
  const rejectInput = (name: string, value: unknown): void => reject(`${operator} ${name}`, mutate(baseTriangle(operator), (scene) => {
    triangleConstruction(scene).inputs[name] = value;
  }), `invalid_${operator}_${name}`);
  for (const value of [0, -1, Infinity, NaN, 1e12]) rejectInput("sideAB", value);
  rejectInput("orientation", 0);
  rejectInput("orientation", "left");
  rejectInput("headingDeg", Infinity);
  rejectInput("origin", [0, Infinity]);
  rejectInput("origin", [1e15, 0]);
  rejectInput("origin", "outline");
  reject(`${operator} missing length`, mutate(baseTriangle(operator), (scene) => {
    delete triangleConstruction(scene).inputs.sideAB;
  }), `invalid_${operator}_sideAB`);
  reject(`${operator} wrong output count`, mutate(baseTriangle(operator), (scene) => {
    triangleConstruction(scene).outputs.pop();
  }), `invalid_${operator}_outputs`);
  reject(`${operator} wrong vertex kind`, mutate(baseTriangle(operator), (scene) => {
    scene.entities.find((entity) => entity.id === "A")!.kind = "polygon";
  }), `invalid_${operator}_output_kind`);
  reject(`${operator} wrong outline kind`, mutate(baseTriangle(operator), (scene) => {
    scene.entities.find((entity) => entity.id === "outline")!.kind = "point";
  }), `invalid_${operator}_output_kind`);
  reject(`${operator} ambiguous extra input`, mutate(baseTriangle(operator), (scene) => {
    triangleConstruction(scene).inputs.angleCDeg = 40;
  }), `invalid_${operator}_input`);
  reject(`${operator} cyclic quantity`, mutate(baseTriangle(operator), (scene) => {
    scene.quantities = [{ id: "cycle_a", value: "cycle_b" }, { id: "cycle_b", value: "cycle_a" }];
    triangleConstruction(scene).inputs.sideAB = "cycle_a";
  }), `invalid_${operator}_sideAB`);
}
for (const [sideAB, sideBC, sideCA] of [[1, 2, 3], [1, 1, 4], [1e-10, 1, 1]]) {
  reject("SSS impossible or indistinguishable triangle", triangleDocument("triangle_from_sides", { sideAB, sideBC, sideCA }), "invalid_triangle_from_sides_geometry");
}
reject("SSS triangle that collapses at canvas precision", triangleDocument("triangle_from_sides", { sideAB: 1, sideBC: 1, sideCA: 2 - 1e-12 }),
  ["invalid_triangle_from_sides_geometry", "degenerate_projected_geometry"]);
for (const angleADeg of [0, 180, 181, Infinity, 1e-10, 180 - 1e-10]) {
  reject("SAS non-interior or degenerate angle", triangleDocument("triangle_from_sas", { sideAB: 5, sideCA: 3, angleADeg }),
    angleADeg <= 0 || angleADeg >= 180 || !Number.isFinite(angleADeg) ? "invalid_triangle_from_sas_angleADeg" : "invalid_triangle_from_sas_geometry");
}
for (const [angleADeg, angleBDeg] of [[90, 90], [110, 80], [1e-10, 90], [90, 90 - 1e-10]]) {
  reject("ASA invalid angle sum or degenerate triangle", triangleDocument("triangle_from_asa", { sideAB: 5, angleADeg, angleBDeg }), "invalid_triangle_from_asa_geometry");
}
reject("ASA derived oversized triangle", triangleDocument("triangle_from_asa", { sideAB: 1e9, angleADeg: 89, angleBDeg: 89 }), "invalid_triangle_from_asa_geometry");
for (const kind of ["centroid", "incenter", "circumcenter", "orthocenter"] as const) {
  const candidate = baseTriangle("triangle_from_sides");
  appendCenter(candidate, kind);
  reject(`${kind} invalid vertex reference`, mutate(candidate, (scene) => {
    scene.constructions.find((construction) => construction.operator === "triangle_center")!.inputs.c = "outline";
  }), "invalid_triangle_center_c");
  reject(`${kind} collinear inputs`, mutate(candidate, (scene) => {
    scene.constructions.find((construction) => construction.operator === "triangle_center")!.inputs = { kind, a: [0, 0], b: [1, 1], c: [2, 2] };
  }), "invalid_triangle_center_geometry");
}
reject("unsupported centre", mutate(baseTriangle("triangle_from_sides"), (scene) => {
  appendCenter(scene, "centroid");
  scene.constructions.find((construction) => construction.operator === "triangle_center")!.inputs.kind = "excenter";
}), "invalid_triangle_center_kind");

for (const operator of ["triangle_from_sides", "triangle_from_sas"] as const) {
  const candidate = baseTriangle(operator);
  candidate.quantities = [{ id: "base_cm", value: 5, unit: "cm" }, { id: "arm_m", value: 7, unit: "m" }];
  triangleConstruction(candidate).inputs.sideAB = "base_cm";
  triangleConstruction(candidate).inputs.sideCA = { value: "arm_m" };
  reject("incompatible known side units", candidate, `invalid_${operator}_units`);
  candidate.quantities[1]!.unit = "Centimeters";
  compileTriangle(candidate);
}
reject("megameter side cannot alias millimeter sides", triangleDocument("triangle_from_sides", { sideAB: { value: 3, unit: "Mm" }, sideBC: { value: 4, unit: "mm" }, sideCA: { value: 5, unit: "mm" } }), "invalid_triangle_from_sides_units");
for (const operator of ["triangle_from_sas", "triangle_from_asa"] as const) {
  const candidate = baseTriangle(operator);
  candidate.quantities = [{ id: "angle_radians", value: Math.PI / 3, unit: "radians" }];
  triangleConstruction(candidate).inputs.angleADeg = "angle_radians";
  reject("radians passed to degree input", candidate, `invalid_${operator}_units`);
  candidate.quantities[0]!.unit = "degrees";
  candidate.quantities[0]!.value = 60;
  compileTriangle(candidate);
}
for (const outputs of [undefined, null, "A"]) {
  const candidate = baseTriangle("triangle_from_sides");
  const construction = triangleConstruction(candidate);
  Reflect.set(construction, "outputs", outputs);
  const issues: SceneIssue[] = [];
  validateTriangleConstruction(construction, 0, candidate, new Map(), issues);
  if (!issues.some((issue) => issue.code === "invalid_triangle_from_sides_outputs")) throw new Error("Malformed triangle outputs were not rejected");
  rejectedCases++;
}

console.log(`triangle operators verified: ${compiledCases} compiled cases, ${rejectedCases} rejection cases; SSS/SAS/ASA and four centres`);

function triangleDocument(operator: TriangleOperator, inputs: Record<string, unknown>): SceneDocument {
  const ids = ["A", "B", "C", "outline"];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "source-grounded triangle construction" },
    source: { question: "Construct the triangle from the given measurements." },
    quantities: [],
    entities: ids.map((id) => ({ id, kind: id === "outline" ? "polygon" : "point", role: id === "outline" ? "triangle outline" : "triangle vertex" })),
    constructions: [{ id: "construct_triangle", operator, inputs, outputs: ids }],
    relations: [], assertions: [], annotations: [],
    requiredEntityIds: [...ids],
    revealGroups: [{ id: "setup", entityIds: [...ids], dependsOn: [], narrationCue: "show triangle" }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "show the constructed triangle" }],
  };
}
function baseTriangle(operator: TriangleOperator): SceneDocument {
  const inputs = operator === "triangle_from_sides" ? { sideAB: 5, sideBC: 6, sideCA: 7 }
    : operator === "triangle_from_sas" ? { sideAB: 5, sideCA: 3, angleADeg: 60 }
      : { sideAB: 5, angleADeg: 60, angleBDeg: 40 };
  return triangleDocument(operator, inputs);
}
function triangleConstruction(scene: SceneDocument): SceneConstruction {
  return scene.constructions.find((construction) => construction.operator !== "triangle_center")!;
}
function appendCenter(scene: SceneDocument, kind: CenterKind): void {
  scene.entities.push({ id: "center", kind: "point", role: `${kind} of triangle` });
  scene.constructions.push({ id: "construct_center", operator: "triangle_center", inputs: { a: "A", b: "B", c: "C", kind }, outputs: ["center"] });
  scene.requiredEntityIds.push("center");
  scene.revealGroups[0]!.entityIds.push("center");
}
function compile(scene: SceneDocument): RenderPrimitive[] {
  const validated = validateSceneDocument(scene);
  const result = validated.document ? compileSceneDocument(validated.document) : null;
  if (!result?.ok || !result.renderScene) throw new Error(`Triangle compile failed: ${JSON.stringify(result?.report.issues ?? validated.report.issues)}`);
  compiledCases++;
  if (result.renderScene.primitives.some((primitive) => primitive.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))) {
    throw new Error("Triangle rendering emitted non-finite coordinates");
  }
  return result.renderScene.primitives;
}
function compileTriangle(scene: SceneDocument): Triangle {
  const primitives = compile(scene);
  const triangle = vertices(primitives);
  const outline = primitives.find((primitive) => primitive.entityId === "outline" && primitive.kind === "polygon");
  if (!outline || outline.points.length !== 3) throw new Error("Triangle outline must be one closed three-vertex polygon");
  triangle.forEach((point, index) => near(distance(point, outline.points[index]!), 0, 0.001, "vertex/outline incidence"));
  return triangle;
}
function vertices(primitives: RenderPrimitive[]): Triangle {
  return [pointFor(primitives, "A"), pointFor(primitives, "B"), pointFor(primitives, "C")];
}
function pointFor(primitives: RenderPrimitive[], id: string): RenderPoint {
  const point = primitives.find((primitive) => primitive.entityId === id && primitive.kind === "point")?.points[0];
  if (!point) throw new Error(`Missing rendered point ${id}`);
  return point;
}
function assertPose([a, b, c]: Triangle, headingDeg: number, orientation: number): void {
  // Compiler uses a uniform viewport scale and flips world y for board coordinates.
  const direction = subtract(b, a);
  const theta = headingDeg * Math.PI / 180;
  const expected = { x: Math.cos(theta), y: -Math.sin(theta) };
  near(cross(direction, expected) / distance(a, b), 0, 0.0001, "heading");
  if (dot(direction, expected) <= 0 || Math.sign(cross(direction, subtract(c, a))) !== -orientation) throw new Error("Triangle orientation/heading was reversed");
}
function lineDistance(point: RenderPoint, a: RenderPoint, b: RenderPoint): number {
  return Math.abs(cross(subtract(point, a), subtract(b, a))) / distance(a, b);
}
function near(actual: number, expected: number, tolerance: number, context: string): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) throw new Error(`${context}: expected ${expected} ± ${tolerance}, got ${actual}`);
}
function mutate(scene: SceneDocument, change: (document: SceneDocument) => void): SceneDocument {
  const candidate = structuredClone(scene);
  change(candidate);
  return candidate;
}
function reject(name: string, candidate: SceneDocument, expectedCode: string | string[]): void {
  const validated = validateSceneDocument(candidate);
  const compiled = validated.document ? compileSceneDocument(validated.document) : null;
  const issues = compiled?.report.issues ?? validated.report.issues;
  const acceptedCodes = typeof expectedCode === "string" ? [expectedCode] : expectedCode;
  if (compiled?.ok || (compiled?.renderScene ?? null) !== null || !issues.some((issue) => acceptedCodes.includes(issue.code))) {
    throw new Error(`${name} was not rejected with ${expectedCode}: ${JSON.stringify(issues)}`);
  }
  rejectedCases++;
}
