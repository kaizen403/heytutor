/** Source drawing introductions and property qualifiers keep distinct roles. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildOrganicScene } from "../../src/chemistry/organic";
import { verifiedOrganicNeighbourhoodStructure } from "../../src/chemistry/organic/neighbourhoodStructure";
import { compileForLab } from "../chemistry-lab/lab";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import cases from "./fixtures/organic-property-owner-scope.json";

const results: Array<{ id: string; passed: boolean; error?: string }> = [];
const normalized = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");
for (const row of cases) for (const route of ["direct", "schematic", "ordinary", "lastResort"] as const) {
  try {
    const candidate = route === "direct" || route === "schematic" ? buildOrganicScene(row.question, [], route === "schematic")
      : route === "ordinary" ? synthesizeFamilyScene({ question: row.question }) : synthesizeLastResortScene({ question: row.question });
    assert.equal(!!candidate, row.draw, "whole original source request admission");
    if (candidate) {
      const document = "document" in candidate ? candidate.document : candidate;
      const result = compileForLab(document);
      assert.ok(result.ok && result.renderScene, "normal validate/prune/compile of the complete figure");
      assert.equal(document.source.question, row.question);
      if ("preserveGeneric" in row && row.preserveGeneric) {
        // These controls preserve established generic admission, not a claim
        // that inherited atom/count requests have acquired missing annotation.
        assert.ok(!document.source.organicComparison, "ordinary graph annotation/count keeps its existing owner");
        const labels = normalized(result.renderScene.primitives.filter(primitive => primitive.kind === "label").map(primitive => primitive.text ?? "").join(" "));
        for (const text of row.genericLabels) assert.ok(labels.includes(normalized(text)), "established visible group/name label preserved");
      } else {
      const source = document.source.organicComparison as { models: Array<{ name: string; site: { classification: string } }> };
      assert.ok(source, "generic skeletal fallback cannot satisfy a structural property request");
      assert.deepEqual(source.models.map(model => [model.name, model.site.classification]), row.panels, "complete source-ordered graph/class oracle");
      const panelText = (index: number): string => normalized(result.renderScene!.primitives.filter(primitive => primitive.kind === "label" && primitive.groupId === `m${index}_group`).map(primitive => primitive.text ?? "").join(" "));
      for (const [index, [name, classification]] of row.panels.entries()) {
        assert.ok(panelText(index).includes(normalized(name!)), `complete name on owning panel ${index}`);
        assert.ok(panelText(index).includes(normalized(classification!)), `derived class on owning panel ${index}`);
      }
      for (const property of row.visibleProperties) assert.ok(panelText(property.panel).includes(normalized(property.text)), "requested property must appear on its owning panel");
      assert.ok(verifiedOrganicNeighbourhoodStructure(document, row.question), "source regeneration must certify the whole admitted structure and names");
      }
    }
    results.push({ id: `${row.id}/${route}`, passed: true });
  } catch (error) { results.push({ id: `${row.id}/${route}`, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}
const report = { scope: "Offline actual source producer/ordinary consumers and normal compiler/source witness. Not native, paid measurement or coverage.", passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, results };
const at = process.argv.indexOf("--out");
if (at >= 0) { assert.ok(process.argv[at + 1]); writeFileSync(process.argv[at + 1]!, JSON.stringify(report, null, 2) + "\n"); }
for (const row of results.filter(row => !row.passed)) console.error(`FAIL ${row.id}: ${row.error}`);
console.log(`verify-organic-property-owner-scope: ${report.passed} passed, ${report.failed} failed`);
if (report.failed) process.exitCode = 1;
