/** A separate spectral emitter cannot change the irradiated target's constant authority. */
import assert from "node:assert/strict";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import fixtures from "./fixtures/chemistry-f4-radiation-source-authority.json";
const close = (a: number, b: number): void => assert.ok(Number.isFinite(a) && Math.abs(a - b) < 1e-12, `${a} != ${b}`);
const rows = fixtures.map(row => {
  const result = readRadiationSource(row.question);
  try {
    assert.equal(result.status === "source", row.expected.publicDraw);
    if (row.expected.publicDraw) {
      assert.ok(result.status === "source" && result.model.kind === "photoelectric");
      assert.equal(result.model.question, row.question);
      assert.equal(result.model.constantAuthority, row.expected.constantAuthority);
      close(result.model.photonEnergyEV, row.expected.photonEnergyEV!);
      close(result.model.workFunctionEV, row.expected.workFunctionEV!);
      close(result.model.kineticEV!, row.expected.kineticEV!);
      for (const binding of result.model.bindings) {
        assert.equal(binding.reading.source.kind, "stem_given");
        const { span, text } = binding.reading.source;
        assert.equal(row.question.slice(span.start, span.end), text);
      }
    } else assert.equal(result.status, "declined");
    // A valid reader result must reach both real public routes, and an
    // incompatible declaration must not fall through to invented defaults.
    for (const route of [synthesizeFamilyScene, synthesizeLastResortScene]) {
      const figure = route({ question: row.question });
      assert.equal(!!figure, row.expected.publicDraw);
      if (!figure) continue;
      assert.equal(figure.document.source.question, row.question);
      const compiled = compileSceneDocument(figure.document);
      assert.ok(compiled.ok && compiled.renderScene);
      const chemicalEnergy = compiled.renderScene.primitives.filter(mark => mark.entityId === "e_l" && mark.kind === "label");
      if (figure.family === "chem_orbital") {
        assert.deepEqual(chemicalEnergy.map(mark => mark.text),
          [`E=${row.expected.photonEnergyEV!.toFixed(Math.abs(row.expected.photonEnergyEV!) >= 10 ? 1 : 2)} eV`],
          "Chemical figure keeps the given constant's arithmetic in its actual energy label");
      } else {
        assert.equal(figure.document.quantities.find(quantity => quantity.symbol === "E" && quantity.unit === "eV")?.value,
          Number(row.expected.photonEnergyEV!.toFixed(6)), "Physics figure keeps the given constant's arithmetic");
      }
    }
    return { id: row.id, passed: true, result };
  } catch (error) { return { id: row.id, passed: false, error: String(error), result }; }
});
const report = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
console.log(JSON.stringify(report));
process.exitCode = report.failed ? 1 : 0;
