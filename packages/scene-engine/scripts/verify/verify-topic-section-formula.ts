import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateAnalyticLineConstruction } from "../../src/compile/analyticLineGeometry";
import * as source from "../../src/index";
import type { SceneDocument, TurnPlanV3 } from "../../src/index";

type Case = { id: string; mode: "internal" | "external" | "midpoint"; a: [number, number]; b: [number, number]; m: number; n: number; p: [number, number] };
const cases: Case[] = [
  { id: "internal", mode: "internal", a: [1, 1], b: [4, 5], m: 1, n: 2, p: [2, 7 / 3] },
  { id: "external-left", mode: "external", a: [2, -3], b: [-4, 5], m: 2, n: 5, p: [6, -25 / 3] },
  { id: "signed-internal", mode: "internal", a: [1, 2], b: [4, 8], m: -1, n: 2, p: [-2, -4] },
  { id: "signed-external", mode: "external", a: [1, 1], b: [4, 5], m: -4, n: 2, p: [3, 11 / 3] },
  { id: "midpoint", mode: "midpoint", a: [-5, 2], b: [7, -7], m: 1, n: 1, p: [1, -5 / 2] },
  { id: "vertical", mode: "internal", a: [-3, -5], b: [-3, 7], m: 5, n: 1, p: [-3, 5] },
  { id: "external-right", mode: "external", a: [-7, 4], b: [5, 4], m: 3, n: 1, p: [11, 4] },
  { id: "negative-common-scale", mode: "internal", a: [1, 1], b: [4, 5], m: -2, n: -4, p: [2, 7 / 3] },
  { id: "tiny-common-scale", mode: "internal", a: [1, 1], b: [4, 5], m: 1e-12, n: 2e-12, p: [2, 7 / 3] },
  { id: "zero-m", mode: "internal", a: [1, 1], b: [4, 5], m: 0, n: 3, p: [1, 1] },
  { id: "zero-n", mode: "external", a: [1, 1], b: [4, 5], m: 3, n: 0, p: [4, 5] },
  { id: "rotated-translated-holdout", mode: "internal", a: [9, -5], b: [1, -1], m: 3, n: 5, p: [6, -7 / 2] },
];
const questions = [
  "Which point divides A(1,1) to B(4,5) internally in AP:PB=1:2?",
  "Which finite point divides A(2,-3) and B(-4,5) externally with unsigned AP:PB=2:5?",
  "Under the directed internal formula with m:n=-1:2, locate P for A(1,2), B(4,8), and verify n(P-A)=m(B-P).",
  "Under the signed external formula with m:n=-4:2, locate P for A(1,1), B(4,5), using n(P-A)=-m(B-P).",
  "Find the midpoint of A(-5,2), B(7,-7).",
  "Which point divides the vertical segment A(-3,-5), B(-3,7) internally in AP:PB=5:1?",
  "Which point divides A(-7,4), B(5,4) externally in AP:PB=3:1?",
  "Scale both directed internal ratio weights by -2: A(1,1), B(4,5), m:n=-2:-4. Locate P and compare with 1:2.",
  "Scale both internal ratio weights by 10^-12: A(1,1), B(4,5), m=10^-12, n=2*10^-12. Is the section point still finite?",
  "For A(1,1), B(4,5), directed internal weights m=0,n=3 specify which endpoint?",
  "For A(1,1), B(4,5), signed external weights m=3,n=0 specify which endpoint?",
  "Holdout: rotate and translate a segment to A(9,-5), B(1,-1). Find P for internal AP:PB=3:5 and verify its signed vector relation.",
];
const observations: Array<{ name: string; ok: boolean; detail?: string }> = [];
const artifacts = process.argv.includes("--artifacts") ? resolve(process.argv[process.argv.indexOf("--artifacts") + 1]!) : null;
if (artifacts) {
  assert(artifacts.startsWith("/Users/kaizen/.capy/work/HEY-91/section-formula/"));
  mkdirSync(artifacts, { recursive: true });
}
function test(name: string, action: () => void): void {
  try { action(); observations.push({ name, ok: true }); }
  catch (error) { observations.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) }); }
}
function close(actual: number, expected: number): void {
  assert(Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}
function inputs(c: Case): Record<string, unknown> {
  return { a: c.a, b: c.b, mode: c.mode, ...(c.mode === "midpoint" ? {} : { m: c.m, n: c.n }) };
}
function document(c: Case): SceneDocument {
  const question = questions[cases.findIndex((entry) => entry.id === c.id)]!;
  const doc: SceneDocument = {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "Show the source endpoints, connecting segment and independently computed section point" },
    source: { question, provenance: "authored HEY-91; not native exam evidence" }, quantities: [],
    entities: [
      { id: "A", kind: "point", role: "source endpoint", label: `A(${c.a.join(",")})` },
      { id: "B", kind: "point", role: "source endpoint", label: `B(${c.b.join(",")})` },
      { id: "AB", kind: "segment", role: "source segment" },
      { id: "P", kind: "point", role: "section point", label: "P" },
    ],
    constructions: [
      { id: "a", operator: "point", inputs: { x: c.a[0], y: c.a[1] }, outputs: ["A"] },
      { id: "b", operator: "point", inputs: { x: c.b[0], y: c.b[1] }, outputs: ["B"] },
      { id: "ab", operator: "segment", inputs: { start: "A", end: "B" }, outputs: ["AB"] },
      { id: "section", operator: "section_point", inputs: { ...inputs(c), a: "A", b: "B" }, outputs: ["P"] },
    ],
    relations: [], assertions: [{ id: "collinear", predicate: "collinear", entities: ["A", "B", "P"], severity: "fatal" }], annotations: [],
    requiredEntityIds: ["A", "B", "AB", "P"],
    revealGroups: [{ id: "setup", entityIds: ["A", "B", "AB"], dependsOn: [], narrationCue: "Identify the source endpoints" }, { id: "answer", entityIds: ["P"], dependsOn: ["setup"], narrationCue: "Reveal the verified section point" }],
    teachingTimeline: [{ id: "show-setup", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Identify endpoints" }, { id: "show-answer", action: "reveal", targetId: "answer", dependsOn: ["show-setup"], narrationIntent: "Explain the section point" }],
  };
  const parameter = c.mode === "external" ? c.m / (c.m - c.n) : c.m / (c.m + c.n);
  if (Number.isFinite(parameter) && (parameter < 0 || parameter > 1)) {
    doc.entities.push({ id: "extension", kind: "segment", role: "source line extension to section point" });
    doc.constructions.push({ id: "extend-source-line", operator: "segment", inputs: { start: parameter < 0 ? "A" : "B", end: "P" }, outputs: ["extension"] });
    doc.requiredEntityIds.push("extension");
    doc.revealGroups[1]!.entityIds.push("extension");
  }
  return doc;
}
function plan(doc: SceneDocument): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question: String(doc.source.question), givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: ["section_formula"], assumptions: ["dimensionless Cartesian coordinate units"], visualRequirement: "required" };
}
const directContext = { number: (value: unknown) => Number(value), point: () => { throw new Error("unexpected point reference"); }, geometry: () => undefined };
for (const c of cases) test(`direct:${c.id}`, () => {
  const [geometry] = evaluateAnalyticLineConstruction("section_point", inputs(c), directContext);
  assert(geometry?.kind === "point");
  const p = [geometry.point.x, geometry.point.y];
  p.forEach((value, i) => close(value, c.p[i]!));
  close((p[0]! - c.a[0]) * (c.b[1] - c.a[1]) - (p[1]! - c.a[1]) * (c.b[0] - c.a[0]), 0);
  const sign = c.mode === "external" ? -1 : 1;
  p.forEach((value, i) => close(c.n * (value - c.a[i]!) - sign * c.m * (c.b[i]! - value), 0));
});
const publicApi = process.argv.includes("--emitted") ? await import("../../dist/index.js") : source;
for (const c of cases) test(`compiler:${c.id}`, () => {
  const doc = document(c);
  const validated = publicApi.validateSceneDocument(doc);
  assert(validated.document, JSON.stringify(validated.report.issues));
  const compiled = publicApi.compileSceneDocument(doc);
  assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  const points = ["A", "B", "P"].map((id) => compiled.renderScene!.primitives.find((primitive) => primitive.entityId === id && primitive.kind === "point")?.points[0]);
  if (c.m && c.n) {
    assert(points.every(Boolean), "all distinct source and derived points must render");
    const [a, b, p] = points;
    const t = c.mode === "external" ? c.m / (c.m - c.n) : c.m / (c.m + c.n);
    const screenTolerance = 0.005 * (1 + Math.abs(1 - t) + Math.abs(t)) + 1e-8;
    assert(Math.abs(p!.x - (a!.x + t * (b!.x - a!.x))) <= screenTolerance);
    assert(Math.abs(p!.y - (a!.y + t * (b!.y - a!.y))) <= screenTolerance);
  }
  assert(compiled.renderScene.primitives.filter((primitive) => primitive.kind === "point").flatMap((primitive) => primitive.points).every((point) => point.x >= 400 && point.x <= 1160 && point.y >= 0 && point.y <= 700));
  assert.deepEqual(publicApi.compileSceneDocument(doc), compiled, "deterministic repeated compile");
  if (artifacts) writeFileSync(resolve(artifacts, `${c.id}.scene.json`), JSON.stringify({ document: doc, compiled }, null, 2));
});
for (const [mode, m, n] of [["external", 2, 2], ["external", -3, -3], ["internal", 2, -2], ["external", 0, 0]] as const) test(`atomic:${mode}:${m}:${n}`, () => {
  const doc = document({ ...cases[0]!, mode, m, n });
  const compiled = publicApi.compileSceneDocument(doc);
  assert(!compiled.ok && compiled.renderScene === null, "singular candidate must fail atomically");
});
for (const mutation of [{ m: Infinity }, { n: NaN }, { mode: "ratio" }, { a: [0, 0, 0] }, { displayScale: 2 }]) test(`invalid:${JSON.stringify(mutation)}`, () => {
  const doc = document(cases[0]!);
  Object.assign(doc.constructions[3]!.inputs, mutation);
  const result = publicApi.compileSceneDocument(doc);
  assert(!result.ok && result.renderScene === null);
});
test("caller:source-endpoint-mutation", () => {
  const doc = document(cases[0]!);
  const turnPlan = plan(doc);
  doc.constructions[0]!.inputs.x = 99;
  assert(publicApi.validateTurnPlanSceneProofs(doc, turnPlan).some((issue) => issue.severity === "fatal"), "changed endpoint is not source-bound");
});
test("caller:source-ratio-sign-mutation", () => {
  const doc = document(cases[0]!);
  const turnPlan = plan(doc);
  doc.constructions[3]!.inputs.m = -1;
  assert(publicApi.validateTurnPlanSceneProofs(doc, turnPlan).some((issue) => issue.severity === "fatal"), "changed ratio sign is not source-bound");
});
test("compiler:wrong-coordinate-callout", () => {
  const doc = document(cases[0]!);
  doc.annotations.push({ id: "false-coordinate", kind: "callout", targetIds: ["P"], text: "P=(99,99)" });
  const result = publicApi.compileSceneDocument(doc);
  assert(!result.ok && result.renderScene === null, "false numeric coordinate callout compiled");
});
test("caller:missing-source", () => {
  const doc = document(cases[0]!);
  delete doc.source.question;
  assert(publicApi.validateTurnPlanSceneProofs(doc, null).some((issue) => issue.severity === "fatal"), "section point accepted without source question");
});
console.log(JSON.stringify({ mode: process.argv.includes("--emitted") ? "emitted-public" : "source-public", provenance: "authored; not native exam evidence", observations }, null, 2));
if (artifacts) writeFileSync(resolve(artifacts, "gate-results.json"), JSON.stringify(observations, null, 2));
const failures = observations.filter((observation) => !observation.ok);
console.log(`${observations.length - failures.length}/${observations.length} section-formula checks passed; ${failures.length} gaps`);
if (failures.length) process.exitCode = 1;
