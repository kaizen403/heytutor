/** Conservation cannot discard unconsumed dimensions to invent incident light. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import fixtures from "./fixtures/chemistry-f4-conservation-inventory.json";

const rows = fixtures.map(row => {
  const radiation = readRadiationSource(row.question);
  const routes = ([["ordinary", synthesizeFamilyScene], ["last", synthesizeLastResortScene]] as const).map(([route, produce]) => {
    const result = produce({ question: row.question });
    return { route, result, compiled: result ? compileSceneDocument(result.document) : null };
  });
  try {
    assert.equal(radiation.status === "source", row.expectedScientificAvailability);
    for (const { result, compiled } of routes) {
      assert.equal(Boolean(result), row.expectedWholePublicDraw);
      if (!result) continue;
      assert.ok(compiled?.ok && compiled.renderScene);
      assert.equal(result.document.source.question, row.question);
      assert.ok(radiation.status === "source" && radiation.model.kind === "photoelectric");
      const science = row.scientificGold;
      assert.ok("photonEV" in science && "workEV" in science && "kineticEV" in science);
      assert.equal(radiation.model.photonEnergyEV, science.photonEV);
      assert.equal(radiation.model.workFunctionEV, science.workEV);
      assert.equal(radiation.model.kineticEV, science.kineticEV);
      const derived = science.photonBasis.startsWith("derived");
      assert.equal(radiation.model.photonEnergyBasis === "conservation_from_emitted_result", derived);
      const energy = result.document.quantities.find(quantity => quantity.symbol === "E");
      if (derived) {
        assert.ok(energy && energy.value === science.photonEV && energy.provenance === "derived", "no manufactured incident given");
        assert.ok(compiled.renderScene.primitives.some(primitive => /derived/i.test(primitive.text ?? "")));
      } else {
        assert.notEqual(energy?.provenance, "derived");
        assert.ok(compiled.renderScene.primitives.some(primitive => primitive.text === `E=${science.photonEV.toFixed(2)} eV`), "source incident value remains visible");
      }
      if ("stoppingV" in science) {
        assert.equal(radiation.model.stoppingPotentialV, science.stoppingV);
        assert.ok(result.document.quantities.some(quantity => quantity.symbol === "Vstop" && quantity.value === science.stoppingV));
      }
      if ("thresholdNM" in science) assert.ok(Math.abs(radiation.model.thresholdWavelengthM! * 1e9 - science.thresholdNM) < 1e-9);
      for (const binding of radiation.model.bindings) assert.equal(row.question.slice(binding.reading.source.span.start, binding.reading.source.span.end), binding.reading.source.text);
    }
    return { id: row.id, error: null, radiation, routes };
  } catch (error) { return { id: row.id, error: String(error), radiation, routes }; }
});
const report = { checks: rows.length, failed: rows.filter(row => row.error !== null).length, rows };
const output = process.argv.indexOf("--out");
if (output >= 0) fs.writeFileSync(process.argv[output + 1]!, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ checks: report.checks, passed: report.checks - report.failed, failed: report.failed }));
if (report.failed) process.exitCode = 1;
