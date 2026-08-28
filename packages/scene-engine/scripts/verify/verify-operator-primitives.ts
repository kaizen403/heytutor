// Verify coverage for the last five implemented-but-unverified reusable
// construction operators: translate, reflect_point, parallel_through,
// refract_direction, angle_bisector. This closes the 52/57 -> 57/57
// verify-coverage gap in the reusable-operator inventory
// (packages/scene-engine/src/capability/capabilityManifest.ts).
import { compileSceneDocument, type SceneDocument } from "../../src";
import type { RenderPrimitive } from "../../src/types";

type Vec = { x: number; y: number };

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
const magnitude = (a: Vec): number => Math.hypot(a.x, a.y);
const unit = (a: Vec, context: string): Vec => {
  const length = magnitude(a);
  if (length < 1e-9) throw new Error(`${context}: zero-length render direction`);
  return { x: a.x / length, y: a.y / length };
};
const pointLineDistance = (p: Vec, a: Vec, b: Vec, context: string): number => {
  const direction = sub(b, a);
  const length = magnitude(direction);
  if (length < 1e-9) throw new Error(`${context}: degenerate rendered line`);
  return Math.abs(cross(sub(p, a), direction)) / length;
};

const translatePrimitives = compileOperator(operatorDocument({
  operator: "translate",
  inputs: { point: "src", vector: [3, 4] },
  outputKind: "point",
  points: [{ id: "src", x: 2, y: 1 }],
  question: "Translate the point (2,1) by the vector (3,4).",
}));
{
  const source = primitiveFor(translatePrimitives, "src", "translate").points[0]!;
  const moved = primitiveFor(translatePrimitives, "translate_output", "translate").points[0]!;
  const delta = sub(moved, source);
  // Screen transform is a uniform scale with a y-flip, so (3,4) renders as s*(3,-4).
  const expected = unit({ x: 3, y: -4 }, "translate expected");
  const rendered = unit(delta, "translate");
  if (Math.abs(cross(rendered, expected)) > 0.01 || dot(rendered, expected) < 0.999) {
    throw new Error(`translate did not move the point by (3,4): ${JSON.stringify({ source, moved })}`);
  }
}

const reflectPointPrimitives = compileOperator(operatorDocument({
  operator: "reflect_point",
  inputs: { point: "src", line: "axis" },
  outputKind: "point",
  points: [
    { id: "axis_start", x: 0, y: 0 },
    { id: "axis_end", x: 4, y: 0 },
    { id: "src", x: 3, y: 1 },
  ],
  paths: [{ id: "axis", operator: "line", start: "axis_start", end: "axis_end" }],
  question: "Reflect the point (3,1) across the x-axis.",
}));
{
  const source = primitiveFor(reflectPointPrimitives, "src", "reflect_point").points[0]!;
  const mirrored = primitiveFor(reflectPointPrimitives, "reflect_point_output", "reflect_point").points[0]!;
  const axis = primitiveFor(reflectPointPrimitives, "axis", "reflect_point").points;
  const axisDirection = unit(sub(axis[1]!, axis[0]!), "reflect_point axis");
  const offset = sub(mirrored, source);
  const midpoint = { x: (source.x + mirrored.x) / 2, y: (source.y + mirrored.y) / 2 };
  // Mirror image: the axis bisects the source/mirror segment at a right angle.
  if (pointLineDistance(midpoint, axis[0]!, axis[1]!, "reflect_point") > 2) {
    throw new Error(`reflect_point midpoint is not on the axis: ${JSON.stringify({ source, mirrored })}`);
  }
  if (Math.abs(dot(unit(offset, "reflect_point"), axisDirection)) > 0.02) {
    throw new Error(`reflect_point segment is not perpendicular to the axis: ${JSON.stringify({ source, mirrored })}`);
  }
  if (magnitude(offset) < 4) {
    throw new Error(`reflect_point did not move the point off the axis: ${JSON.stringify({ source, mirrored })}`);
  }
}

