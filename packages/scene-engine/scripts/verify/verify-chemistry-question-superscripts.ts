/** Atomic superscript source runs: exact chemistry/math meaning, never lenient scalar reading. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { normalizeTutorQuestion } from "../../../tutor-core/src/text/questionText";
import { parseFormula } from "../../src/chemistry/formula";
import { parseChemistryScalar, readChemistryQuantity, type ChemistryDimension, type ChemistryUnit } from "../../src/chemistry/quantityReader";
import { evaluateMathExpression, parseMathExpression } from "../../src/math/expression";
import fixtures from "./fixtures/chemistry-question-superscripts.json";
interface Science {
  kind: string; x?: number; value?: number; after?: string; dimension?: ChemistryDimension;
  targetUnit?: ChemistryUnit; literal?: string; charge?: number; atoms?: Record<string,number>;
  unsupportedMustRemain?: string;
}
const near = (actual: number, expected: number) => assert.ok(Number.isFinite(actual)
  && Math.abs(actual-expected) <= Math.max(1e-25, Math.abs(expected)*1e-12), `${actual} != ${expected}`);
function checkScience(text: string, gold?: Science): void {
  if (!gold) return;
  if (gold.kind === "math") { near(evaluateMathExpression(text, gold.x!), gold.value!); return; }
  if (gold.kind === "scalar" || gold.kind === "invalid-scalar") {
    const result = parseChemistryScalar(text, {start:0,end:text.length});
    if (gold.kind === "invalid-scalar") {
      assert.equal(result.ok, false);
      assert.throws(() => parseMathExpression(text), "malformed source must not become valid ordinary math");
      return;
    }
    assert.ok(result.ok); near(result.reading, gold.value!); return;
  }
  if (gold.kind === "quantity") {
    const escaped = gold.after!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const result = readChemistryQuantity({question:text,after:new RegExp(escaped),dimension:gold.dimension!,targetUnit:gold.targetUnit});
    assert.ok(result.ok); near(result.reading.value,gold.value!);
    assert.equal(result.reading.source.text,gold.literal);
    const start = text.indexOf(gold.literal!); assert.ok(start >= 0);
    assert.deepEqual(result.reading.source.span,{start,end:start+gold.literal!.length}); return;
  }
  if (gold.kind === "formula") {
    const result = parseFormula(text); assert.ok(result); assert.equal(result.charge,gold.charge);
    assert.deepEqual(Object.fromEntries(result.atoms.map(atom=>[atom.symbol,atom.count])),gold.atoms); return;
  }
  if (gold.kind === "invalid-math") {
    assert.ok(text.includes(gold.unsupportedMustRemain!)); assert.throws(()=>parseMathExpression(text)); return;
  }
  if (gold.kind === "symbolic-no-inferred-value") { assert.throws(()=>parseMathExpression(text).evaluate(2)); return; }
  if (gold.kind === "unit-expression") { assert.ok(text.includes("2 m^2")); return; }
  assert.fail(`Unknown scientific oracle ${gold.kind}`);
}
const results: Array<{id:string;passed:boolean;error?:string}> = [];
for (const row of fixtures) {
  try {
    const output = normalizeTutorQuestion(row.input);
    assert.equal(output,row.expected,"exact independent source notation");
    assert.equal(normalizeTutorQuestion(output),output,"normalization is idempotent");
    checkScience(output,row.science as Science | undefined);
    results.push({id:row.id,passed:true});
  } catch(error) { results.push({id:row.id,passed:false,error:error instanceof Error ? error.message : String(error)}); }
}
const report = {scope:"Source notation and unchanged strict chemistry/math readers; no figure or student-board coverage claim.",
  passed:results.filter(row=>row.passed).length,failed:results.filter(row=>!row.passed).length,results};
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out+1]!,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report)); if (report.failed) process.exitCode=1;
