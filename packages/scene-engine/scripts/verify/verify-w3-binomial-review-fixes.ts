import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOARD_TYPE_STEPS, MIN_BOARD_FONT_SIZE, measureWrittenTextInkBounds, snapToBoardTypeScale, textToStrokePaths } from "@heytutor/drawing";
import type { CompileOptions, ExpressionNodeIR, ProblemIR, RenderScene } from "../../src/index";

const esm = process.argv.includes("--esm");
const engine: typeof import("../../src/index") = esm
  ? await import(new URL("../../dist/index.js", import.meta.url).href) : await import("../../src/index");
const artifactArg = process.argv.find(arg => arg.startsWith("--artifact="));
const artifactDir = artifactArg ? resolve(artifactArg.slice("--artifact=".length)) : null;
if (artifactDir) mkdirSync(artifactDir, { recursive: true });
const mode = esm ? "esm" : "source";
const results: { name: string; passed: boolean; error?: string }[] = [];
const snapshots: unknown[] = [];
function check(name: string, run: () => void): void {
  try { run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: String(error) }); }
}
const n = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const x: ExpressionNodeIR = { kind: "variable", name: "x" };
const b = (operator: "+" | "-" | "*" | "/" | "^", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
const power = (root: ExpressionNodeIR, exponent: number) => b("^", root, n(exponent));
// Complete independent caller profiles: neither facts nor ASTs come from the
// source reader. The last occurrence is the explicitly authored payload span.
function fullIR(question: string, expression: string, request: string, root: ExpressionNodeIR, expected?: number): ProblemIR {
  const evidence = (quote: string, start: number) => ({ source: "question" as const, quote, start, end: start + quote.length });
  return {
    schemaVersion: "problem-ir/v1", id: "review_actual_problem", question,
    facts: [
      { id: "given", kind: "given", statement: expression, evidence: evidence(expression, question.lastIndexOf(expression)) },
      { id: "asked", kind: "requested", statement: request, evidence: evidence(request, question.indexOf(request)) },
    ],
    entities: [{ id: "P", kind: "other", label: "P(x)", evidenceFactIds: ["given"] }],
    expressions: [{ id: "polynomial", valueType: "function", root, evidenceFactIds: ["given"] },
      ...(expected === undefined ? [] : [{ id: "answer", valueType: "scalar" as const, root: n(expected), evidenceFactIds: ["asked"] }])],
    constraints: [],
    representationIntents: [{ id: "table", kind: "conceptual", entityIds: ["P"], evidenceFactIds: ["given", "asked"] }],
    solveRequests: expected === undefined ? [] : [{ id: "actual_ask", kind: "evaluate", expressionId: "answer",
      resultBinding: { turnPlanQuantityId: "actual_coefficient", symbol: "c", unit: "1", evidenceFactIds: ["asked"] } }],
  };
}
function choose(total: number, selected: number): number {
  const factorial = (value: number) => Array.from({ length: value }, (_, i) => i + 1).reduce((a, v) => a * v, 1);
  return factorial(total) / (factorial(selected) * factorial(total - selected));
}
type Case = { name: string; question: string; expression: string; request: string; root: ExpressionNodeIR; expected?: number; coefficients: string[] };
const cases: Case[] = [
  { name: "repeated_x3", question: "Coefficient of x^3 in the expansion of x^3 is", expression: "x^3", request: "Coefficient of x^3 in the expansion of", root: power(x, 3), expected: 1, coefficients: ["0", "0", "0", "1"] },
  { name: "repeated_x", question: "Coefficient of x^1 in the expansion of x is", expression: "x", request: "Coefficient of x^1 in the expansion of", root: x, expected: 1, coefficients: ["0", "1"] },
  { name: "numbered_find_x7", question: "  8. Find the coefficient of x^7 in expansion of   x^7.  ", expression: "x^7", request: "Find the coefficient of x^7 in expansion of", root: power(x, 7), expected: 1, coefficients: ["0", "0", "0", "0", "0", "0", "0", "1"] },
  { name: "parenthesized", question: "Coefficient of x^3 in the expansion of (x^3) is", expression: "(x^3)", request: "Coefficient of x^3 in the expansion of", root: power(x, 3), expected: 1, coefficients: ["0", "0", "0", "1"] },
  { name: "sum_control", question: "Coefficient of x^3 in the expansion of x^3+x is", expression: "x^3+x", request: "Coefficient of x^3 in the expansion of", root: b("+", power(x, 3), x), expected: 1, coefficients: ["0", "1", "0", "1"] },
  { name: "different_signed", question: "Find the coefficient of x^3 in the expansion of (3-2x)^5.", expression: "(3-2x)^5", request: "Find the coefficient of x^3 in the expansion of", root: power(b("-", n(3), b("*", n(2), x)), 5), expected: -720, coefficients: ["243", "-810", "1080", "-720"] },
  { name: "rational", question: "Expand (2/3-x/4)^3.", expression: "(2/3-x/4)^3", request: "Expand", root: power(b("-", b("/", n(2), n(3)), b("/", x, n(4))), 3), coefficients: ["8/27", "-1/3", "1/8", "-1/64"] },
  { name: "power15", question: "Expand (2-x)^15.", expression: "(2-x)^15", request: "Expand", root: power(b("-", n(2), x), 15), coefficients: Array.from({ length: 16 }, (_, k) => String(choose(15, k) * 2 ** (15 - k) * (-1) ** k)) },
];
const native = JSON.parse(readFileSync(new URL("./w3-binomial/native2014P2Q43.json", import.meta.url), "utf8"));
const nativeQuestion: string = native.question_options_and_source_answer_verbatim;
const nativeExpression = "(1 + 𝑥𝑥 2 )4 (1 + 𝑥𝑥 3 )7 (1 + 𝑥𝑥 4 )12";
// Enumerate independent finite choices; the answer marker is never an oracle.
const nativeCoefficients = Array.from({ length: 12 }, (_, exponent) => {
  let sum = 0;
  for (let a = 0; a <= 4; a++) for (let c = 0; c <= 12; c++) for (let d = 0; d <= 7; d++) {
    if (2 * a + 3 * d + 4 * c === exponent) sum += choose(4, a) * choose(7, d) * choose(12, c);
  }
  return String(sum);
});
check("native frozen raw block and independent 1113", () => {
  assert.equal(createHash("sha256").update(nativeQuestion).digest("hex"), "e914d105c08c8919cd5be7b55449853dc4c1da4400448aee46d244ddc36f2f6b");
  const raw = readFileSync(native.source.source_path, "utf8");
  assert.equal(createHash("sha256").update(raw).digest("hex"), "91ca517fdd00714d9a121cb32acd8c3a96c2ccb0773f80785e1d40a75b271a69");
  assert(raw.includes(nativeQuestion));
  assert.equal(nativeCoefficients[11], "1113");
});
cases.push({ name: "native_q43", question: nativeQuestion, expression: nativeExpression, request: "Coefficient of 𝑥𝑥 11 in the expansion of",
  root: b("*", b("*", power(b("+", n(1), power(x, 2)), 4), power(b("+", n(1), power(x, 3)), 7)), power(b("+", n(1), power(x, 4)), 12)), expected: 1113, coefficients: nativeCoefficients });

type Bounds = { x: number; y: number; width: number; height: number };
function overlap(a: Bounds, c: Bounds): boolean { return a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height; }
function boardAudit(scene: RenderScene, viewport?: CompileOptions["viewport"]) {
  const view = viewport ?? { x: 410, y: 55, width: 740, height: 555, padding: 0 };
  const labels = scene.primitives.map(primitive => {
    assert.equal(primitive.kind, "label");
    assert.equal(primitive.labelPlacement, "absolute");
    const reserved = primitive.provenance!.labelBounds as Bounds;
    const requested = Number(primitive.provenance!.fontPx);
    const actual = snapToBoardTypeScale(requested);
    // Same reserved origin and snapping as the board's absolute LABEL path.
    const ink = measureWrittenTextInkBounds(primitive.text!, reserved.x, reserved.y, actual);
    assert(ink);
    return { id: primitive.id, text: primitive.text!, requested, actual, origin: reserved, ink };
  });
  const collisions = labels.flatMap((label, i) => labels.slice(i + 1).filter(other => overlap(label.ink, other.ink)).map(other => [label.text, other.text]));
  const outside = labels.filter(label => label.ink.x < view.x || label.ink.y < view.y || label.ink.x + label.ink.width > view.x + view.width || label.ink.y + label.ink.height > view.y + view.height);
  return { labels, collisions, outside };
}
for (const item of cases) {
  const problem = fullIR(item.question, item.expression, item.request, item.root, item.expected);
  const before = JSON.stringify(problem), authority = { question: item.question, problemIR: problem };
  const reading = engine.readFiniteBinomialProgram(item.question);
  const document = engine.finiteBinomialSourceDocument(item.question, problem);
  check(`${item.name}: complete request capture / exact given span`, () => {
    assert(engine.validateProblemIR(problem, item.question).valid);
    assert.equal(reading.status, "ok");
    assert(reading.status === "ok");
    assert.equal(reading.source.question, item.question);
    assert.equal(reading.source.expressionSource, item.expression);
    assert.equal(reading.source.requestSource, item.request);
    for (const fact of problem.facts) assert.equal(item.question.slice(fact.evidence.start, fact.evidence.end), fact.evidence.quote);
  });
  check(`${item.name}: admit full caller graph, solver and binding`, () => {
    const admitted = engine.admitFiniteBinomialProblem(item.question, problem);
    assert.equal(admitted.status, "ok");
    assert(admitted.status === "ok" && document);
    assert.deepEqual(admitted.problem, problem);
    assert.deepEqual(document.source.problemIR, problem);
    assert.deepEqual(document.constructions[0]!.inputs.problemIR, problem);
    if (item.expected !== undefined) {
      const solver = engine.solveFiniteBinomialProblem(item.question, problem);
      assert(solver && engine.validateSolverResult(solver, problem).valid);
      assert.equal(solver.values[0]!.approximate, item.expected);
      assert.equal(solver.values[0]!.requestId, "actual_ask");
      assert.equal(document.quantities[0]!.id, "actual_coefficient");
    }
  });
  for (const [viewName, viewport] of [["default", undefined], ["650x500", { x: 430, y: 80, width: 650, height: 500, padding: 20 }]] as const) {
    const compiled = document ? engine.compileSceneDocument(document, { sourceAuthority: authority, viewport }) : null;
    snapshots.push({ name: item.name, viewName, problem, document, compiled });
    check(`${item.name}/${viewName}: exact rows, full source, reveal, immutable JSON recompile`, () => {
      assert(document && compiled?.ok && compiled.renderScene);
      assert.deepEqual(compiled.renderScene.primitives.filter(p => p.provenance?.exactCoefficient).map(p => engine.exactPolynomialText(p.provenance!.exactCoefficient as { numerator: string; denominator: string })), item.coefficients);
      assert(document.requiredEntityIds.every(id => compiled.renderScene!.primitives.some(p => p.entityId === id)));
      assert.equal(compiled.renderScene.primitives.filter(p => p.entityId === "P").length, item.expected === undefined ? 3 : 4);
      assert.deepEqual(compiled.renderScene.revealGroups, document.revealGroups);
      assert.deepEqual(engine.compileSceneDocument(JSON.parse(JSON.stringify(document)), { sourceAuthority: JSON.parse(JSON.stringify(authority)), viewport }).renderScene, compiled.renderScene);
    });
    if (compiled?.renderScene) {
      const audit = boardAudit(compiled.renderScene, viewport);
      snapshots.push({ name: item.name, viewName, audit });
      check(`${item.name}/${viewName}: actual board fonts / ink clearance`, () => {
        assert(audit.labels.every(label => label.requested === label.actual && BOARD_TYPE_STEPS.includes(label.actual) && label.actual >= MIN_BOARD_FONT_SIZE));
        assert.deepEqual(audit.collisions, []);
        assert.deepEqual(audit.outside, []);
      });
      if (artifactDir && viewName === "default" && ["native_q43", "power15"].includes(item.name)) {
        const strokes = await Promise.all(audit.labels.map(label => textToStrokePaths(label.text, label.origin.x, label.origin.y, label.actual)));
        const paths = strokes.flatMap(characters => characters.flatMap(character => character.strokes.map(stroke => `<path d="${stroke.pathData}" fill="none" stroke="#18232b" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round"/>`))).join("");
        writeFileSync(resolve(artifactDir, `${mode}-${item.name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#fffef8"/>${paths}</svg>`);
      }
    }
  }
  if (item.name.startsWith("repeated_")) {
    const shortened = structuredClone(problem);
    const fact = shortened.facts[1]!;
    fact.statement = fact.evidence.quote = "Coefficient of";
    fact.evidence.end = fact.evidence.start + fact.evidence.quote.length;
    const badDocument = engine.finiteBinomialSourceDocument(item.question, shortened);
    const badCompile = engine.compileSceneDocument(badDocument ?? document!, { sourceAuthority: { question: item.question, problemIR: shortened } });
    snapshots.push({ name: item.name, shortened, badDocument, badCompile });
    check(`${item.name}: shortened request rejected atomically`, () => {
      assert(engine.validateProblemIR(shortened, item.question).valid, "base IR validity is not complete role proof");
      assert.equal(engine.admitFiniteBinomialProblem(item.question, shortened).status, "declined");
      assert.equal(badDocument, null);
      assert.equal(engine.solveFiniteBinomialProblem(item.question, shortened), null);
      assert(!badCompile.ok && badCompile.renderScene === null && badCompile.report.stats.primitiveCount === 0);
    });
  }
  if (["native_q43", "power15"].includes(item.name)) {
    for (const height of [item.name === "native_q43" ? 200 : 180, 250, 300]) {
      const viewport = { x: 430, y: 80, width: 650, height, padding: 20 };
      const compiled = engine.compileSceneDocument(document!, { sourceAuthority: authority, viewport });
      const audit = compiled.renderScene ? boardAudit(compiled.renderScene, viewport) : null;
      snapshots.push({ name: item.name, height, compiled, audit });
      check(`${item.name}/height${height}: actual font fit or atomic decline`, () => {
        if (height === (item.name === "native_q43" ? 200 : 180)) assert(!compiled.ok, "review's compressed overlap must decline");
        if (height === (item.name === "native_q43" ? 300 : 250)) {
          assert(compiled.ok && audit, "a viewport fitting at the board floor must remain supported");
          assert(audit.labels.every(label => label.actual === MIN_BOARD_FONT_SIZE));
        }
        if (compiled.ok) {
          assert(audit && audit.labels.every(label => label.requested === label.actual));
          assert.deepEqual(audit.collisions, []);
          assert.deepEqual(audit.outside, []);
        } else assert(compiled.renderScene === null && !compiled.report.valid && compiled.report.issues.some(i => i.severity === "fatal"));
      });
    }
  }
  check(`${item.name}: original complete question/IR remain unchanged`, () => assert.equal(JSON.stringify(problem), before));
}
if (artifactDir) {
  writeFileSync(resolve(artifactDir, `${mode}-review-results.json`), JSON.stringify(results, null, 2));
  writeFileSync(resolve(artifactDir, `${mode}-review-scenes.json`), JSON.stringify(snapshots, null, 2));
}
const failures = results.filter(result => !result.passed);
for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.error}`);
console.log(`W3 binomial bounded review fixes (${mode}): ${results.length - failures.length}/${results.length} checks pass; ${failures.length} failures; offline authored full-IR profiles`);
if (failures.length) process.exitCode = 1;