const parallelPrimitives = compileOperator(operatorDocument({
  operator: "parallel_through",
  inputs: { through: "through", line: "reference" },
  outputKind: "line",
  points: [
    { id: "ref_start", x: 0, y: 0 },
    { id: "ref_end", x: 4, y: 2 },
    { id: "through", x: 1, y: 2 },
  ],
  paths: [{ id: "reference", operator: "line", start: "ref_start", end: "ref_end" }],
  question: "Draw a line through (1,2) parallel to the line through (0,0) and (4,2).",
}));
{
  const through = primitiveFor(parallelPrimitives, "through", "parallel_through").points[0]!;
  const reference = primitiveFor(parallelPrimitives, "reference", "parallel_through").points;
  const parallel = primitiveFor(parallelPrimitives, "parallel_through_output", "parallel_through").points;
  const referenceDirection = unit(sub(reference[1]!, reference[0]!), "parallel_through reference");
  const parallelDirection = unit(sub(parallel[1]!, parallel[0]!), "parallel_through output");
  if (Math.abs(cross(parallelDirection, referenceDirection)) > 0.02) {
    throw new Error(`parallel_through is not parallel to the reference: ${JSON.stringify({ reference, parallel })}`);
  }
  if (pointLineDistance(through, parallel[0]!, parallel[1]!, "parallel_through") > 2) {
    throw new Error(`parallel_through does not pass through the given point: ${JSON.stringify({ through, parallel })}`);
  }
  if (pointLineDistance(through, reference[0]!, reference[1]!, "parallel_through") < 4) {
    throw new Error(`parallel_through collapsed onto the reference line: ${JSON.stringify({ through, reference })}`);
  }
}

const refractPrimitives = compileOperator(operatorDocument({
  operator: "refract_direction",
  inputs: { origin: "origin", incoming: "incoming", normal: "normal", n1: 1, n2: 1.5 },
  outputKind: "ray",
  points: [
    { id: "origin", x: 0, y: 0 },
    { id: "src", x: -2, y: 2 },
    { id: "normal_end", x: 0, y: 2 },
  ],
  paths: [
    { id: "incoming", operator: "ray", start: "src", end: "origin" },
    { id: "normal", operator: "ray", start: "origin", end: "normal_end" },
  ],
  question: "Refract a ray incident at 45 degrees from air (n=1) into glass (n=1.5).",
}));
{
  const origin = primitiveFor(refractPrimitives, "origin", "refract_direction").points[0]!;
  const incomingPrimitive = primitiveFor(refractPrimitives, "incoming", "refract_direction").points;
  const normalPrimitive = primitiveFor(refractPrimitives, "normal", "refract_direction").points;
  const refractedPrimitive = primitiveFor(refractPrimitives, "refract_direction_output", "refract_direction").points;
  const incomingDirection = unit(sub(incomingPrimitive[1]!, incomingPrimitive[0]!), "refract_direction incoming");
  const normalDirection = unit(sub(normalPrimitive[1]!, normalPrimitive[0]!), "refract_direction normal");
  const refractedDirection = unit(sub(refractedPrimitive[1]!, refractedPrimitive[0]!), "refract_direction refracted");
  if (magnitude(sub(refractedPrimitive[0]!, origin)) > 2) {
    throw new Error(`refract_direction ray does not start at the origin: ${JSON.stringify(refractedPrimitive)}`);
  }
  if (Math.abs(cross(refractedDirection, incomingDirection)) < 0.05) {
    throw new Error(`refract_direction kept the incoming direction: ${JSON.stringify({ incomingDirection, refractedDirection })}`);
  }
  const sinIncoming = Math.abs(cross(incomingDirection, normalDirection));
  const sinRefracted = Math.abs(cross(refractedDirection, normalDirection));
  if (Math.abs(sinIncoming / sinRefracted - 1.5) > 0.03) {
    throw new Error(`refract_direction violates Snell's law: ${JSON.stringify({ sinIncoming, sinRefracted })}`);
  }
  if (Math.abs(dot(refractedDirection, normalDirection)) <= Math.abs(dot(incomingDirection, normalDirection)) + 0.05) {
    throw new Error(`refract_direction did not bend toward the normal entering the denser medium: ${JSON.stringify({ incomingDirection, refractedDirection })}`);
  }
  if (cross(normalDirection, incomingDirection) * cross(normalDirection, refractedDirection) <= 0) {
    throw new Error(`refract_direction crossed to the wrong side of the normal: ${JSON.stringify({ incomingDirection, refractedDirection })}`);
  }
  if (dot(refractedDirection, incomingDirection) <= 0) {
    throw new Error(`refract_direction reversed the ray: ${JSON.stringify({ incomingDirection, refractedDirection })}`);
  }
}

