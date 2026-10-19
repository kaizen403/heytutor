/** Reviewed source/surface roles, elliptical samples and pure drawing requests. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";
import fixtures from "./fixtures/chemistry-photoelectric-source-roles-delta.json";
const results: Array<{id:string;passed:boolean;error?:string;document:SceneDocument|null;compiled:ReturnType<typeof compileSceneDocument>|null}>=[];
for (const row of fixtures) for (const path of ["direct","schematic","ordinary","lastResort"] as const) {
  let document:SceneDocument|null=null,compiled:ReturnType<typeof compileSceneDocument>|null=null;
  try {
    const result=path==="direct"||path==="schematic" ? buildAtomicRadiationScene(row.question,[],path==="schematic")
      : path==="ordinary" ? synthesizeFamilyScene({question:row.question}) : synthesizeLastResortScene({question:row.question});
    document=result ? "document" in result ? result.document : result : null;
    assert.equal(Boolean(document),row.draw,`${row.id} source oracle stays ${row.draw?"draw":"decline"}`);
    if (document) {
      compiled=compileSceneDocument(document);assert.ok(compiled.ok&&compiled.renderScene,JSON.stringify(compiled.report.issues));
      assert.equal(document.source.question,row.question);assert.equal(document.source.chemistryFamily,"chem_orbital");
      const labels=compiled.renderScene.primitives.flatMap(primitive=>primitive.text?[primitive.text]:[]);
      assert.ok("phiEv" in row && "photonEv" in row);
      for(const [symbol,value] of [["phi",row.phiEv!],["E",row.photonEv!],["K",row.photonEv!-row.phiEv!]] as const) {
        const printed=labels.map(text=>new RegExp(`^${symbol}=([+\\-]?[0-9]+(?:\\.[0-9]+)?) eV$`).exec(text)).find(Boolean);
        assert.ok(printed,`${row.id} missing physical ${symbol} label`);
        assert.ok(Math.abs(Number(printed[1])-value)<=0.005,`${row.id} ${symbol} must agree with the independent physical value ${value}`);
      }
    }
    results.push({id:`${row.id}/${path}`,passed:true,document,compiled});
  } catch(error) {results.push({id:`${row.id}/${path}`,passed:false,error:error instanceof Error?error.message:String(error),document,compiled});}
}
const summary={passed:results.filter(row=>row.passed).length,failed:results.filter(row=>!row.passed).length,results};
const out=process.argv.indexOf("--out");if(out>=0)writeFileSync(process.argv[out+1]!,JSON.stringify(summary,null,2)+"\n",{flag:"wx"});
for(const row of results)console.log(`${row.passed?"PASS":"FAIL"} ${row.id}${row.error?`: ${row.error}`:""}`);
console.log(`verify-chemistry-photoelectric-source-roles-delta: ${summary.passed} passed, ${summary.failed} failed`);
if(summary.failed)process.exitCode=1;
