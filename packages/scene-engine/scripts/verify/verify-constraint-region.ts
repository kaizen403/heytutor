// Verify the constraint_region operator: the feasible set of an inequality
// system, which is how exam stems state an area-by-integration region
// ("Using integration, find the area of the region {(x, y) : ...}").
//
// function_region can only join two explicit y = f(x) curves, so every region
// cut by a conic compiled to nothing. The checks below are similarity
// invariants (area / bounding-box area), because compiled primitives are in
// screen space after a uniform scale and a y-flip.
import { compileSceneDocument, type SceneDocument } from "../../src";
import type { RenderPrimitive } from "../../src/types";

interface Constraint {
  expression: string;
  relation: "le" | "ge";
}

interface RegionCase {
  name: string;
  question: string;
  constraints: Constraint[];
  box: { xMin: number; xMax: number; yMin: number; yMax: number };
  /** Exact area / exact bounding-box area, from calculus. */
  expectedFillRatio: number;
}

const CASES: RegionCase[] = [
  {
    // Circular segment. Area = (pi/4 - 1/2) * 9; bbox [0,3] x [0,3].
    name: "circle cut by a chord",
    question: "Using integration, find the area of the region {(x, y) : x^2 + y^2 <= 9, x + y >= 3}.",
    constraints: [
      { expression: "x^2+y^2-9", relation: "le" },
      { expression: "x+y-3", relation: "ge" },
    ],
    box: { xMin: -4, xMax: 4, yMin: -4, yMax: 4 },
    expectedFillRatio: (Math.PI / 4 - 1 / 2) * 9 / 9,
  },
  {
    // Eighth of a disc between y = x and the y-axis. Area = 4*pi;
    // bbox [0,4] x [0, sqrt(32)].
    name: "quadrant sector between a line and a circle",
    question:
      "Find the area of the region in the first quadrant enclosed by the y-axis, the line y = x and the circle x^2 + y^2 = 32.",
    constraints: [
      { expression: "x", relation: "ge" },
      { expression: "y-x", relation: "ge" },
      { expression: "x^2+y^2-32", relation: "le" },
    ],
    box: { xMin: -1, xMax: 6, yMin: -1, yMax: 6 },
    expectedFillRatio: (4 * Math.PI) / (4 * Math.sqrt(32)),
  },
  {
    // Two upper bounds that swap at x = 2 — the corner a marching-squares
    // contour would alias. Area = 8/6 + 5/2; bbox [0,3] x [0,3].
    name: "region under the lower of two curves",
    question:
      "Using integration, find the area of the region {(x, y) : 0 <= 2y <= x^2, 0 <= y <= x, 0 < x < 3}.",
    constraints: [
      { expression: "y", relation: "ge" },
      { expression: "x^2-2*y", relation: "ge" },
      { expression: "x-y", relation: "ge" },
      { expression: "x", relation: "ge" },
      { expression: "x-3", relation: "le" },
    ],
    box: { xMin: -1, xMax: 4, yMin: -1, yMax: 4 },
    expectedFillRatio: (8 / 6 + 5 / 2) / 9,
  },
];

for (const testCase of CASES) {
  const primitives = compile(regionDocument(testCase));
  const region = primitives.find((item) => item.entityId === "region" && item.kind !== "label");
  if (!region || region.points.length < 8) {
    throw new Error(`${testCase.name}: constraint_region rendered no region path`);
  }
  const ratio = shoelaceArea(region.points) / boundingBoxArea(region.points);
  if (Math.abs(ratio - testCase.expectedFillRatio) > 0.02) {
    throw new Error(
      `${testCase.name}: region fills ${ratio.toFixed(4)} of its bounding box, expected ${testCase.expectedFillRatio.toFixed(4)}`,
    );
  }
}

// Fail closed rather than bridging a set a single boundary pair cannot describe.
expectRejected({
  name: "annulus",
  question: "Area between the circles x^2 + y^2 = 4 and x^2 + y^2 = 9.",
  constraints: [
    { expression: "x^2+y^2-9", relation: "le" },
    { expression: "x^2+y^2-4", relation: "ge" },
  ],
  box: { xMin: -4, xMax: 4, yMin: -4, yMax: 4 },
  expectedFillRatio: 0,
});

expectRejected({
  name: "empty system",
  question: "Area of the region x^2 + y^2 <= 1 with x >= 5.",
  constraints: [
    { expression: "x^2+y^2-1", relation: "le" },
    { expression: "x-5", relation: "ge" },
  ],
  box: { xMin: -4, xMax: 6, yMin: -4, yMax: 4 },
  expectedFillRatio: 0,
});

console.log("verify-constraint-region: ok");
console.log(`  regions=${CASES.length} rejected=2 (disconnected, empty)`);

function expectRejected(testCase: RegionCase): void {
  const result = compileSceneDocument(regionDocument(testCase));
  const drew = (result.renderScene?.primitives ?? []).some(
    (item) => item.entityId === "region" && item.kind !== "label",
  );
  if (result.ok || drew) {
    throw new Error(`${testCase.name}: constraint_region should have failed closed, but it rendered`);
  }
}

function compile(document: SceneDocument): RenderPrimitive[] {
  const result = compileSceneDocument(document);
  if (!result.ok || !result.renderScene) {
    const fatal = result.report.issues.filter((issue) => issue.severity === "fatal");
    throw new Error(`constraint_region compile failed: ${fatal.map((issue) => issue.message).join("; ")}`);
  }
  return result.renderScene.primitives;
}

function regionDocument(testCase: RegionCase): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "verify the constraint_region operator" },
    source: { question: testCase.question },
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "display axes" },
      { id: "region", kind: "polygon", role: "feasible region" },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { ...testCase.box }, outputs: ["axes"] },
      {
        id: "make_region",
        operator: "constraint_region",
        inputs: { constraints: testCase.constraints, ...testCase.box, samples: 65 },
        outputs: ["region"],
      },
    ],
    relations: [],
    assertions: [
      { id: "region_exists", predicate: "exists", entities: ["region"], expected: true, severity: "fatal" },
    ],
    annotations: [],
    requiredEntityIds: ["axes", "region"],
    revealGroups: [{ id: "reveal_region", entityIds: ["axes", "region"] }],
    teachingTimeline: [],
  } as SceneDocument;
}

function shoelaceArea(points: ReadonlyArray<{ x: number; y: number }>): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    total += current.x * next.y - next.x * current.y;
  }
  return Math.abs(total) / 2;
}

function boundingBoxArea(points: ReadonlyArray<{ x: number; y: number }>): number {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (!(width > 0) || !(height > 0)) throw new Error("region has a degenerate bounding box");
  return width * height;
}
