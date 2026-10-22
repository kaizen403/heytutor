/** Whole symbolic declarations never erase numeric source or change logarithm base. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { kineticsFromStem, solveKinetics, buildKineticsScene } from "../../src/chemistry/kinetics";
import { readChemistryArrheniusEquation } from "../../src/chemistry/quantityReader";
import { findSymbolicArrheniusSources } from "../../src/chemistry/symbolicArrheniusSource";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileForLab } from "../chemistry-lab/lab";
import { compileSceneDocument } from "../../src/compile/compiler";
import { evaluateMathExpression } from "../../src/math/expression";
import type { SceneDocument } from "../../src/types";
import fixture from "./fixtures/chemistry-arrhenius-symbolic-source.json";

const rows: Array<{ id: string; passed: boolean; error: string | null; actual: unknown }> = [];
function check(id: string, actual: unknown, run: () => void): void {
  try { run(); rows.push({ id, passed: true, error: null, actual }); }
  catch (error) { rows.push({ id, passed: false, error: error instanceof Error ? error.message : String(error), actual }); }
}
function near(actual: unknown, expected: number, tolerance = 1e-8): void {
  assert.equal(typeof actual, "number"); assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(Number(actual) - expected) <= Math.max(1, Math.abs(expected)) * tolerance, `${actual} != ${expected}`);
}
function labelPoint(document: SceneDocument, id: string): { x: number; y: number } {
  const label = document.constructions.find(value => value.operator === "label" && value.outputs.includes(id)); assert.ok(label);
  const point = document.constructions.find(value => value.operator === "point" && value.outputs.includes(String(label.inputs.target))); assert.ok(point);
  return { x: Number(point.inputs.x), y: Number(point.inputs.y) };
}
for (const gold of fixture.rows) {
  const read = readChemistryArrheniusEquation(gold.question), spec = kineticsFromStem(gold.question);
  check(`${gold.id}/source`, { read, spec, solved: spec ? solveKinetics(spec) : null }, () => {
    assert.equal(Boolean(spec), gold.expectedDraw);
    if (!gold.expectedDraw) return;
    assert.ok(read.ok && spec?.arrhenius);
    near(read.reading.coefficient.value, gold.b!); near(read.reading.intercept?.value, gold.intercept!);
    assert.equal(read.reading.natural, gold.natural);
    for (const literal of [read.reading.coefficient, read.reading.intercept!]) assert.equal(gold.question.slice(literal.span.start, literal.span.end), literal.text);
    assert.equal(gold.question.slice(read.reading.source.span.start, read.reading.source.span.end), read.reading.source.text);
    for (const symbolic of findSymbolicArrheniusSources(gold.question)) {
      assert.equal(gold.question.slice(symbolic.source.span.start, symbolic.source.span.end), symbolic.source.text);
      assert.equal(gold.question.slice(symbolic.exponential.span.start, symbolic.exponential.span.end), symbolic.exponential.text);
      assert.ok(symbolic.source.span.start <= symbolic.exponential.span.start && symbolic.exponential.span.end <= symbolic.source.span.end);
      assert.deepEqual(Object.keys(symbolic).sort(), ["exponential", "source"], "context spans grant no numeric value");
    }
    near(solveKinetics(spec).Ea, 8.314 * gold.b! * (gold.natural ? 1 : Math.LN10));
    assert.equal(spec.k, null, "a symbolic A or E_a never supplies an absolute rate literal");
  });
  for (const route of ["strict", "schematic", "ordinary", "lastResort"] as const) {
    const document = route === "ordinary" ? synthesizeFamilyScene({ question: gold.question })?.document ?? null
      : route === "lastResort" ? synthesizeLastResortScene({ question: gold.question })?.document ?? null
        : buildKineticsScene(gold.question, [], route === "schematic");
    const compiled = compileForLab(document), rawCompiled = document ? compileSceneDocument(document) : null;
    check(`${gold.id}/${route}`, { document, compiled, rawCompiled }, () => {
      assert.equal(Boolean(document), gold.expectedDraw);
      if (!gold.expectedDraw) return;
      assert.ok(document && compiled.ok && compiled.renderScene, JSON.stringify(compiled.issues));
      assert.ok(rawCompiled?.ok && rawCompiled.renderScene, JSON.stringify(rawCompiled?.report.issues));
      assert.equal(document.source.question, gold.question);
      const labels = document.entities.filter(entity => entity.kind === "label");
      assert.ok(labels.some(entity => entity.id === "ar_yl" && entity.label === (gold.natural ? "ln k" : "log k")), "actual ordinate preserves source log base");
      near(document.quantities.find(value => value.id === "arrhenius_B")?.value, gold.b!);
      near(document.quantities.find(value => value.id === "arrhenius_C")?.value, gold.intercept!);
      const xTick = labels.find(entity => entity.id === "ar_xtick"), yTick = labels.find(entity => entity.id === "ar_ytick"); assert.ok(xTick && yTick);
      const xValue = Number(xTick.label), yValue = Number(yTick.label); assert.ok(xValue > 0 && yValue !== 0);
      const x = labelPoint(document, xTick.id).x, y = labelPoint(document, yTick.id).y;
      const xAxis = document.constructions.find(value => value.outputs.includes("ar_xaxis")); assert.ok(xAxis);
      const origin = document.constructions.find(value => value.outputs.includes(String(xAxis.inputs.start))); assert.ok(origin);
      const yZero = Number(origin.inputs.y), yScale = (y - yZero) / yValue;
      const line = document.constructions.find(value => value.operator === "function_curve" && value.outputs.includes("line")); assert.ok(line);
      for (const fraction of [0, .5, 1]) {
        const actualPhysical = (evaluateMathExpression(String(line.inputs.expression), x * fraction) - yZero) / yScale;
        near(actualPhysical, gold.intercept! - gold.b! * xValue * fraction, 3e-6);
      }
      assert.ok(document.assertions.filter(value => value.predicate === "function_value" && value.severity === "fatal").length >= 3);
    });
  }
}
const result = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const at = process.argv.indexOf("--out"); if (at >= 0) writeFileSync(process.argv[at + 1]!, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const row of rows) console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id}${row.error ? `: ${row.error}` : ""}`);
console.log(JSON.stringify({ passed: result.passed, failed: result.failed })); if (result.failed) process.exitCode = 1;
