/** Local sample aliases and passive collectors; no numeric parser expansion. */
import assert from "node:assert/strict";
import { assertPhysicsEnergy } from "../lib/assertPhotoelectricPhysics";
import { writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { OPTICS_GENERATORS } from "../../src/archetypes/generators/optics";
import { compileSceneDocument } from "../../src/compile/compiler";
import { restoredPhotoelectricInputsValid } from "../../src/physics/photoelectricSurfaces";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import fixtures from "./fixtures/chemistry-photoelectric-label-role.json";

const results: Array<{ id: string; required: boolean; passed: boolean; error?: string }> = [];
function check(id: string, run: () => void, required = true): void {
  try { run(); results.push({ id, required, passed: true }); }
  catch (error) { results.push({ id, required, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}
for (const row of [...fixtures.restorations, ...fixtures.collectorBoundaries, ...fixtures.collectorList]) {
  for (const route of ["direct", "schematic", "ordinary", "lastResort"] as const) {
    const required = !("requiredRestoration" in row) || row.requiredRestoration;
    check(`${row.id}/${route}`, () => {
      const result = route === "direct" || route === "schematic"
        ? buildAtomicRadiationScene(row.question, [], route === "schematic")
        : route === "ordinary" ? synthesizeFamilyScene({ question: row.question }) : synthesizeLastResortScene({ question: row.question });
      assert.equal(!!result, row.draw, `${row.id} science oracle stays ${row.draw ? "draw" : "decline"}`);
      if (!result) return;
      const document = "document" in result ? result.document : result;
      const compiled = compileSceneDocument(document);
      assert.ok(compiled.ok && compiled.renderScene, "normal compiler must accept the whole figure");
      assert.equal(document.source.question, row.question);
      if ("phiEv" in row && row.phiEv !== undefined) {
        const labels = compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text] : []);
        if (route === "ordinary" || route === "lastResort") {
          assert.ok("family" in result && result.family === "energy_level", "generic photoelectric physics family");
          assertPhysicsEnergy(document, labels, row.phiEv, row.photonEv!);
        } else {
          assert.ok(labels.includes(`phi=${row.phiEv.toFixed(2)} eV`));
          assert.ok(labels.includes(`E=${row.photonEv!.toFixed(2)} eV`));
          assert.ok(labels.includes(`K=${(row.photonEv!-row.phiEv).toFixed(2)} eV`));
        }
      }
    }, required);
  }
}
for (const row of [...fixtures.photonPhysics, ...fixtures.collectorPhysics, ...fixtures.collectorList]) {
  check(`${row.id}/actual-physics-generator`, () => {
    const document = OPTICS_GENERATORS.photoelectric!({ question: row.question,
      slots: { workFunction: row.phiSlot, ...(row.photonSlot === null ? {} : { photonEnergy: row.photonSlot }) },
      sources: { workFunction: "stem", photonEnergy: "stem" }, quantities: [], schematic: false });
    assert.equal(!!document, row.draw);
    if (document) assert.ok(compileSceneDocument(document).ok);
  });
}
for (const row of fixtures.roleProofTransfers) for (const route of ["direct", "schematic", "ordinary", "lastResort", "physics"] as const) {
  check(`${row.id}/complete-collector-role/${route}`, () => {
    const result = route === "direct" || route === "schematic" ? buildAtomicRadiationScene(row.question, [], route === "schematic")
      : route === "ordinary" ? synthesizeFamilyScene({ question: row.question })
        : route === "lastResort" ? synthesizeLastResortScene({ question: row.question })
          : OPTICS_GENERATORS.photoelectric!({ question: row.question,
            slots: { workFunction: row.phiEv, photonEnergy: row.photonEv },
            sources: { workFunction: "stem", photonEnergy: "stem" }, quantities: [], schematic: false });
    assert.equal(!!result, route === "physics" ? row.physicsDraw : row.draw);
    if (result) assert.ok(compileSceneDocument("document" in result ? result.document : result).ok);
  }, row.requiredRestoration);
}
// Exact independent subject/reference regressions plus finite same-contract transfers.
for (const row of fixtures.referenceTransfers) for (const route of ["direct", "schematic", "ordinary", "lastResort", "physics"] as const) {
  check(`${row.id}/collector-reference/${route}`, () => {
    const result = route === "direct" || route === "schematic" ? buildAtomicRadiationScene(row.question, [], route === "schematic")
      : route === "ordinary" ? synthesizeFamilyScene({ question: row.question })
        : route === "lastResort" ? synthesizeLastResortScene({ question: row.question })
          : OPTICS_GENERATORS.photoelectric!({ question: row.question,
            slots: { workFunction: row.phiEv, photonEnergy: row.photonEv },
            sources: { workFunction: "stem", photonEnergy: "stem" }, quantities: [], schematic: false });
    assert.equal(!!result, route === "physics" ? row.physicsDraw : row.draw);
    if (result) assert.ok(compileSceneDocument("document" in result ? result.document : result).ok);
  });
}
// A threshold quantity needs a reaction owner before the reaction family may
// admit it; photoelectric refusal cannot turn into a fabricated reaction graph.
for (const row of fixtures.thermoOwners) for (const route of ["direct", "schematic", "ordinary", "lastResort"] as const) {
  check(`${row.id}/threshold-reaction-owner/${route}`, () => {
    const result = route === "direct" || route === "schematic" ? buildThermoGraphScene(row.question, [], route === "schematic")
      : route === "ordinary" ? synthesizeFamilyScene({ question: row.question }) : synthesizeLastResortScene({ question: row.question });
    assert.equal(!!result, row.draw);
    if (!result) return;
    const compiled = compileSceneDocument("document" in result ? result.document : result);
    assert.ok(compiled.ok && compiled.renderScene);
    const labels = compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text] : []);
    for (const label of row.labels ?? []) assert.ok(labels.includes(label));
  });
}
check("canonical-element-symbol-keeps-existing-physics-wavelength", () => {
  const document = OPTICS_GENERATORS.photoelectric!({
    question: "The work function of sodium is 2.3 eV. Light of wavelength 400 nm falls on sodium metal Na. Draw the photoelectric diagram.",
    slots: { workFunction: 2.3, lambda: 400 }, sources: { workFunction: "stem", lambda: "stem" }, quantities: [], schematic: false });
  assert.ok(document, "Na was already a chemical alias, not a newly identified sample");
  assert.ok(compileSceneDocument(document).ok);
});
// These checks exercise the installed guard, using values its caller would
// actually draw. A strict fractional/decimal reading cannot bless a loose one.
for (const [id, question, phi, photon, expected] of [
  ["leading-decimal-phi-mismatch", "The work function of sodium is .3 eV. Photons of energy 3 eV fall on sodium plate A. Draw the photoelectric diagram.", 3, 3, false],
  ["fractional-phi-mismatch", "The work function of sodium is 1/2 eV. Photons of energy 3 eV fall on sodium plate A. Draw the photoelectric diagram.", 1, 3, false],
  ["leading-decimal-photon-mismatch", "The work function of sodium is 2 eV. Photons of energy .3 eV fall on sodium plate A. Draw the photoelectric diagram.", 2, 3, false],
  ["source-frequency-exact", "The work function of sodium is 2 eV. Light of frequency 1e15 Hz falls on sodium plate A. Draw the photoelectric diagram.", 2, 4.135667696923859, true],
  ["source-frequency-stale", "The work function of sodium is 2 eV. Light of frequency 1e15 Hz falls on sodium plate A. Draw the photoelectric diagram.", 2, 3, false],
  ["source-wavelength-exact", "The work function of sodium is 2 eV. Light of wavelength 400 nm falls on sodium plate A. Draw the photoelectric diagram.", 2, 3.0996049608300065, true],
  ["source-wavelength-stale", "The work function of sodium is 2 eV. Light of wavelength 400 nm falls on sodium plate A. Draw the photoelectric diagram.", 2, 3, false],
] as const) check(id, () => assert.equal(restoredPhotoelectricInputsValid(question, phi, photon), expected));

const required = results.filter(row => row.required);
const diagnostics = results.filter(row => !row.required);
const report = { scope: "Offline source/normal compile/genuine generator checks. Synthetic stale slots are refusal controls; not native/live/coverage.",
  baselineForInheritedDiagnostics: "4d5d772bf9d5f4f1fe763559f6d541c2c1bd0b70",
  passed: required.filter(row => row.passed).length, failed: required.filter(row => !row.passed).length,
  desiredPositiveDiagnosticsUnmet: diagnostics.filter(row => !row.passed).length, results };
const outIndex = process.argv.indexOf("--out");
if (outIndex >= 0) { assert.ok(process.argv[outIndex+1]); writeFileSync(process.argv[outIndex+1]!, JSON.stringify(report, null, 2)+"\n"); }
for (const row of required.filter(row => !row.passed)) console.error(`FAIL ${row.id}: ${row.error}`);
console.log(`verify-chemistry-photoelectric-label-role: ${report.passed} required passed, ${report.failed} failed; ${report.desiredPositiveDiagnosticsUnmet} explicitly deferred desired-positive diagnostics remain unmet`);
if (report.failed) process.exitCode = 1;
