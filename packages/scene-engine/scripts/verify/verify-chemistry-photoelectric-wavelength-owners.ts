/** Exact source/render photon conversion and bounded reaction figure owners. */
import assert from "node:assert/strict";
import { assertPhysicsEnergy } from "../lib/assertPhotoelectricPhysics";
import { writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { OPTICS_GENERATORS } from "../../src/archetypes/generators/optics";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import fixtures from "./fixtures/chemistry-photoelectric-wavelength-owners.json";

const results: Array<{ id: string; required: boolean; passed: boolean; error?: string }> = [];
function check(id: string, required: boolean, run: () => void): void {
  try { run(); results.push({ id, required, passed: true }); }
  catch (error) { results.push({ id, required, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}
for (const row of fixtures.photoelectric) for (const route of ["direct", "schematic", "ordinary", "lastResort", "physics"] as const) {
  const required = !("diagnosticRoutes" in row && row.diagnosticRoutes.includes(route));
  check(`${row.id}/${route}`, required, () => {
    const result = route === "direct" || route === "schematic" ? buildAtomicRadiationScene(row.question, [], route === "schematic")
      : route === "ordinary" ? synthesizeFamilyScene({ question: row.question })
        : route === "lastResort" ? synthesizeLastResortScene({ question: row.question })
          : OPTICS_GENERATORS.photoelectric!({ question: row.question,
            slots: { workFunction: row.phiEv, lambda: row.lambdaNm }, sources: { workFunction: "stem", lambda: "stem" }, quantities: [], schematic: false });
    assert.equal(!!result, route === "physics" ? row.physicsDraw : row.draw, "scientific admission oracle is unchanged");
    if (!result) return;
    const document = "document" in result ? result.document : result;
    const compiled = compileSceneDocument(document);
    assert.ok(compiled.ok && compiled.renderScene, "normal compiler must accept the complete document");
    if (!("expectedPhotonEv" in row)) return;
    if (route === "physics" || route === "ordinary" || route === "lastResort") {
      if (route !== "physics") assert.ok("family" in result && result.family === "energy_level", "generic photoelectric physics family");
      const phi = "expectedPhiEv" in row ? row.expectedPhiEv! : row.phiEv;
      assertPhysicsEnergy(document, compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text] : []), phi, row.expectedPhotonEv!, row.expectedKineticEv!);
    } else {
      const phi = "expectedPhiEv" in row ? row.expectedPhiEv! : row.phiEv;
      const labels = compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text] : []);
      assert.ok(labels.includes(`phi=${phi.toFixed(2)} eV`));
      assert.ok(labels.includes(`E=${row.expectedPhotonEv!.toFixed(2)} eV`));
      assert.ok(labels.includes(`K=${row.expectedKineticEv!.toFixed(2)} eV`));
    }
  });
}
for (const row of fixtures.thresholdOwners) for (const route of ["direct", "schematic", "ordinary", "lastResort"] as const) {
  const required = !("diagnosticRoutes" in row && row.diagnosticRoutes.includes(route));
  check(`${row.id}/${route}`, required, () => {
    const result = route === "direct" || route === "schematic" ? buildThermoGraphScene(row.question, [], route === "schematic")
      : route === "ordinary" ? synthesizeFamilyScene({ question: row.question }) : synthesizeLastResortScene({ question: row.question });
    assert.equal(!!result, row.draw, "the original desired draw/decline oracle remains visible");
    if (!result) return;
    const document = "document" in result ? result.document : result;
    assert.equal(document.source.chemistryFamily, "chem_thermo", "bare analytic axes cannot satisfy a reaction profile request");
    const compiled = compileSceneDocument(document);
    assert.ok(compiled.ok && compiled.renderScene);
    const labels = compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text] : []);
    for (const label of ["R", "P", "TS"]) assert.ok(labels.includes(label), `whole reaction profile includes ${label}`);
  });
}
const required = results.filter(row => row.required);
const report = { scope: "Offline source, normal compilation and actual physics generator. Synthetic stale slots are refusal controls, not native/live/coverage.",
  inheritedDiagnosticBaseline: "cf4ebebc50d634ca78e8778cfe2d64766bfb373d",
  passed: required.filter(row => row.passed).length, failed: required.filter(row => !row.passed).length,
  diagnosticFailures: results.filter(row => !row.required && !row.passed).length, results };
const out = process.argv.indexOf("--out");
if (out >= 0) { assert.ok(process.argv[out + 1]); writeFileSync(process.argv[out + 1]!, JSON.stringify(report, null, 2) + "\n"); }
for (const row of required.filter(row => !row.passed)) console.error(`FAIL ${row.id}: ${row.error}`);
console.log(`verify-chemistry-photoelectric-wavelength-owners: ${report.passed} required passed, ${report.failed} failed; ${report.diagnosticFailures} inherited true-oracle diagnostics remain`);
if (report.failed) process.exitCode = 1;
