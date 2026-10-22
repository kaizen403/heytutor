/** VSEPR notation owns source molecule counts; abstract AX syntax is never a chemical member waiver. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { parseFormula } from "../../src/chemistry/formula";
import { buildVseprScene, vseprSpecies } from "../../src/chemistry/vsepr";
import { verifiedVseprStructure } from "../../src/chemistry/vseprStructure";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import fixture from "./fixtures/vsepr-source-notation.json";

const rows: Array<{ id: string; passed: boolean; actual: unknown; error: string | null }> = [];
function check(id: string, actual: unknown, test: () => void): void {
  try { test(); rows.push({ id, passed: true, actual, error: null }); }
  catch (error) { rows.push({ id, passed: false, actual, error: error instanceof Error ? error.message : String(error) }); }
}
function composition(text: string): string {
  const parsed = parseFormula(text); assert.ok(parsed);
  return `${parsed.atoms.map(atom => `${atom.symbol}:${atom.count}`).sort().join("|")}/${parsed.charge}`;
}
for (const gold of fixture.rows) {
  const expected = gold.expectedFormulas.map(composition).sort();
  const species = vseprSpecies(gold.question);
  check(gold.id + "/source", species, () => {
    assert.deepEqual(species.map(item => composition(item.formula)).sort(), expected);
    assert.deepEqual(species.map(item=>[item.bondPairs,item.lonePairs-(item.unpairedElectron?1:0)]),gold.counts,"independently frozen ligand/lone-pair counts");
  });
  for (const route of ["strict", "schematic", "ordinary", "lastResort"] as const) {
    const document = route === "ordinary" ? synthesizeFamilyScene({ question: gold.question })?.document ?? null
      : route === "lastResort" ? synthesizeLastResortScene({ question: gold.question })?.document ?? null
        : buildVseprScene(gold.question, [], route === "schematic");
    const compiled = document ? compileSceneDocument(document) : null;
    const witness = document ? verifiedVseprStructure(document, gold.question) : null;
    check(gold.id + "/" + route, { document, compiled, witness }, () => {
      if (!expected.length) {
        assert.equal(document, null, "An unresolved or contradictory member cannot draw a partial substitute");
        return;
      }
      assert.ok(document && compiled?.ok && compiled.renderScene);
      assert.equal(document.source.chemistryFamily, "chem_vsepr");
      assert.equal(document.source.question, gold.question);
      assert.ok(witness);
      assert.equal(witness.structures.length, expected.length);
      assert.ok(witness.structures.every(item => document.entities.some(entity => entity.id === item.formulaId && entity.label)), "Every witnessed molecule retains its visible formula identity");
    });
  }
}
const result = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const at = process.argv.indexOf("--out"); if (at >= 0) writeFileSync(process.argv[at + 1]!, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const row of rows) console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id}${row.error ? `: ${row.error}` : ""}`);
console.log(JSON.stringify({ passed: result.passed, failed: result.failed })); if (result.failed) process.exitCode = 1;
