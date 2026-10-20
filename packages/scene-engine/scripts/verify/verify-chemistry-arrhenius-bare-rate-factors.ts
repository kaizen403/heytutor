/** Bare k is a rate-factor owner, while logarithm operands and kelvin K are not. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { kineticsFromStem, solveKinetics, buildKineticsScene } from "../../src/chemistry/kinetics";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
import fixtures from "./fixtures/chemistry-arrhenius-bare-rate-factors.json";

interface Gold {
  reason: string;
  sourceRatio?: number;
  slope_lnK_vs_inverseT?: number;
  slope?: number;
  axisOrdinate?: string;
  absoluteInterceptUnspecified?: boolean;
}
const rows: Array<{ id: string; required: boolean; passed: boolean; error: string | null; value: unknown }> = [];
function near(actual: unknown, expected: number): void {
  assert.equal(typeof actual, "number");
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(Number(actual) - expected) <= Math.max(1e-7, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
}
function record(id: string, required: boolean, run: () => unknown): void {
  try { rows.push({ id, required, passed: true, error: null, value: run() }); }
  catch (error) { rows.push({ id, required, passed: false, error: error instanceof Error ? error.message : String(error), value: null }); }
}
for (const row of fixtures) {
  const gold: Gold = row.scientificGold;
  record(`${row.id}/source-authority`, row.required, () => {
    const spec = kineticsFromStem(row.question);
    assert.equal(Boolean(spec), row.expectedDraw, "whole-source read, not generic nonnull geometry");
    if (!spec) return null;
    assert.ok(spec.arrhenius, "a stated factor/equation must produce actual Arrhenius authority");
    const solved = solveKinetics(spec);
    if (gold.sourceRatio !== undefined) {
      near(spec.arrhenius.ratio, gold.sourceRatio);
      near(solved.ratio, gold.sourceRatio);
    }
    const slope = gold.slope_lnK_vs_inverseT ?? (gold.slope === undefined ? undefined : gold.slope * (gold.axisOrdinate === "log k" ? Math.LN10 : 1));
    if (slope !== undefined) near(solved.Ea, -8.314 * slope);
    if (gold.absoluteInterceptUnspecified) {
      assert.equal(spec.arrhenius.A, null);
      assert.equal(spec.arrhenius.k1, null);
      assert.equal(spec.arrhenius.k2, null);
      assert.equal(spec.k, null);
    }
    return { spec, solved };
  });
  for (const route of ["strict", "schematic", "ordinary", "lastResort"] as const) record(`${row.id}/${route}`, row.required, () => {
    const document: SceneDocument | null = route === "ordinary" ? synthesizeFamilyScene({ question: row.question })?.document ?? null
      : route === "lastResort" ? synthesizeLastResortScene({ question: row.question })?.document ?? null
        : buildKineticsScene(row.question, [], route === "schematic");
    assert.equal(Boolean(document), row.expectedDraw);
    if (!document) return null;
    assert.equal(document.source.question, row.question);
    const compiled = compileSceneDocument(document);
    assert.ok(compiled.ok && compiled.renderScene);
    if (gold.sourceRatio !== undefined) near(document.quantities.find(quantity => quantity.id === "ratio")?.value, gold.sourceRatio);
    if (gold.absoluteInterceptUnspecified) assert.ok(!document.quantities.some(quantity => /^(?:A|lnA|ln_A|lnk1|lnk2)$/i.test(quantity.id) && typeof quantity.value === "number"), "relative factors do not supply absolute log rates/intercepts");
    return document;
  });
}
const result = { passed: rows.filter(row => row.required && row.passed).length, failed: rows.filter(row => row.required && !row.passed).length,
  desiredPositiveDiagnosticFailures: rows.filter(row => !row.required && !row.passed).length, rows };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const row of rows) console.log(`${row.passed ? "PASS" : row.required ? "FAIL" : "DESIRED-POSITIVE-GAP"} ${row.id}${row.error ? `: ${row.error}` : ""}`);
console.log(JSON.stringify({ passed: result.passed, failed: result.failed, desiredPositiveDiagnosticFailures: result.desiredPositiveDiagnosticFailures }));
if (result.failed) process.exitCode = 1;
