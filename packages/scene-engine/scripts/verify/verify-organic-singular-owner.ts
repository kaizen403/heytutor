/** A singular property reference retains its independently resolved owners. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildOrganicScene } from "../../src/chemistry/organic";
import { verifiedOrganicNeighbourhoodStructure } from "../../src/chemistry/organic/neighbourhoodStructure";
import { compileForLab } from "../chemistry-lab/lab";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import fixture from "./fixtures/organic-singular-owner.json";

const rows = fixture.flatMap(row => ["direct", "schematic", "ordinary", "lastResort"].map(route => {
  let error: string | null = null;
  let actual: unknown = null;
  try {
    const candidate = route === "direct" || route === "schematic" ? buildOrganicScene(row.question, [], route === "schematic")
      : route === "ordinary" ? synthesizeFamilyScene({ question: row.question }) : synthesizeLastResortScene({ question: row.question });
    const document = candidate ? "document" in candidate ? candidate.document : candidate : null;
    const compiled = document ? compileForLab(document) : null;
    actual = { document, compiled };
    assert.equal(!!document, row.draw, "complete source owner and property admission");
    if (document) {
      assert.ok(compiled?.ok && compiled.renderScene, "ordinary validation and compilation");
      assert.equal(document.source.question, row.question);
      assert.ok(verifiedOrganicNeighbourhoodStructure(document, row.question), "fresh whole source structure witness");
      assert.ok(!/NaN|Infinity|undefined/.test(compiled.renderScene.primitives.map(p => p.text ?? "").join(" ")));
    }
  } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  return { id: row.id, question: row.question, route, expectedDraw: row.draw, passed: error === null, error, actual };
}));
const result = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const at = process.argv.indexOf("--out");
if (at >= 0) writeFileSync(process.argv[at + 1]!, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const row of rows.filter(row => !row.passed)) console.error(`${row.id}/${row.route}: ${row.error}`);
console.log(JSON.stringify({ passed: result.passed, failed: result.failed }));
if (result.failed) process.exitCode = 1;
