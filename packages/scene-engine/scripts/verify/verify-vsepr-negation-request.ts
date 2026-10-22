/** Negative alternatives and excluded figure methods retain their local scope. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { vseprPlanConflict } from "../../src/chemistry/vsepr";
import { molecularShapeRequested } from "../../src/chemistry/foundation/molecularShapeRequest";
import { buildLewisScene } from "../../src/chemistry/lewis";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import fixture from "./fixtures/vsepr-negation-request.json";

const rows: Array<{ id: string; passed: boolean; actual: unknown; error: string | null }> = [];
function check(id: string, actual: unknown, test: () => void): void {
  try { test(); rows.push({ id, passed: true, actual, error: null }); }
  catch (error) { rows.push({ id, passed: false, actual, error: error instanceof Error ? error.message : String(error) }); }
}
for (const row of fixture.claims) {
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question: row.question, givens: [], unknowns: [], derived: [], lawIds: [], assumptions: [], visualRequirement: "required", qualitativeClaims: [{ id: row.id, claim: row.claim, expected: true }] };
  const conflict = vseprPlanConflict(row.question, plan);
  check(row.id, { conflict }, () => assert.equal(conflict === null, row.draw));
}
for (const row of fixture.requests) {
  const requested = molecularShapeRequested(row.question);
  check(row.id, { requested }, () => assert.equal(requested, row.requested));
  if ("lewis" in row && row.lewis) {
    const document = buildLewisScene(row.question, [], false), compiled = document ? compileSceneDocument(document) : null;
    check(row.id + "/real-Lewis", { document, compiled }, () => {
      assert.ok(document, "an explicitly excluded geometry must not suppress the named source Lewis builder");
      assert.ok(compiled?.ok && compiled.renderScene);
      assert.equal(document.source.chemistryFamily, "chem_lewis");
    });
  }
}
const result = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const row of rows) console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id}${row.error ? `: ${row.error}` : ""}`);
console.log(JSON.stringify({ passed: result.passed, failed: result.failed }));
if (result.failed) process.exitCode = 1;
