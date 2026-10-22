/** Source-grounded target operands never become concentration givens. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildKineticsScene } from "../../src/chemistry/kinetics";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import cases from "./fixtures/chemistry-kinetics-fraction-targets.json";
const rows: Array<{id: string; passed: boolean; error?: string}> = [];
for (const row of cases) for (const route of ["direct", "schematic", "ordinary", "lastResort"] as const) {
  try {
    const candidate = route === "direct" || route === "schematic" ? buildKineticsScene(row.question, [], route === "schematic")
      : route === "ordinary" ? synthesizeFamilyScene({question: row.question}) : synthesizeLastResortScene({question: row.question});
    assert.equal(!!candidate, row.draw, "complete source request admission");
    if (candidate) {
      const document = "document" in candidate ? candidate.document : candidate;
      assert.equal(document.source.question, row.question);
      assert.equal(document.source.chemistryFamily, "chem_kinetics");
      const compiled = compileSceneDocument(document);
      assert(compiled.ok && compiled.renderScene, "complete normal compile");
      const caption = document.annotations.find(annotation => annotation.id === "figure_caption")?.text ?? "";
      const answer = row.role === "remaining" ? /Time to fall to [^:]+: ([0-9.]+) min/.exec(caption)
        : /Time for [^:]+ completion: ([0-9.]+) min/.exec(caption);
      assert(answer && row.minutes, "requested fraction role and computed time must be explicit");
      const agrees = (text: string): boolean => {
        const decimals = text.includes(".") ? text.length-text.indexOf(".")-1 : 0;
        return Math.abs(Number(text)-row.minutes!) <= .5*10**(-decimals)+1e-8*row.minutes!;
      };
      assert(agrees(answer[1]!), "independent half-life/fraction oracle at printed precision");
      assert(compiled.renderScene.primitives.some(primitive => primitive.kind === "label" && primitive.text?.startsWith("t_") &&
        [...primitive.text.matchAll(/=\s*(\d+(?:\.\d+)?)\s*min\b/g)].some(match => agrees(match[1]!))), "computed time must be drawn");
    }
    rows.push({id:`${row.id}/${route}`,passed:true});
  } catch (error) { rows.push({id:`${row.id}/${route}`,passed:false,error:error instanceof Error?error.message:String(error)}); }
}
const result = {scope:"Offline source and ordinary compile; no native/coverage claim",passed:rows.filter(row=>row.passed).length,failed:rows.filter(row=>!row.passed).length,rows};
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out+1]!,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result));
if (result.failed) process.exitCode = 1;
