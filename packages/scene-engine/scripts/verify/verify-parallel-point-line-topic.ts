import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compileSceneDocument } from "../../src/compile/compiler";
import { evaluateAnalyticLineConstruction, type AnalyticLineEvaluationContext } from "../../src/compile/analyticLineGeometry";
import type { SceneDocument } from "../../src/types";
import { renderSceneSvg } from "../lib/renderSceneSvg";

interface Case {
  id: string;
  question: string;
  point: [number, number];
  a: number;
  b: number;
  c: number;
  distance: number;
  foot: [number, number];
  holdout?: boolean;
}

const directory = resolve(process.argv[2] ?? "");
assert(process.argv[2], "Provide the private frozen checklist/evidence directory");
const bytes = readFileSync(join(directory, "checklist.json"));
const checklist: { cases: Case[] } = JSON.parse(bytes.toString());
assert.equal(checklist.cases.length, 5);
mkdirSync(directory, { recursive: true });
const context: AnalyticLineEvaluationContext = {
  number(value) { const number = Number(value); assert(Number.isFinite(number)); return number; },
  point() { throw new Error("No external point references in this isolated operator oracle"); },
  geometry() { return undefined; },
};
let checks = 0;
const findings: Array<{ control: string; observed: unknown; expected: string }> = [];
function close(actual: number | undefined, expected: number): void {
  checks += 1;
  assert(actual !== undefined && Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}
function inputs(test: Case): Record<string, unknown> {
  return { point: test.point, a: test.a, b: test.b, c: test.c };
}
function evaluate(value: Record<string, unknown>) {
  const result = evaluateAnalyticLineConstruction("point_line_distance", value, context);
  assert.equal(result.length, 1);
  return result[0]!;
}
function document(test: Case): SceneDocument {
  const required = ["line", "P", "distance"];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "Show the source line, point and perpendicular distance" },
    source: { question: test.question }, quantities: [],
    entities: [
      { id: "line", kind: "line", role: "complete source line" },
      { id: "P", kind: "point", role: "source point", label: "P" },
      { id: "distance", kind: test.distance === 0 ? "point" : "segment", role: "computed perpendicular foot connector" },
    ],
    constructions: [
      { id: "line_make", operator: "line_equation", inputs: { form: "general", a: test.a, b: test.b, c: test.c }, outputs: ["line"] },
      { id: "point_make", operator: "point", inputs: { x: test.point[0], y: test.point[1] }, outputs: ["P"] },
      { id: "distance_make", operator: "point_line_distance", inputs: { ...inputs(test), point: "P" }, outputs: ["distance"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: required,
    revealGroups: [{ id: "scene", entityIds: required, dependsOn: [], narrationCue: test.question }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "scene", dependsOn: [], narrationIntent: "Reveal only the engine-owned line, point and distance" }],
  };
}

for (const test of checklist.cases) {
  const geometry = evaluate(inputs(test));
  close(geometry.analyticLine.distance, test.distance);
  close(Math.abs(test.a * test.point[0] + test.b * test.point[1] + test.c) / Math.sqrt(test.a ** 2 + test.b ** 2), test.distance);
  const foot = geometry.analyticLine.foot;
  assert(foot);
  close(foot.x, test.foot[0]); close(foot.y, test.foot[1]);
  close(test.a * foot.x + test.b * foot.y + test.c, 0);
  close(-test.b * (test.point[0] - foot.x) + test.a * (test.point[1] - foot.y), 0);
  if (geometry.kind === "path") {
    close(geometry.points[1]!.x, foot.x); close(geometry.points[1]!.y, foot.y);
  }
  for (const factor of [-7, 0.25, 13]) {
    const scaled = evaluate({ ...inputs(test), a: test.a * factor, b: test.b * factor, c: test.c * factor });
    close(scaled.analyticLine.distance, test.distance);
  }
  const translated = evaluate({ ...inputs(test), point: [test.point[0] - 11, test.point[1] + 8], c: test.c + 11 * test.a - 8 * test.b });
  close(translated.analyticLine.distance, test.distance);
  close(translated.analyticLine.foot?.x, test.foot[0] - 11);
  close(translated.analyticLine.foot?.y, test.foot[1] + 8);
  const rotated = evaluate({ ...inputs(test), point: [-test.point[1], test.point[0]], a: -test.b, b: test.a });
  close(rotated.analyticLine.distance, test.distance);
  close(rotated.analyticLine.foot?.x, -test.foot[1]);
  close(rotated.analyticLine.foot?.y, test.foot[0]);
  const source = document(test);
  const result = compileSceneDocument(source);
  writeFileSync(join(directory, `${test.id}.json`), JSON.stringify({ source, result }, null, 2));
  if (!result.ok || !result.renderScene) {
    assert.equal(result.renderScene, null, "Decline must have no partial scene");
    findings.push({ control: `${test.id}-compile`, observed: result.report.issues, expected: "Complete line, point and computed foot connector must compile" });
    continue;
  }
  assert.deepEqual(compileSceneDocument(source), result, "Compile must be deterministic");
  for (const primitive of result.renderScene.primitives) {
    for (const point of primitive.points) {
      assert(Number.isFinite(point.x) && Number.isFinite(point.y));
      if (point.x < 400 || point.x > 1160 || point.y < 0 || point.y > 700) findings.push({ control: `${test.id}-viewport`, observed: primitive, expected: "Every rendered point inside x400–1160/y0–700" });
    }
  }
  writeFileSync(join(directory, `${test.id}.svg`), renderSceneSvg(result.renderScene, { title: test.id, subtitle: "OFFLINE ONLY; Cartesian units; independently frozen expected distance=" + test.distance }));
}

const base = checklist.cases[0]!;
const reviewerCases = [
  { point: [2, 3], a: 3, b: 4, c: -10, distance: 8 / 5, foot: [26 / 25, 43 / 25] },
  { point: [2, 1], a: 1, b: 0, c: -2, distance: 0, foot: [2, 1] },
  { point: [5, -1], a: 0, b: 1, c: -2, distance: 3, foot: [5, 2] },
  { point: [0, 0], a: -6, b: 8, c: 5, distance: 1 / 2, foot: [3 / 10, -2 / 5] },
];
for (const test of reviewerCases) {
  const geometry = evaluate({ point: test.point, a: test.a, b: test.b, c: test.c });
  close(geometry.analyticLine.distance, test.distance);
  close(geometry.analyticLine.foot?.x, test.foot[0]!);
  close(geometry.analyticLine.foot?.y, test.foot[1]!);
  close(test.a * test.foot[0]! + test.b * test.foot[1]! + test.c, 0);
}
close(-6 * (-3 / 10) + 8 * (2 / 5) + 5, 10);
writeFileSync(join(directory, "reviewer-oracle-control.json"), JSON.stringify({
  cases: reviewerCases,
  originalReviewerHoldoutFoot: [-3 / 10, 2 / 5],
  originalFootResidual: 10,
  correctedFoot: [3 / 10, -2 / 5],
  authority: "Independent line incidence and projection; reviewer holdout sign error preserved, not accepted",
}, null, 2));
for (const mutation of [{ a: 0, b: 0 }, { a: NaN }, { a: { value: 3, unit: "px" } }, { distance: 500 }, { displayScale: 100 }]) {
  assert.throws(() => evaluate({ ...inputs(base), ...mutation })); checks += 1;
  const source = document(base);
  Object.assign(source.constructions[2]!.inputs, mutation);
  const rejected = compileSceneDocument(source);
  assert.equal(rejected.ok, false); assert.equal(rejected.renderScene, null); checks += 1;
}
assert.throws(() => evaluate({ point: [0, 1e-9], a: 0, b: 1, c: 0 }), /nonzero source distance is below drawable resolution/);
checks += 1;
const smallSource = document({ ...base, point: [0, 1e-4], a: 0, b: 1, c: 0, distance: 1e-4, foot: [0, 0], question: "In Cartesian units, find the distance from (0,0.0001) to y=0." });
const smallResult = compileSceneDocument(smallSource);
assert(smallResult.ok && smallResult.renderScene);
assert(smallResult.renderScene.primitives.some((primitive) => primitive.entityId === "distance" && primitive.text === "d=0.0001"));
checks += 1;
const fitted = evaluate({ ...inputs(base), displayLength: 2 });
assert(fitted.kind === "path");
close(Math.hypot(fitted.points[1]!.x - fitted.points[0]!.x, fitted.points[1]!.y - fitted.points[0]!.y), 2);
for (const derivedPoint of [false, true]) {
  const source = document(base);
  if (derivedPoint) source.constructions[1] = { id: "point_make", operator: "midpoint", inputs: { a: [0, 0], b: [0, 0] }, outputs: ["P"] };
  source.constructions[2]!.inputs.displayLength = 2;
  const result = compileSceneDocument(source);
  assert.equal(result.ok, false); assert.equal(result.renderScene, null); checks += 1;
  writeFileSync(join(directory, `mutation-fitted-${derivedPoint ? "derived" : "literal"}.json`), JSON.stringify({ source, result }, null, 2));
}
for (const mutation of ["coefficient", "numeric-label"] as const) {
  const source = document(base);
  if (mutation === "coefficient") source.constructions[2]!.inputs.c = -50;
  else source.entities[2]!.label = "d=500";
  const result = compileSceneDocument(source);
  if (mutation === "numeric-label") {
    assert.equal(result.ok, false); assert.equal(result.renderScene, null); checks += 1;
  } else if (result.ok) findings.push({ control: `source-mutated-${mutation}`, observed: result, expected: "Independent source authority must reject altered coefficient; direct compiler is not higher-level admission" });
  writeFileSync(join(directory, `mutation-${mutation}.json`), JSON.stringify({ source, result }, null, 2));
}
for (const text of ["d=500", "d=5 m", "d=0", "H=(3,4)"]) {
  const source = document(base);
  source.annotations.push({ id: "claim", kind: "callout", targetIds: ["distance"], text });
  const result = compileSceneDocument(source);
  assert.equal(result.ok, false); assert.equal(result.renderScene, null); checks += 1;
}
const quantityClaim = document(base);
quantityClaim.quantities.push({ id: "claimed_distance", symbol: "d", value: 500, unit: "units" });
quantityClaim.annotations.push({ id: "quantity_claim", kind: "callout", targetIds: ["distance"], quantityId: "claimed_distance" });
const quantityResult = compileSceneDocument(quantityClaim);
assert.equal(quantityResult.ok, false); assert.equal(quantityResult.renderScene, null); checks += 1;
const correctLabel = document(base);
correctLabel.entities[2]!.label = "d=5";
assert.equal(compileSceneDocument(correctLabel).ok, true); checks += 1;
const report = { topic: "maths|10|point-to-line-distance", stage: findings.length ? "blocked-shared-seam-proposals" : "offline-qualification-only", checklistSha256: createHash("sha256").update(bytes).digest("hex"), checks, cases: checklist.cases.map(({ id, holdout }) => ({ id, holdout: !!holdout })), findings, live: "not run", acceptedCountChange: 0 };
writeFileSync(join(directory, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ checks, offlineVariants: checklist.cases.length, findings: findings.map(({ control }) => control), acceptedCountChange: 0 }));
