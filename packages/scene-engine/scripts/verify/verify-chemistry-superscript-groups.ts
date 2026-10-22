/** Complete source superscript runs retain their scope before planning or scalar reading. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { normalizeTutorQuestion } from "../../../tutor-core/src/text/questionText";
import { parseFormula } from "../../src/chemistry/formula";
import { parseChemistryScalar, readChemistryQuantity } from "../../src/chemistry/quantityReader";
import { evaluateMathExpression, parseMathExpression } from "../../src/math/expression";
import fixtures from "./fixtures/chemistry-superscript-groups.json";

interface Science {
  kind: string; x?: number; value?: number; atoms?: Record<string, number>; charge?: number;
  after?: string; literal?: string;
}
function near(actual: number, expected: number): void {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(1e-28, Math.abs(expected) * 1e-12), `${actual} != ${expected}`);
}
function science(text: string, gold: Science): void {
  if (gold.kind === "math") { near(evaluateMathExpression(text, gold.x!), gold.value!); return; }
  if (gold.kind === "equation") {
    const equation = /\by\s*=\s*(.*?)\s+for\b/.exec(text);
    assert.ok(equation); near(evaluateMathExpression(equation[1]!, gold.x!), gold.value!); return;
  }
  if (gold.kind === "invalid-math") {
    assert.throws(() => parseMathExpression(text));
    assert.equal(parseChemistryScalar(text, { start: 0, end: text.length }).ok, false); return;
  }
  if (gold.kind === "symbolic") { assert.throws(() => parseMathExpression(text)); return; }
  if (gold.kind === "formula") {
    const parsed = parseFormula(text); assert.ok(parsed); assert.equal(parsed.charge, gold.charge);
    assert.deepEqual(Object.fromEntries(parsed.atoms.map(atom => [atom.symbol, atom.count])), gold.atoms); return;
  }
  if (gold.kind === "quantity") {
    const reading = readChemistryQuantity({ question: text, after: /concentration is/, dimension: "concentration", targetUnit: "mol/L" });
    assert.ok(reading.ok); near(reading.reading.value, gold.value!);
    assert.equal(reading.reading.source.text, gold.literal);
    const start = text.indexOf(gold.literal!); assert.ok(start >= 0);
    assert.deepEqual(reading.reading.source.span, { start, end: start + gold.literal!.length }); return;
  }
  assert.equal(gold.kind, "notation");
}

const results = fixtures.map(row => {
  const actual = normalizeTutorQuestion(row.input);
  const errors: string[] = [];
  const check = (name: string, run: () => void): void => {
    try { run(); } catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  };
  check("whole source scope", () => assert.equal(actual, row.expected));
  check("idempotence", () => assert.equal(normalizeTutorQuestion(actual), actual));
  check("independent scientific reader", () => science(actual, row.science as Science));
  return { id: row.id, input: row.input, expected: row.expected, actual, passed: errors.length === 0, errors };
});
const report = { scope: "Source normalization and ordinary math/chemistry readers only; no live diagram coverage claim.",
  passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, results };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (report.failed) process.exitCode = 1;
