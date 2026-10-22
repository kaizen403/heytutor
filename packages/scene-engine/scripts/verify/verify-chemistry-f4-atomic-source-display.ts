/** The legacy atomic facade paints every newly supported source field without
 * granting its lower-level computation the dispatcher's chemistry authority. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { chemistryFamilyBuilder, inferChemistryFamilies } from "../../src/chemistry";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
import fixture from "./fixtures/chemistry-f4-atomic-source-display.json";

const results = fixture.map(gold => {
  const direct = buildAtomicRadiationScene(gold.question, [], false);
  const routed = chemistryFamilyBuilder("chem_orbital")!(gold.question, [], false);
  const source = readRadiationSource(gold.question);
  const records: Array<{ route: string; document: SceneDocument | null; compiled: ReturnType<typeof compileSceneDocument> | null }> = [];
  try {
    assert.equal(!!direct, gold.draw);
    assert.equal(inferChemistryFamilies(gold.question).includes("chem_orbital"), gold.chemistry);
    assert.equal(!!routed, gold.draw && gold.chemistry);
    for (const [route, document] of [["direct", direct], ["dispatcher", routed]] as const) {
      const compiled = document ? compileSceneDocument(document) : null;
      records.push({ route, document, compiled });
      if (!document) continue;
      assert.ok(compiled?.ok && compiled.renderScene);
      assert.equal(document.source.question, gold.question);
      const text = compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text] : []).join(" ");
      if ("Vstop" in gold) {
        assert.equal(document.quantities.find(quantity => quantity.symbol === "Vstop")?.value, gold.Vstop);
        assert.ok(text.includes(`Vstop=${gold.Vstop} V`), "source-given voltage is actually painted");
      }
      if ("lambda0Nm" in gold) {
        assert.equal(document.quantities.find(quantity => quantity.symbol === "lambda0")?.value, Number(gold.lambda0Nm!.toFixed(6)));
        assert.ok(text.includes("λ0=") && text.includes("nm"), "converted source threshold is actually painted");
      }
    }
    if (gold.draw) {
      assert.ok(source.status === "source" && source.model.kind === "photoelectric");
      for (const binding of source.model.bindings) assert.equal(gold.question.slice(binding.reading.source.span.start, binding.reading.source.span.end), binding.reading.source.text);
    } else assert.equal(source.status, "declined");
    return { id: gold.id, passed: true, source, records };
  } catch (error) { return { id: gold.id, passed: false, error: String(error), source, records }; }
});
const report = { passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, results };
if (process.argv.includes("--out")) writeFileSync(process.argv[process.argv.indexOf("--out") + 1]!, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, failures: results.filter(result => !result.passed).map(({ id, error }) => ({ id, error })) }));
process.exitCode = report.failed ? 1 : 0;
