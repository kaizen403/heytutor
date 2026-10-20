/** A source-class noun cannot hide a photon recipient; pure axes are complete only when requested alone. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { compileSceneDocument } from "../../src/compile/compiler";
import { multiplePhotoelectricSurfaces } from "../../src/physics/photoelectricSurfaces";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";
import fixtures from "./fixtures/chemistry-photoelectric-source-recipient-axes.json";

const results: Array<{ id: string; passed: boolean; error?: string; document: SceneDocument | null }> = [];
function record(id: string, run: () => SceneDocument | null): void {
  try { results.push({ id, passed: true, document: run() }); }
  catch (error) { results.push({ id, passed: false, error: error instanceof Error ? error.message : String(error), document: null }); }
}
for (const row of fixtures) {
  if (row.kind === "photoelectric") {
    record(`${row.id}/surface-roles`, () => {
      assert.equal(multiplePhotoelectricSurfaces(row.question), row.multiple, "independent source/sample role oracle");
      return null;
    });
    for (const route of ["direct", "schematic", "ordinary", "lastResort"] as const) record(`${row.id}/${route}`, () => {
      const result = route === "direct" || route === "schematic"
        ? buildAtomicRadiationScene(row.question, [], route === "schematic")
        : route === "ordinary" ? synthesizeFamilyScene({ question: row.question }) : synthesizeLastResortScene({ question: row.question });
      const document = result ? "document" in result ? result.document : result : null;
      assert.equal(Boolean(document), row.draw, "whole figure follows independently frozen source oracle");
      if (document) {
        const compiled = compileSceneDocument(document);
        assert.ok(compiled.ok && compiled.renderScene, "ordinary compiler accepts the complete source-owned scene");
        assert.equal(document.source.question, row.question);
        assert.ok("phiEv" in row && "photonEv" in row);
        const labels = compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text] : []);
        for (const [symbol, value] of [["phi", row.phiEv!], ["E", row.photonEv!], ["K", row.photonEv! - row.phiEv!]] as const) {
          const printed = labels.map(text => new RegExp(`^${symbol}=([+\\-]?[0-9]+(?:\\.[0-9]+)?) eV$`).exec(text)).find(Boolean);
          assert.ok(printed, `missing ${symbol} physical label`);
          assert.ok(Math.abs(Number(printed[1]) - value) <= 0.005, `${symbol} follows actual work function and photon energy`);
        }
      }
      return document;
    });
  } else {
    for (const route of ["ordinary", "lastResort"] as const) record(`${row.id}/${route}`, () => {
      const input = { question: row.question, families: row.families ?? undefined };
      const scene = route === "ordinary" ? synthesizeFamilyScene(input) : synthesizeLastResortScene(input);
      assert.equal(Boolean(scene), row.draw, "closed source request has all its requested geometry or declines");
      if (scene) {
        assert.equal(scene.document.source.question, row.question);
        const compiled = compileSceneDocument(scene.document);
        assert.ok(compiled.ok && compiled.renderScene);
        if (row.kind === "axes") {
          assert.equal(scene.family, "coordinate_figure", "pure axes use the existing typed coordinate builder");
          assert.ok(scene.document.entities.length > 0 && scene.document.entities.every(entity => entity.kind === "axes"));
          assert.equal(scene.nonMetric, true, "display axes do not assert source measurements");
        } else assert.ok(scene.document.entities.some(entity => entity.kind !== "axes"), "a readable curve retains more than axes");
      }
      return scene?.document ?? null;
    });
  }
}
const summary = { passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, results };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
for (const row of results) console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id}${row.error ? `: ${row.error}` : ""}`);
console.log(`verify-chemistry-photoelectric-source-recipient-axes: ${summary.passed} passed, ${summary.failed} failed`);
if (summary.failed) process.exitCode = 1;
