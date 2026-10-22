/** Formula owners must bind central counts and hybridisation before truth comparison. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { buildVseprFigure, vseprPlanConflict } from "../../src/chemistry/vsepr";
import { verifiedVseprStructure } from "../../src/chemistry/vseprStructure";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";

interface ClaimRow {
  id: string;
  question: string;
  claim: string;
  expected: string | boolean;
  draw: boolean;
}
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/vsepr-formula-claim-owners.json", import.meta.url), "utf8")) as ClaimRow[];
const rows = fixtures.map(row => {
  const plan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question: row.question, givens: [], unknowns: [], derived: [],
    lawIds: [], assumptions: [], visualRequirement: "required",
    qualitativeClaims: [{ id: row.id, claim: row.claim, expected: row.expected }],
  };
  const conflict = vseprPlanConflict(row.question, plan);
  const figure = buildVseprFigure(row.question, [], false);
  const compiled = figure ? compileSceneDocument(figure.document) : null;
  const witness = figure ? verifiedVseprStructure(figure.document, row.question) : null;
  let error: string | null = null;
  try {
    assert.equal(conflict === null, row.draw, row.claim);
    assert.ok(figure, "the claim cannot change source geometry availability");
    assert.ok(witness, "the source molecule must retain its structural witness");
    assert.ok(compiled?.ok, "the source molecule must still compile");
  } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  return { ...row, conflict, figure: figure?.document ?? null, compiled, witness, passed: error === null, error };
});
const result = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const outAt = process.argv.indexOf("--out");
if (outAt >= 0) writeFileSync(process.argv[outAt + 1]!, JSON.stringify(result, null, 2) + "\n");
for (const row of rows) console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id}${row.error ? `: ${row.error}` : ""}`);
console.log(`verify-vsepr-formula-claim-owners: ${result.passed} passed, ${result.failed} failed`);
if (result.failed) process.exitCode = 1;
