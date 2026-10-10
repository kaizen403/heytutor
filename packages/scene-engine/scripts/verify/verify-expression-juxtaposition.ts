/**
 * Juxtaposition in the expression reader: `x^3 - 3x` is read as x^3 - 3*x,
 * and only where there is one possible reading.
 *
 * 1. Accepted forms evaluate to independently computed values.
 * 2. Ambiguous forms keep failing closed (`1/2x`, `e^2x`, `(x+1)2`, `2e`,
 *    `sin2x`, `xy`, a stray `x` in a parametric expression).
 * 3. No meaning change: every expression-shaped string literal in the scene
 *    engine and tutor core sources and the question bank is read with the explicit grammar and with
 *    juxtaposition; whatever the explicit grammar accepts must evaluate (and
 *    differentiate) identically, and whatever only juxtaposition accepts must
 *    equal the explicit product written at the same place.
 * 4. A whole scene document with `x^3 - 3x` compiles with its true turning
 *    point labels and fails with wrong ones.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import {
  evaluateMathExpression,
  parseMathExpression,
  parseMathExpression2D,
  parseParameterizedMathExpression,
} from "../../src/math/expression";
import type { SceneDocument } from "../../src/types";

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  assert(condition, message);
}
function close(actual: number, expected: number, message: string): void {
  check(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function throws(read: () => unknown, message: string): void {
  let threw = false;
  try { read(); } catch { threw = true; }
  check(threw, message);
}

// 1. Accepted forms, with values computed here rather than by the reader.
const { sin, cos, exp, sqrt, PI } = Math;
for (const [source, x, expected] of [
  ["x^3 - 3x", -1, 2], ["x^3 - 3x", 1, -2], ["x^3 - 3x", 2, 2], ["x^3-3x", -2, -2],
  ["3x", 1.5, 4.5], ["2pi", 0, 2 * PI], ["2pi*x", 0.5, PI], ["2(x+1)", 1.5, 5],
  ["3sin(x)", 0.7, 3 * sin(0.7)], ["2exp(x)", 1, 2 * exp(1)], ["sqrt(2)x", 3, 3 * sqrt(2)],
  // Power binds tighter than juxtaposition: 3x^2 is 3*(x^2), never (3x)^2.
  ["4x^2", 1.5, 9], ["3x^2", -2, 12], ["-3x^2", 2, -12], ["2(x)^2", 3, 18], ["2(x+1)^2", 1, 8],
  ["(x+1)(x-1)", 3, 8], ["(x+1)x", 2, 6], ["(x+1)(x-1)(x+2)", 2, 12], ["sin(x)cos(x)", 0.5, sin(0.5) * cos(0.5)],
  ["-2x", 3, -6], ["2x/3", 3, 2], ["x/2*3x", 2, 6], [".5x", 4, 2], ["1.25x", 4, 5],
  ["x^2 - 4x + 3", 1, 0], ["3x - 2(x-1)", 5, 7], ["2sin(x)^2", 0.3, 2 * sin(0.3) ** 2],
  // Scientific notation keeps its meaning.
  ["2e3", 0, 2000], ["1.5e-2", 0, 0.015], ["2E3*x", 2, 4000], ["1e3*2x", 1, 2000],
] as Array<[string, number, number]>) {
  close(parseMathExpression(source).evaluate(x), expected, `accepted form ${source} at x=${x}`);
}
close(parseMathExpression("x^3 - 3x").derivative(1), 0, "turning point derivative of x^3 - 3x at 1");
close(parseMathExpression("x^3 - 3x").derivative(-1), 0, "turning point derivative of x^3 - 3x at -1");
close(parseMathExpression("4x^2").derivative(1.5), 12, "derivative of 4x^2 at 1.5");
for (const [source, x, y, expected] of [
  ["2x + 3y - 6", 1.5, 2, 3], ["x^2 + 4y^2 - 4", 2, 0, 0], ["(x+1)y", 1.5, 2, 5], ["3x^2+2y^2-12", 1, 2, -1],
  ["(x-2)(y+1)", 4, 1, 4],
] as Array<[string, number, number, number]>) {
  close(parseMathExpression2D(source).evaluate(x, y), expected, `accepted 2-D form ${source}`);
}
for (const [source, parameter, at, expected] of [
  ["2t", "t", 2, 4], ["cos(2t)", "t", 1, cos(2)], ["(t+1)t", "t", 2, 6], ["3t^2-1", "t", 2, 11], ["t^3", "t", 2, 8],
  ["2theta", "theta", 0.5, 1], ["1+2cos(theta)", "theta", 0, 3], ["sin(3theta)", "theta", 0.5, sin(1.5)],
] as Array<[string, "t" | "theta", number, number]>) {
  close(parseParameterizedMathExpression(source, parameter).evaluate(at), expected, `accepted ${parameter} form ${source}`);
}

// 2. Ambiguous or unsupported forms fail closed.
for (const source of [
  "(x+1)2", "sin(x)2", // a trailing number is a flattened exponent as often as a product
  "x(x+1)", "pi(x+1)", "e(x+1)", // a name before ( reads as function notation
  "2e", "2e^x", "2e-x", "(x+1)e^x", "2ex", // scientific notation and the elementary charge
  "2e3x", "1.5e-2x", "2.x", // only a plain number multiplies by juxtaposition
  "sin2x", "sinx", "xsin(x)", "xy", "x2", "2xy", "2pix", // letter runs are one identifier, never split
  "1/2x", "x/2pi", "6/2(1+2)", "1/(2)x", "2x/3y", // a factor after / is read two ways
  "2^3x", "e^2x", "x^2(x+1)", "x^-2x", "x^(2)x", "sin(x)^2cos(x)", // a factor after an exponent is read two ways
  "3 x", "2 (x+1)", "(x+1) (x-1)", "2 pi", "x^3 - 3 x", // a space is not a product
  "2y", "2t", "2x(x+1)", "sin 2x", "|x|", "sign(x)*abs(x)^(1/3)",
]) throws(() => parseMathExpression(source), `ambiguous or unsupported one-variable form must reject: ${source}`);
for (const source of ["xy", "2xy", "x y", "x(y+1)", "y(x)", "xy - 1", "(x+1)2y", "1/2y"]) {
  throws(() => parseMathExpression2D(source), `ambiguous two-variable form must reject: ${source}`);
}
for (const [source, parameter] of [
  ["2x", "t"], ["x", "t"], ["x+t", "t"], ["2x", "theta"], ["t(t+1)", "t"], ["costheta", "theta"], ["2theta", "t"], ["2t", "theta"],
] as Array<[string, "t" | "theta"]>) {
  throws(() => parseParameterizedMathExpression(source, parameter), `parametric form must reject: ${source} in ${parameter}`);
}
// The numeric lanes (planner numbers, physics chains) keep the explicit grammar.
for (const source of ["3x", "2pi", "2(3)", "(1)(2)", "x^3 - 3x", "2sqrt(3)"]) {
  throws(() => evaluateMathExpression(source, 1), `evaluateMathExpression keeps explicit multiplication: ${source}`);
  throws(() => parseMathExpression(source, { juxtaposition: false }), `explicit grammar rejects ${source}`);
}
close(evaluateMathExpression("x^3 - 3*x", 2), 2, "explicit grammar still reads explicit products");

// 3. No meaning change over every expression-shaped literal in the sources.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const files: string[] = [];
function collect(directory: string): void {
  let entries: string[];
  try { entries = readdirSync(directory); } catch { return; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) collect(path);
    else if (/\.(ts|json|jsonl)$/.test(entry) && stat.size < 20e6) files.push(path);
  }
}
for (const directory of ["packages/scene-engine/scripts", "packages/scene-engine/src", "packages/scene-engine/fixtures", "packages/tutor-core/scripts", "packages/tutor-core/src", "data/question-bank"]) {
  collect(join(repoRoot, directory));
}
const literals = new Set<string>();
const stringLiteral = /"((?:[^"\\\n]|\\.){1,120})"|'((?:[^'\\\n]|\\.){1,120})'|`([^`$\\\n]{1,120})`/g;
for (const file of files) {
  for (const match of readFileSync(file, "utf8").matchAll(stringLiteral)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'\\])/g, "$1");
    if (value.trim() && /^[\sA-Za-z0-9+\-*/^().²³−–—]+$/.test(value) && /[0-9xy()^*/+-]/.test(value)) literals.add(value);
  }
}
// Expressions models wrote in recorded maths lab rounds, rejected or not.
for (const value of [
  "x^3 - 3x", "x^3 - 3*x", "x^3-3*x", "x^2", "x^3", "sin(x)", "abs(x)", "0", "1", "2*x+1", "1/sqrt(x - 1)", "-x+4",
  "x^2/4 + y^2/3 - 1", "x^2+y^2-4*x-6*y-12", "y^2-4*x", "y^2 - 4*x", "y - 1", "x^2/16 + y^2/9 - 1",
  "x^2+y^2-4*((x-3)^2+y^2)", "x^2 + y^2 - 4*x", "x - y + 1", "x + y - 1", "sin(x)+sin(2*x)", "sin(2*x)",
  "cos(pi*x)", "cos(2*pi*x)", "3-2*x", "3-0.75*(x-2)", "2-x", "2*x*(1-x)", "1/sqrt(x-1)", "1-(x-0.5)^2",
  "(10-3*x)/4", "t^3", "sin(t)", "cos(t)", "|x|", "sign(x)*abs(x)^(1/3)",
]) literals.add(value);

