/** Computational directives own one typed constant, never the whole context. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import fixtures from "./fixtures/chemistry-f4-computational-constant.json";

const rows = fixtures.map(gold => {
  const result = readRadiationSource(gold.question);
  const records: unknown[] = [];
  try {
    assert.equal(result.status === "source", gold.draw, `${gold.id}: source disposition`);
    if (gold.draw) {
      assert.ok(result.status === "source" && result.model.kind === "photoelectric");
      const expected = gold.gold!;
      assert.equal(result.model.question, gold.question);
      assert.equal(result.model.constantAuthority, "atomic_reference", "Directive does not replace global context authority");
      for (const [actual, value] of [[result.model.photonEnergyEV, expected.photonEV],
        [result.model.workFunctionEV, expected.workEV], [result.model.kineticEV, expected.kineticEV]]) {
        assert.ok(actual !== null && value !== undefined && Math.abs(actual - value) < 1e-12, `${actual} != ${value}`);
      }
      for (const binding of result.model.bindings) {
        assert.equal(binding.reading.source.kind, "stem_given");
        const { span, text } = binding.reading.source;
        assert.equal(gold.question.slice(span.start, span.end), text, "Complete original scalar/unit source remains bound");
      }
    } else assert.equal(result.status, "declined");
    for (const [route, build] of [["ordinary", synthesizeFamilyScene], ["lastResort", synthesizeLastResortScene]] as const) {
      const figure = build({ question: gold.question });
      const compiled = figure ? compileSceneDocument(figure.document) : null;
      records.push({ route, figure, compiled });
      assert.equal(!!figure, gold.draw, `${gold.id}/${route}: actual whole public result`);
      if (!figure) continue;
      assert.ok(compiled?.ok && compiled.renderScene);
      assert.equal(figure.document.source.question, gold.question);
      const expected = gold.gold!;
      const values = { E: expected.photonEV!, phi: expected.workEV!, K: expected.kineticEV! };
      const paint = compiled.renderScene.primitives.filter(mark => mark.kind === "label");
      if (figure.family === "chem_orbital") {
        for (const [symbol, value] of Object.entries(values)) {
          assert.ok(paint.some(mark => mark.text === `${symbol}=${value.toFixed(2)} eV`), `${symbol}: source-computed display`);
        }
      } else {
        for (const [symbol, value] of Object.entries(values)) {
          assert.equal(figure.document.quantities.find(quantity => quantity.symbol === symbol && quantity.unit === "eV")?.value,
            Number(value.toFixed(6)), `${symbol}: source value at existing document serialization precision`);
          const prefix = symbol === "E" ? "hν" : symbol === "phi" ? "φ" : "K";
          assert.ok(paint.some(mark => mark.text === `${prefix}=${Number(value.toPrecision(3))} eV`), `${symbol}: actual ordinary label`);
        }
      }
    }
    return { id: gold.id, passed: true, result, records };
  } catch (error) { return { id: gold.id, passed: false, error: String(error), result, records }; }
});
const report = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ passed: report.passed, failed: report.failed,
  failures: rows.filter(row => !row.passed).map(({ id, error }) => ({ id, error })) }));
process.exitCode = report.failed ? 1 : 0;
