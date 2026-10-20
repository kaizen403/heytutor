/** Frozen public surface-owner refusals and unchanged single-surface figures. */
import assert from "node:assert/strict";
import { assertPhysicsEnergy } from "../lib/assertPhotoelectricPhysics";
import { readFileSync, writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildAtomicRadiationScene, isAtomicRadiationStem } from "../../src/chemistry/atomicRadiation";
import { inferChemistryFamilies, isChemistryQuestion } from "../../src/chemistry/router";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import type { SceneDocument, RenderScene } from "../../src/types";
import rows from "./fixtures/chemistry-photoelectric-surface-ownership.json";
import materialReview from "./fixtures/chemistry-photoelectric-material-review.json";
import nonclaimMain from "./fixtures/chemistry-photoelectric-nonclaim-main.json";

// Approved scientific erratum: the frozen S06 input and old unsupported-parser
// null oracle remain in the fixture. Typed source parsing now converts J to eV.
// Independent Decimal50/compiled-geometry receipt: S06-INDEPENDENT-SCIENCE-ERRATUM-CLOSED.
const s06Question = "The work function of a metal is 3.2e-19 J. Light of frequency 1e15 Hz falls on it. Draw the photoelectric diagram.";
const allRows = [...rows, ...materialReview].map(row => {
  if (row.id !== "review-S06") return row;
  assert.equal(row.question, s06Question);
  assert.equal(row.kind, "material-review-negative", "original unsupported parser oracle is retained");
  assert.deepEqual(row.expected, { isAtomicRadiationStem: true });
  return { ...row, kind: "material-review-positive", expected: {
    isAtomicRadiationStem: true,
    phiEv: 1.997282903827444, photonEv: 4.135667696923859, kineticEv: 2.1383847930964146,
    labels: ["phi=2.00 eV", "E=4.14 eV", "K=2.14 eV"],
  } };
});

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  assert.ok(value && !value.startsWith("--"), `${flag} needs a path`);
  return value;
}
function labels(render: RenderScene): string[] {
  return render.primitives.flatMap((primitive) => primitive.text ? [primitive.text] : []);
}
function direct(document: SceneDocument | null) {
  if (!document) return null;
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  return { document, renderScene: result.renderScene, labels: labels(result.renderScene) };
}
function synthesized(scene: ReturnType<typeof synthesizeFamilyScene>) {
  return scene ? { ...scene, labels: labels(scene.renderScene) } : null;
}
function outcome(question: string) {
  return {
    atomic: isAtomicRadiationStem(question),
    chemistry: isChemistryQuestion(question),
    families: inferChemistryFamilies(question),
    direct: direct(buildAtomicRadiationScene(question, [], false)),
    schematic: direct(buildAtomicRadiationScene(question, [], true)),
    ordinary: synthesized(synthesizeFamilyScene({ question })),
    lastResort: synthesized(synthesizeLastResortScene({ question })),
  };
}
// A saved baseline omits undefined object fields; compare both sides as JSON.
function persisted(value: ReturnType<typeof outcome>): ReturnType<typeof outcome> {
  return JSON.parse(JSON.stringify(value));
}
// Capture complete documents/rendered outcomes once. ROOT uses --snapshot on
// gate-only main. Nonclaims and unchanged direct chemistry retain whole-outcome
// parity. Public finite photoelectric routes intentionally move to physics; their
// frozen numeric/source oracles replace the obsolete chemistry-layout snapshot.
const observed = allRows.map((row) => ({ id: row.id, question: row.question, outcome: outcome(row.question) }));
const snapshot = argument("--snapshot");
if (snapshot) writeFileSync(snapshot, JSON.stringify(observed, null, 2) + "\n", { flag: "wx" });
const baselinePath = argument("--baseline");
const baseline: typeof observed | null = baselinePath ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
if (baseline) {
  assert.equal(baseline.length, allRows.length, "baseline contains all frozen rows");
  assert.deepEqual(baseline.map(({ id, question }) => ({ id, question })), observed.map(({ id, question }) => ({ id, question })), "ordered baseline question identities");
}
let passed = 0;
let failed = 0;
for (const [index, row] of allRows.entries()) {
  try {
    const actual = observed[index]!.outcome;
    assert.equal(actual.atomic, row.kind.includes("nonclaim") ? row.expected.isAtomicRadiationStem : false, `${row.id} generic photoelectric remains outside atomic chemistry`);
    if (row.kind.includes("nonclaim")) {
      // Pin observed legacy main behavior; these are not physical numeric oracles.
      const fixed = nonclaimMain.find((entry) => entry.id === row.id || entry.question === row.question);
      assert.ok(fixed, `${row.id} fixed main scene outcome`);
      assert.equal(fixed.question, row.question);
      const falseDefaultIds = new Set(["C-CONCEPTUAL", "lamp-transfer-qualitative-legacy-original-control"]);
      if (falseDefaultIds.has(row.id)) {
        // Independent safety erratum: the frozen no-givens baseline painted
        // invented phi/E/K values 2/3/1 eV. Retain that complete artifact, but
        // require no such figure on the current four public/direct routes.
        assert.equal(row.question, "Explain why the work function is different for different metals.");
        assert.equal(actual.chemistry, false);
        assert.deepEqual(actual.families, []);
        for (const path of ["direct", "schematic", "ordinary", "lastResort"] as const) assert.equal(actual[path], null, `${row.id} ${path}: no invented default ink`);
        for (const path of ["ordinary", "lastResort"] as const) {
          const prior = fixed.outcome[path];
          assert.ok(prior);
          assert.deepEqual(prior.document.quantities, []);
          for (const label of ["φ=2 eV", "hν=3 eV", "K=1 eV"]) assert.ok(prior.labels.includes(label), "full unsupported default artifact is retained");
        }
        if (baseline) assert.deepEqual(persisted(baseline[index]!.outcome), fixed.outcome, `${row.id} original false-default artifact remains exact`);
      } else {
        assert.deepEqual(persisted(actual), fixed.outcome, `${row.id} default entire main outcome`);
        if (baseline) assert.deepEqual(persisted(actual), persisted(baseline[index]!.outcome), `${row.id} entire main outcome`);
      }
    } else {
      assert.equal(actual.chemistry, false, "the finite generic photoelectric cohort belongs to physics");
      assert.ok(!actual.families.includes("chem_orbital"), "no chemistry capture");
      if (row.kind.includes("negative")) {
        for (const path of ["direct", "schematic", "ordinary", "lastResort"] as const) {
          assert.equal(actual[path], null, `${row.id} ${path} must decline unsupported multiple surfaces`);
        }
      } else {
        const expectedLabels = "labels" in row.expected ? row.expected.labels : undefined;
        assert.ok(expectedLabels, `${row.id} independent labels are frozen`);
        for (const path of ["direct", "schematic", "ordinary", "lastResort"] as const) {
          const drawn = actual[path];
          assert.ok(drawn, `${row.id} ${path} must draw`);
          assert.equal(drawn.document.source.question, row.question, `${row.id} ${path} source question`);
          if (path === "ordinary" || path === "lastResort") {
            assert.ok("family" in drawn && drawn.family === "energy_level", "actual physics family");
            const labelValue = (symbol: string): number => {
              const label = expectedLabels.find(value => value.startsWith(`${symbol}=`));
              assert.ok(label, `frozen ${symbol} label`);
              const value = Number(label.slice(symbol.length + 1).replace(/ eV$/, ""));
              assert.ok(Number.isFinite(value)); return value;
            };
            const fullPrecision = "phiEv" in row.expected && "photonEv" in row.expected;
            const phi = fullPrecision ? row.expected.phiEv! : labelValue("phi");
            const energy = fullPrecision ? row.expected.photonEv! : labelValue("E");
            const kinetic = "mustNotHaveKLabel" in row.expected && row.expected.mustNotHaveKLabel ? null
              : "kineticEv" in row.expected ? row.expected.kineticEv! : labelValue("K");
            assertPhysicsEnergy(drawn.document, drawn.labels, phi, energy, kinetic, !fullPrecision);
          } else {
            assert.equal(drawn.document.source.chemistryFamily, "chem_orbital", `${row.id} ${path} direct source family`);
            for (const label of expectedLabels) assert.ok(drawn.labels.includes(label), `${row.id} ${path} missing ${label}`);
          }
          if ("mustNotHaveKLabel" in row.expected && row.expected.mustNotHaveKLabel) {
            assert.ok(!drawn.labels.some((label) => /^K=/.test(label)), `${row.id} ${path} below-threshold K`);
          }
        }
        assert.equal(actual.ordinary!.family, "energy_level");
        assert.equal(actual.lastResort!.family, "energy_level");
        if (baseline) {
          const before = baseline[index]!.outcome;
          for (const path of ["direct", "schematic"] as const) {
            if (row.id === "review-S06") assert.equal(before[path], null, "original S06 unsupported-parser artifact retained");
            else assert.deepEqual(persisted(actual)[path], persisted(before)[path], `${row.id} complete direct chemistry ${path}`);
          }
          for (const path of ["ordinary", "lastResort"] as const) {
            if (row.id === "review-S06") { assert.equal(before[path], null); continue; }
            const previous = before[path];
            assert.ok(previous, `${row.id} previous public figure retained as an input oracle`);
            assert.equal(previous.document.source.question, row.question);
            // The frozen old chemistry labels carry the same physical source golds;
            // the new producer has its own already-checked numeric level geometry.
            for (const label of expectedLabels) assert.ok(previous.labels.includes(label), `${row.id} original public physical label ${label}`);
          }
        }
      }
    }
    passed++;
    console.log(`PASS ${row.id}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`verify-chemistry-photoelectric-surface-ownership: ${passed} checks passed / ${failed} failed`);
if (failed) process.exitCode = 1;