const XS = [-2.75, -1.3, -0.5, 0, 0.4, 1, 1.7, 2.9, 4.2];
const YS = [-1.9, 0.3, 2.6];
const outcome = (read: () => number): number | string => {
  try { return read(); } catch (error) { return `throw:${error instanceof Error ? error.message : String(error)}`; }
};
function attempt<T>(read: () => T): T | null {
  try { return read(); } catch { return null; }
}
/** Independent oracle: write `*` wherever juxtaposition was read, then use the explicit grammar. */
function explicitProduct(source: string): string {
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|\s+|./g) ?? [];
  let output = "";
  let previous = "";
  for (const token of tokens) {
    const plainNumber = /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(previous);
    if ((plainNumber || previous === ")") && /^[A-Za-z_(]/.test(token)) output += "*";
    output += token;
    previous = token;
  }
  return output;
}
let explicitOne = 0; let explicitTwo = 0; let explicitParametric = 0; let compared = 0;
const newlyAccepted: string[] = [];
for (const source of literals) {
  const strict = attempt(() => parseMathExpression(source, { juxtaposition: false }));
  const lenient = attempt(() => parseMathExpression(source));
  if (strict) {
    explicitOne += 1;
    check(lenient, `juxtaposition lost an explicit expression: ${source}`);
    for (const x of XS) {
      compared += 1;
      assert.equal(outcome(() => lenient.evaluate(x)), outcome(() => strict.evaluate(x)), `value changed for ${source} at ${x}`);
      assert.equal(outcome(() => lenient.derivative(x)), outcome(() => strict.derivative(x)), `derivative changed for ${source} at ${x}`);
    }
  } else if (lenient) {
    newlyAccepted.push(source);
    const oracle = parseMathExpression(explicitProduct(source), { juxtaposition: false });
    for (const x of XS) {
      compared += 1;
      assert.equal(outcome(() => lenient.evaluate(x)), outcome(() => oracle.evaluate(x)), `${source} must equal ${explicitProduct(source)} at ${x}`);
    }
  }
  const strict2 = attempt(() => parseMathExpression2D(source, { juxtaposition: false }));
  const lenient2 = attempt(() => parseMathExpression2D(source));
  if (strict2) {
    explicitTwo += 1;
    check(lenient2, `juxtaposition lost an explicit 2-D expression: ${source}`);
    for (const x of XS) for (const y of YS) {
      compared += 1;
      assert.equal(outcome(() => lenient2.evaluate(x, y)), outcome(() => strict2.evaluate(x, y)), `2-D value changed for ${source} at (${x}, ${y})`);
    }
  } else if (lenient2) {
    const oracle = parseMathExpression2D(explicitProduct(source), { juxtaposition: false });
    for (const x of XS) for (const y of YS) {
      compared += 1;
      assert.equal(outcome(() => lenient2.evaluate(x, y)), outcome(() => oracle.evaluate(x, y)), `2-D ${source} must equal ${explicitProduct(source)}`);
    }
  }
  // The token-level parameter reader against the text substitution it replaces in the compiler.
  for (const parameter of ["t", "theta"] as const) {
    const legacy = /\bx\b/.test(source)
      ? null
      : attempt(() => parseMathExpression(source.replace(new RegExp(`\\b${parameter}\\b`, "g"), "x"), { juxtaposition: false }));
    if (!legacy) continue;
    explicitParametric += 1;
    const token = attempt(() => parseParameterizedMathExpression(source, parameter));
    check(token, `parameter reader lost ${source} in ${parameter}`);
    for (const at of XS) {
      compared += 1;
      assert.equal(outcome(() => token.evaluate(at)), outcome(() => legacy.evaluate(at)), `${parameter} value changed for ${source} at ${at}`);
    }
  }
}
// A blind scan would pass vacuously; these floors are well under today's counts.
check(files.length >= 300, `literal scan read too few files: ${files.length}`);
check(explicitOne >= 400 && explicitTwo >= 400 && explicitParametric >= 500, `literal scan found too few expressions: ${explicitOne}/${explicitTwo}/${explicitParametric}`);
check(newlyAccepted.includes("x^3 - 3x"), "the recorded x^3 - 3x is newly accepted");

