/** Balanced neutral wrappers are not charges; source fixtures are oracles only. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildUnitCellScene } from "../../src/chemistry/unitCell";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import fixtures from "./fixtures/chemistry-parenthesized-species.json";
const results: Array<{ id: string; passed: boolean; error?: string }> = [];
for (const row of fixtures) for (const route of ["direct", "schematic", "ordinary", "lastResort"] as const) {
  try {
    const result = route === "direct" || route === "schematic" ? buildUnitCellScene(row.question, [], route === "schematic")
      : route === "ordinary" ? synthesizeFamilyScene({ question: row.question }) : synthesizeLastResortScene({ question: row.question });
    assert.equal(!!result, row.draw, "complete question scientific oracle");
    if (result) {
      const document = "document" in result ? result.document : result;
      const compiled = compileSceneDocument(document);
      assert.ok(compiled.ok && compiled.renderScene, "whole normal compiler must pass");
      assert.equal(document.source.question, row.question);
    }
    results.push({ id: `${row.id}/${route}`, passed: true });
  } catch (error) { results.push({ id: `${row.id}/${route}`, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}
const report = { scope: "Offline source/normal compile; neutral wrapper versus charge/identity/quantity controls. No native or coverage claim.", passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, results };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out+1]!, JSON.stringify(report, null, 2)+"\n");
console.log(JSON.stringify(report));
if (report.failed) process.exitCode = 1;
