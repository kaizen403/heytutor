/** A separate spectral emitter cannot change the irradiated target's constant authority. */
import assert from "node:assert/strict";
import { readRadiationSource } from "../../src/physics/radiationSource";
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
    return { id: row.id, passed: true, result };
  } catch (error) { return { id: row.id, passed: false, error: String(error), result }; }
});
const report = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
console.log(JSON.stringify(report));
process.exitCode = report.failed ? 1 : 0;