// 4. Whole documents: the recorded function_curve with exact turning point labels.
function emptyDocument(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "juxtaposition regression" },
    source: { question: "" }, quantities: [], entities: [], constructions: [],
    relations: [], assertions: [], annotations: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [],
  };
}
function cubicScene(expression: string, anchors: Array<[number, string]>): SceneDocument {
  const scene = emptyDocument();
  scene.source.question = "Find the maxima and minima of f(x) = x^3 - 3x and sketch its graph for -2 <= x <= 2.";
  scene.entities = [
    { id: "curve", kind: "polyline", role: "graph" },
    ...anchors.map((_, index) => ({ id: `p${index}`, kind: "point" as const, role: "turning point" })),
  ];
  scene.constructions = [
    { id: "curve_make", operator: "function_curve", inputs: { expression, variable: "x", xMin: -2, xMax: 2, samples: 129 }, outputs: ["curve"] },
    ...anchors.map(([at], index) => ({ id: `p${index}_make`, operator: "curve_anchor", inputs: { curve: "curve", at }, outputs: [`p${index}`] })),
  ];
  scene.annotations = anchors.map(([, text], index) => ({ id: `l${index}`, kind: "label", targetIds: [`p${index}`], text }));
  scene.requiredEntityIds = ["curve"];
  scene.revealGroups = [{ id: "scene", entityIds: scene.entities.map((entity) => entity.id), dependsOn: [], narrationCue: "graph" }];
  scene.teachingTimeline = [{ id: "reveal", action: "reveal", targetId: "scene", dependsOn: [], narrationIntent: "graph" }];
  return scene;
}
function compiles(scene: SceneDocument): boolean {
  const validated = validateSceneDocument(scene);
  return validated.document !== null && compileSceneDocument(validated.document).ok;
}
const turningPoints: Array<[number, string]> = [[-1, "(-1, 2)"], [1, "(1, -2)"]];
check(compiles(cubicScene("x^3 - 3x", turningPoints)), "x^3 - 3x with labels (-1, 2) and (1, -2) must compile");
check(compiles(cubicScene("x^3 - 3*x", turningPoints)), "the explicit control x^3 - 3*x must compile");
for (const [anchors, reason] of [
  [[[-1, "(-1, -2)"], [1, "(1, -2)"]], "maximum value sign flipped"],
  [[[-1, "(-1, 2)"], [1, "(1, 2)"]], "minimum value sign flipped"],
  [[[-1, "(-1, 3)"], [1, "(1, -2)"]], "wrong maximum value"],
  [[[-1, "(1, 2)"], [1, "(1, -2)"]], "wrong maximum coordinate"],
  [[[-1, "(-1, 2)"], [1, "(1, -3)"]], "wrong minimum value"],
] as Array<[Array<[number, string]>, string]>) {
  check(!compiles(cubicScene("x^3 - 3x", anchors)), `x^3 - 3x must reject: ${reason}`);
}
for (const expression of ["x^3 - 3 x", "x^3 - 3x(x)", "1/2x^3 - 3x", "x^3 - 3x2"]) {
  check(!compiles(cubicScene(expression, turningPoints)), `ambiguous function_curve must not compile: ${expression}`);
}
// A stray x in a parametric expression never draws, even where validation reads `2x` as a product.
function parametricScene(xExpression: string): SceneDocument {
  const scene = emptyDocument();
  scene.source.question = "Sketch the parametric curve x = 2t, y = t^2 for -1 <= t <= 1.";
  scene.entities = [{ id: "curve", kind: "polyline", role: "parametric graph" }];
  scene.constructions = [{ id: "curve_make", operator: "parametric_curve", inputs: { xExpression, yExpression: "t^2", tMin: -1, tMax: 1 }, outputs: ["curve"] }];
  scene.requiredEntityIds = ["curve"];
  scene.revealGroups = [{ id: "scene", entityIds: ["curve"], dependsOn: [], narrationCue: "graph" }];
  scene.teachingTimeline = [{ id: "reveal", action: "reveal", targetId: "scene", dependsOn: [], narrationIntent: "graph" }];
  return scene;
}
check(compiles(parametricScene("2*t")), "explicit parametric control must compile");
check(!compiles(parametricScene("2x")), "parametric xExpression 2x must not compile as 2t");

console.log(`expression juxtaposition: ${checks} checks; ${literals.size} literals from ${files.length} files, ${explicitOne}/${explicitTwo}/${explicitParametric} explicit 1-D/2-D/parametric expressions unchanged over ${compared} comparisons; ${newlyAccepted.length} newly accepted equal their explicit products; x^3 - 3x compiles with exact turning point labels and rejects wrong ones`);
