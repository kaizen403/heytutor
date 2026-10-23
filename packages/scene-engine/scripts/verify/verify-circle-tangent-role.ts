/**
 * A tangent line role is derived by the operator that fits the curve it touches.
 *
 * circle_tangent_at takes a constructed circle and a point proven on it and
 * places the line perpendicular to the radius, so it derives a "tangent line"
 * on a circle. conic_tangent derives it on a conic from the typed conic
 * definition (the curve point at parameter at, along the analytic derivative).
 * tangent_line stays required for a function, parametric or polar curve. A guessed path (segment, line) is still refused, and every refusal
 * names the operator that fits the curve kind, so repair feedback never points
 * at an operator that cannot draw the tangent.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument, SceneIssue } from "../../src/types";

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  assert.ok(condition, message);
}
const fatal = (issues: SceneIssue[]) => issues.filter((issue) => issue.severity === "fatal");
const issueOf = (document: SceneDocument, code: string) =>
  validateSceneDocument(document).report.issues.find((issue) => issue.code === code && issue.severity === "fatal");

type Construction = SceneDocument["constructions"][number];
type Entity = SceneDocument["entities"][number];
function doc(entities: Entity[], constructions: Construction[], assertions: SceneDocument["assertions"] = []): SceneDocument {
  const ids = entities.map((entity) => entity.id);
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "tangent role derivation" },
    source: {},
    quantities: [],
    entities,
    constructions,
    relations: [],
    assertions,
    annotations: [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "circle and tangent" }],
    teachingTimeline: [],
  } as unknown as SceneDocument;
}

const circleBase: { entities: Entity[]; constructions: Construction[] } = {
  entities: [
    { id: "O", kind: "point", role: "center", label: "O" },
    { id: "P", kind: "point", role: "point of tangency", label: "P" },
    { id: "k", kind: "circle", role: "circle" },
    { id: "OP", kind: "segment", role: "radius", label: "r" },
  ] as Entity[],
  constructions: [
    { id: "cO", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
    { id: "cP", operator: "point", inputs: { x: 1.8, y: 2.4, coordinateSpace: "world" }, outputs: ["P"] },
    { id: "ck", operator: "circle", inputs: { center: "O", radius: 3 }, outputs: ["k"] },
    { id: "cOP", operator: "segment", inputs: { start: "O", end: "P" }, outputs: ["OP"] },
  ] as Construction[],
};
const perpendicular = [
  { id: "perp", predicate: "perpendicular", entities: ["OP", "l"], expected: true, severity: "fatal" },
] as SceneDocument["assertions"];
function circleTangent(role = "tangent line", point = "P"): SceneDocument {
  return doc(
    [...circleBase.entities, { id: "l", kind: "line", role, label: "l" } as Entity],
    [...circleBase.constructions, { id: "cl", operator: "circle_tangent_at", inputs: { circle: "k", point, span: 6 }, outputs: ["l"] } as Construction],
    perpendicular,
  );
}
function guessedCircleTangent(operator: "segment" | "line"): SceneDocument {
  return doc(
    [...circleBase.entities,
      { id: "A", kind: "point", role: "tangent end" } as Entity,
      { id: "B", kind: "point", role: "tangent end" } as Entity,
      { id: "l", kind: operator === "segment" ? "segment" : "line", role: "tangent line", label: "l" } as Entity],
    [...circleBase.constructions,
      { id: "cA", operator: "point", inputs: { x: 4.2, y: 0.6, coordinateSpace: "world" }, outputs: ["A"] } as Construction,
      { id: "cB", operator: "point", inputs: { x: -0.6, y: 4.2, coordinateSpace: "world" }, outputs: ["B"] } as Construction,
      { id: "cl", operator, inputs: { start: "A", end: "B" }, outputs: ["l"] } as Construction],
  );
}
function tangentLineOnCircle(): SceneDocument {
  return doc(
    [...circleBase.entities, { id: "l", kind: "line", role: "tangent line", label: "l" } as Entity],
    [...circleBase.constructions, { id: "cl", operator: "tangent_line", inputs: { curve: "k", at: 0.9273, span: 6 }, outputs: ["l"] } as Construction],
  );
}
const functionBase: { entities: Entity[]; constructions: Construction[] } = {
  entities: [
    { id: "axes", kind: "axes", role: "display axes" },
    { id: "curve", kind: "polyline", role: "graph of x^2" },
  ] as Entity[],
  constructions: [
    { id: "cAxes", operator: "axes", inputs: { xMin: -3, xMax: 3, yMin: -1, yMax: 9 }, outputs: ["axes"] },
    { id: "cCurve", operator: "function_curve", inputs: { expression: "x^2", xMin: -3, xMax: 3, samples: 33 }, outputs: ["curve"] },
  ] as Construction[],
};
function functionTangent(operator: "tangent_line" | "segment" | "circle_tangent_at"): SceneDocument {
  const extraEntities: Entity[] = operator === "segment"
    ? [{ id: "A", kind: "point", role: "tangent end" } as Entity, { id: "B", kind: "point", role: "tangent end" } as Entity]
    : operator === "circle_tangent_at" ? [{ id: "P", kind: "point", role: "contact" } as Entity] : [];
  const extraConstructions: Construction[] = operator === "segment"
    ? [{ id: "cA", operator: "point", inputs: { x: 0, y: -1, coordinateSpace: "world" }, outputs: ["A"] } as Construction,
      { id: "cB", operator: "point", inputs: { x: 2, y: 3, coordinateSpace: "world" }, outputs: ["B"] } as Construction]
    : operator === "circle_tangent_at" ? [{ id: "cP", operator: "point", inputs: { x: 1, y: 1, coordinateSpace: "world" }, outputs: ["P"] } as Construction] : [];
  const inputs = operator === "tangent_line" ? { curve: "curve", at: 1, span: 3 }
    : operator === "segment" ? { start: "A", end: "B" } : { circle: "curve", point: "P", span: 3 };
  return doc(
    [...functionBase.entities, ...extraEntities, { id: "t", kind: operator === "segment" ? "segment" : "line", role: "tangent line at x = 1" } as Entity],
    [...functionBase.constructions, ...extraConstructions, { id: "ct", operator, inputs, outputs: ["t"] } as Construction],
  );
}

// 1. A circle tangent drawn with circle_tangent_at is accepted and compiles perpendicular to OP.
for (const role of ["tangent line", "tangent line at P", "tangent line to the circle"]) {
  const document = circleTangent(role);
  const issues = fatal(validateSceneDocument(document).report.issues);
  check(issues.length === 0, `${role} via circle_tangent_at validates: ${JSON.stringify(issues)}`);
  const compiled = compileSceneDocument(document);
  check(compiled.ok && compiled.renderScene, `${role} via circle_tangent_at compiles: ${JSON.stringify(fatal(compiled.report.issues))}`);
  const line = compiled.renderScene.primitives.find((primitive) => primitive.entityId === "l" && Array.isArray((primitive as { points?: unknown }).points)) as { points: Array<{ x: number; y: number }> } | undefined;
  const radius = compiled.renderScene.primitives.find((primitive) => primitive.entityId === "OP" && Array.isArray((primitive as { points?: unknown }).points)) as { points: Array<{ x: number; y: number }> } | undefined;
  check(line && radius && line.points.length >= 2 && radius.points.length >= 2, `${role}: tangent and radius render as paths`);
  const [l0, l1] = [line.points[0]!, line.points.at(-1)!];
  const [r0, r1] = [radius.points[0]!, radius.points.at(-1)!];
  const dot = (l1.x - l0.x) * (r1.x - r0.x) + (l1.y - l0.y) * (r1.y - r0.y);
  const scale = Math.hypot(l1.x - l0.x, l1.y - l0.y) * Math.hypot(r1.x - r0.x, r1.y - r0.y);
  check(Math.abs(dot) <= scale * 1e-4, `${role}: the rendered tangent (pixel rounded) is perpendicular to the radius (cos ${dot / scale})`);
}
// circle_tangent_at still proves its point is on the circle.
check(!compileSceneDocument(doc(
  [...circleBase.entities, { id: "Q", kind: "point", role: "off point" } as Entity, { id: "l", kind: "line", role: "tangent line" } as Entity],
  [...circleBase.constructions, { id: "cQ", operator: "point", inputs: { x: 2, y: 2, coordinateSpace: "world" }, outputs: ["Q"] } as Construction,
    { id: "cl", operator: "circle_tangent_at", inputs: { circle: "k", point: "Q", span: 6 }, outputs: ["l"] } as Construction],
)).ok, "circle_tangent_at at a point off the circle is refused");

// 2. A guessed tangent on a circle is still refused, and the message names circle_tangent_at.
for (const operator of ["segment", "line"] as const) {
  const issue = issueOf(guessedCircleTangent(operator), "derived_role_operator_mismatch");
  check(issue, `a tangent line guessed with ${operator} on a circle is refused`);
  check(issue.expected === "circle_tangent_at", `guessed ${operator}: expected names circle_tangent_at, saw ${String(issue.expected)}`);
  check(/circle_tangent_at/.test(issue.message) && !/\btangent_line\b/.test(issue.message), `guessed ${operator}: message names only circle_tangent_at: ${issue.message}`);
  check(!compileSceneDocument(guessedCircleTangent(operator)).ok, `guessed ${operator} on a circle does not compile`);
}

// 3. tangent_line on a function is still required.
{
  const accepted = functionTangent("tangent_line");
  check(fatal(validateSceneDocument(accepted).report.issues).length === 0, `tangent_line on a function validates: ${JSON.stringify(fatal(validateSceneDocument(accepted).report.issues))}`);
  check(compileSceneDocument(accepted).ok, "tangent_line on a function compiles");
  const guessed = issueOf(functionTangent("segment"), "derived_role_operator_mismatch");
  check(guessed, "a tangent line guessed with segment on a function is refused");
  check(guessed.expected === "tangent_line", `guessed function tangent: expected tangent_line, saw ${String(guessed.expected)}`);
  check(/\btangent_line\b/.test(guessed.message) && /function_curve/.test(guessed.message) && !/circle_tangent_at/.test(guessed.message),
    `guessed function tangent: message names tangent_line for a function curve: ${guessed.message}`);
  const wrongTool = functionTangent("circle_tangent_at");
  check(!compileSceneDocument(wrongTool).ok, "circle_tangent_at on a function curve is refused");
  check(fatal(validateSceneDocument(wrongTool).report.issues).some((issue) => issue.path?.includes("inputs.circle")), "circle_tangent_at on a function curve is refused at its circle input");
}

// 4. tangent_line on a circle is refused and says to use circle_tangent_at.
{
  const issue = issueOf(tangentLineOnCircle(), "invalid_tangent_line_curve_reference");
  check(issue, "tangent_line referencing a circle is refused");
  check(/function_curve, parametric_curve, or polar_curve/.test(issue.message) && /circle_tangent_at/.test(issue.message),
    `invalid_tangent_line_curve_reference names circle_tangent_at for a circle: ${issue.message}`);
}

// 5. A document that builds both a circle and a function names both operators when the role is silent.
{
  const both = doc(
    [...circleBase.entities, ...functionBase.entities, { id: "A", kind: "point", role: "end" } as Entity, { id: "B", kind: "point", role: "end" } as Entity, { id: "l", kind: "segment", role: "tangent line" } as Entity],
    [...circleBase.constructions, ...functionBase.constructions,
      { id: "cA", operator: "point", inputs: { x: 4.2, y: 0.6, coordinateSpace: "world" }, outputs: ["A"] } as Construction,
      { id: "cB", operator: "point", inputs: { x: -0.6, y: 4.2, coordinateSpace: "world" }, outputs: ["B"] } as Construction,
      { id: "cl", operator: "segment", inputs: { start: "A", end: "B" }, outputs: ["l"] } as Construction],
  );
  const issue = issueOf(both, "derived_role_operator_mismatch");
  check(issue && /circle_tangent_at/.test(issue.message) && /\btangent_line\b/.test(issue.message), `ambiguous curve kind names both operators: ${issue?.message}`);
}

// 7. A conic tangent drawn with conic_tangent is accepted; conic_tangent cannot take a circle or a
//    function; a guessed tangent on a conic is refused naming conic_tangent.
function conicDoc(kind: "ellipse" | "parabola" | "hyperbola", tangent: "conic_tangent" | "segment", role = "tangent line"): SceneDocument {
  const conicInputs = kind === "parabola" ? { kind, vertex: "V", p: 1, tMin: -2, tMax: 2 }
    : kind === "hyperbola" ? { kind, center: "V", a: 2, b: 1, tMin: -1.5, tMax: 1.5 } : { kind, center: "V", a: 3, b: 2 };
  const guessed = tangent === "segment";
  return doc(
    [{ id: "V", kind: "point", role: "origin" } as Entity, { id: "c", kind: "polyline", role: kind } as Entity,
      ...(guessed ? [{ id: "A", kind: "point", role: "end" } as Entity, { id: "B", kind: "point", role: "end" } as Entity] : []),
      { id: "t", kind: guessed ? "segment" : "line", role } as Entity],
    [{ id: "cV", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["V"] } as Construction,
      { id: "cc", operator: "conic", inputs: conicInputs, outputs: ["c"] } as Construction,
      ...(guessed ? [{ id: "cA", operator: "point", inputs: { x: 3, y: -1, coordinateSpace: "world" }, outputs: ["A"] } as Construction,
        { id: "cB", operator: "point", inputs: { x: 3, y: 1, coordinateSpace: "world" }, outputs: ["B"] } as Construction] : []),
      { id: "ct", operator: tangent, inputs: guessed ? { start: "A", end: "B" } : { conic: "c", at: 0.5, span: 4, ...(kind === "hyperbola" ? { branch: 1 } : {}) }, outputs: ["t"] } as Construction],
  );
}
for (const kind of ["ellipse", "parabola", "hyperbola"] as const) {
  const document = conicDoc(kind, "conic_tangent");
  const issues = fatal(validateSceneDocument(document).report.issues);
  check(issues.length === 0, `tangent line on a ${kind} via conic_tangent validates: ${JSON.stringify(issues)}`);
  check(compileSceneDocument(document).ok, `tangent line on a ${kind} via conic_tangent compiles`);
  const issue = issueOf(conicDoc(kind, "segment"), "derived_role_operator_mismatch");
  check(issue, `a tangent line guessed with segment on a ${kind} is refused`);
  check(issue.expected === "conic_tangent" && /conic_tangent/.test(issue.message) && !/circle_tangent_at|\btangent_line\b/.test(issue.message),
    `guessed ${kind} tangent: message names only conic_tangent: ${issue.message}`);
}
{
  const onCircle = doc(
    [...circleBase.entities, { id: "l", kind: "line", role: "tangent line" } as Entity],
    [...circleBase.constructions, { id: "cl", operator: "conic_tangent", inputs: { conic: "k", at: 0.5, span: 4 }, outputs: ["l"] } as Construction],
  );
  check(fatal(validateSceneDocument(onCircle).report.issues).some((issue) => issue.code.startsWith("invalid_conic_tangent")), "conic_tangent on a circle operator is refused at validation");
  check(!compileSceneDocument(onCircle).ok, "conic_tangent on a circle operator does not compile");
  const onFunction = doc(
    [...functionBase.entities, { id: "t", kind: "line", role: "tangent line" } as Entity],
    [...functionBase.constructions, { id: "ct", operator: "conic_tangent", inputs: { conic: "curve", at: 1, span: 3 }, outputs: ["t"] } as Construction],
  );
  check(fatal(validateSceneDocument(onFunction).report.issues).some((issue) => issue.code.startsWith("invalid_conic_tangent")), "conic_tangent on a function curve is refused at validation");
  check(!compileSceneDocument(onFunction).ok, "conic_tangent on a function curve does not compile");
  const lineOnConic = issueOf(doc(
    [{ id: "V", kind: "point", role: "origin" } as Entity, { id: "c", kind: "polyline", role: "ellipse" } as Entity, { id: "t", kind: "line", role: "tangent line" } as Entity],
    [{ id: "cV", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["V"] } as Construction,
      { id: "cc", operator: "conic", inputs: { kind: "ellipse", center: "V", a: 3, b: 2 }, outputs: ["c"] } as Construction,
      { id: "ct", operator: "tangent_line", inputs: { curve: "c", at: 0.5, span: 4 }, outputs: ["t"] } as Construction],
  ), "invalid_tangent_line_curve_reference");
  check(lineOnConic && /conic_tangent/.test(lineOnConic.message), `tangent_line on a conic is refused and names conic_tangent: ${lineOnConic?.message}`);
}

// 6. Mutation control: without the circle_tangent_at acceptance the circle tangent goes red.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const validationPath = join(here, "../../src/document/validation.ts");
  const source = readFileSync(validationPath, "utf8");
  const anchor = 'actualOperator === "tangent_line" || actualOperator === "circle_tangent_at" || actualOperator === "conic_tangent"';
  check(source.split(anchor).length === 2, "mutation anchor appears exactly once in validation.ts");
  const mutants = [
    { name: "without circle_tangent_at", text: 'actualOperator === "tangent_line" || actualOperator === "conic_tangent"', red: circleTangent(), green: conicDoc("ellipse", "conic_tangent") },
    { name: "without conic_tangent", text: 'actualOperator === "tangent_line" || actualOperator === "circle_tangent_at"', red: conicDoc("ellipse", "conic_tangent"), green: circleTangent() },
  ];
  for (const [index, entry] of mutants.entries()) {
    const mutated = source.replace(anchor, entry.text);
    check(mutated !== source, `${entry.name}: the mutation changed the source`);
    const scratch = mkdtempSync(join(dirname(validationPath), `.m1-mutant-${index}-`));
    try {
      const mutantPath = join(scratch, "validation.ts");
      writeFileSync(mutantPath, mutated.replace(/from "\.\.\//g, 'from "../../').replace(/from "\.\//g, 'from "../'));
      const mutant = await import(pathToFileURL(mutantPath).href) as typeof import("../../src/document/validation");
      check(mutant.validateSceneDocument(entry.red).report.issues.some((issue) => issue.code === "derived_role_operator_mismatch"), `mutation control ${entry.name}: the tangent it no longer accepts is refused (red)`);
      check(!mutant.validateSceneDocument(entry.green).report.issues.some((issue) => issue.code === "derived_role_operator_mismatch"), `mutation control ${entry.name}: the other tangent is still accepted`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  check(fatal(validateSceneDocument(circleTangent()).report.issues).length === 0, "unmutated source still accepts the circle tangent");
  check(fatal(validateSceneDocument(conicDoc("ellipse", "conic_tangent")).report.issues).length === 0, "unmutated source still accepts the conic tangent");
}

console.log(`circle tangent role verification passed (${checks} checks)`);
