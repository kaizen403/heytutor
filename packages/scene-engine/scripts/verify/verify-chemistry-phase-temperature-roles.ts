/** Phase, charge and compared temperature roles retain their source identity. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildUnitCellScene } from "../../src/chemistry/unitCell";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileForLab } from "../chemistry-lab/lab";
import cases from "./fixtures/chemistry-phase-temperature-roles.json";

const results: Array<{ id: string; passed: boolean; error?: string }> = [];
for (const row of cases) for (const route of ["direct", "schematic", "ordinary", "lastResort"] as const) {
  try {
    const builder = row.kind === "phase" ? buildUnitCellScene : buildThermoGraphScene;
    const value = route === "direct" || route === "schematic" ? builder(row.question, [], route === "schematic")
      : route === "ordinary" ? synthesizeFamilyScene({ question: row.question }) : synthesizeLastResortScene({ question: row.question });
    const document = value && ("document" in value ? value.document : value);
    assert.equal(!!document, row.draw, "whole source request admission");
    if (document) {
      const compiled = compileForLab(document);
      assert.ok(compiled.ok && compiled.renderScene, "normal validate/prune/compile");
      assert.equal(document.source.question, row.question, "original source retained");
      if (row.kind === "phase") {
        assert.ok(compiled.renderScene.primitives.some(mark => mark.kind === "label" && mark.text === row.symbol), "actual neutral species ink");
      } else {
        assert.equal(document.entities.find(entity => entity.id === "t1")?.label, row.lowerLabel, "lower curve source identity");
        assert.equal(document.entities.find(entity => entity.id === "t2")?.label, row.higherLabel, "higher curve source identity");
        assert.ok(document.annotations.find(annotation => annotation.id === "figure_caption")?.text?.includes(`from ${row.lowerLabel} to ${row.higherLabel}`), "caption follows the same source order");
        assert.ok(!document.entities.some(entity => entity.kind === "quantity"), "qualitative graph grants no numeric curve certificate");
      }
    }
    results.push({ id: `${row.id}/${route}`, passed: true });
  } catch (error) { results.push({ id: `${row.id}/${route}`, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}
const report = { scope: "Source consumers and normal compiler only; not native, board, paid measurement or coverage.", passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, results };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(report, null, 2) + "\n");
for (const row of results.filter(row => !row.passed)) console.error(`FAIL ${row.id}: ${row.error}`);
console.log(`verify-chemistry-phase-temperature-roles: ${report.passed} passed, ${report.failed} failed`);
if (report.failed) process.exitCode = 1;