const bisectorPrimitives = compileOperator(operatorDocument({
  operator: "angle_bisector",
  inputs: { vertex: "vertex", a: "arm_a", b: "arm_b" },
  outputKind: "line",
  points: [
    { id: "vertex", x: 0, y: 0 },
    { id: "arm_a", x: 2, y: 0 },
    { id: "arm_b", x: 0, y: 2 },
  ],
  question: "Bisect the right angle at the origin between (2,0) and (0,2).",
}));
{
  const vertex = primitiveFor(bisectorPrimitives, "vertex", "angle_bisector").points[0]!;
  const armA = primitiveFor(bisectorPrimitives, "arm_a", "angle_bisector").points[0]!;
  const armB = primitiveFor(bisectorPrimitives, "arm_b", "angle_bisector").points[0]!;
  const bisector = primitiveFor(bisectorPrimitives, "angle_bisector_output", "angle_bisector").points;
  const bisectorDirection = unit(sub(bisector[1]!, bisector[0]!), "angle_bisector output");
  const armADirection = unit(sub(armA, vertex), "angle_bisector arm a");
  const armBDirection = unit(sub(armB, vertex), "angle_bisector arm b");
  if (pointLineDistance(vertex, bisector[0]!, bisector[1]!, "angle_bisector") > 2) {
    throw new Error(`angle_bisector does not pass through the vertex: ${JSON.stringify({ vertex, bisector })}`);
  }
  // The bisector makes equal angles with both arms (u + v direction).
  const angleToA = Math.abs(dot(bisectorDirection, armADirection));
  const angleToB = Math.abs(dot(bisectorDirection, armBDirection));
  if (Math.abs(angleToA - angleToB) > 0.02) {
    throw new Error(`angle_bisector does not split the angle evenly: ${JSON.stringify({ angleToA, angleToB })}`);
  }
  const expected = unit({ x: 1, y: -1 }, "angle_bisector expected");
  if (Math.abs(cross(bisectorDirection, expected)) > 0.02) {
    throw new Error(`angle_bisector direction is not the normalized sum of the arms: ${JSON.stringify({ bisector })}`);
  }
}

console.log("verify-operator-primitives: ok");
console.log("  operators=5 translate reflect_point parallel_through refract_direction angle_bisector");

function compileOperator(document: SceneDocument): RenderPrimitive[] {
  const result = compileSceneDocument(document);
  if (!result.ok || !result.renderScene || result.renderScene.primitives.length < 1) {
    throw new Error(`${String(document.source.question)} failed: ${JSON.stringify(result.report.issues)}`);
  }
  return result.renderScene.primitives;
}

function primitiveFor(primitives: RenderPrimitive[], entityId: string, operator: string): RenderPrimitive {
  const primitive = primitives.find((item) => item.entityId === entityId && item.kind !== "label");
  if (!primitive || primitive.points.length < 1) {
    throw new Error(`${operator} did not render ${entityId}`);
  }
  return primitive;
}

function operatorDocument(config: {
  operator: string;
  inputs: Record<string, unknown>;
  outputKind: "point" | "line" | "ray";
  points: Array<{ id: string; x: number; y: number }>;
  paths?: Array<{ id: string; operator: "line" | "ray" | "segment"; start: string; end: string }>;
  question: string;
}): SceneDocument {
  const output = `${config.operator}_output`;
  const visible = [
    ...config.points.map((point) => point.id),
    ...(config.paths ?? []).map((path) => path.id),
    output,
  ];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: `verify reusable ${config.operator} operator` },
    source: { question: config.question },
    quantities: [],
    entities: [
      ...config.points.map((point) => ({ id: point.id, kind: "point", role: "construction point" })),
      ...(config.paths ?? []).map((path) => ({ id: path.id, kind: path.operator, role: `${path.operator} reference` })),
      { id: output, kind: config.outputKind, role: config.operator.replaceAll("_", " ") },
    ],
    constructions: [
      ...config.points.map((point) => ({
        id: `make_${point.id}`,
        operator: "point",
        inputs: { x: point.x, y: point.y, coordinateSpace: "world" },
        outputs: [point.id],
      })),
      ...(config.paths ?? []).map((path) => ({
        id: `make_${path.id}`,
        operator: path.operator,
        inputs: { start: path.start, end: path.end },
        outputs: [path.id],
      })),
      { id: `make_${output}`, operator: config.operator, inputs: config.inputs, outputs: [output] },
    ],
    relations: [],
    assertions: visible.map((id) => ({
      id: `exists_${id}`,
      predicate: "exists",
      entities: [id],
      expected: true,
      severity: "fatal" as const,
    })),
    annotations: [],
    requiredEntityIds: visible,
    revealGroups: [{
      id: "setup",
      entityIds: visible,
      dependsOn: [],
      narrationCue: `Reveal the ${config.operator.replaceAll("_", " ")} construction.`,
    }],
    teachingTimeline: [{
      id: "reveal_setup",
      action: "reveal",
      targetId: "setup",
      dependsOn: [],
      narrationIntent: `Reveal the verified ${config.operator.replaceAll("_", " ")}.`,
    }],
  };
}
