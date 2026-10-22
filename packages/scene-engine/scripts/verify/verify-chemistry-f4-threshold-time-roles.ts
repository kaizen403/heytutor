/** Source-bound requested times and threshold/incident roles; fixture golds
 * frozen before runtime changes and independent of detector default values. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { kineticsFromStem, buildKineticsScene } from "../../src/chemistry/kinetics";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import fixtures from "./fixtures/chemistry-f4-threshold-time-roles.json";
const results = fixtures.map(gold => { try {
  const ordinary = synthesizeFamilyScene({question:gold.question});
  const last = synthesizeLastResortScene({question:gold.question});
  for (const result of [ordinary,last]) assert.equal(!!result,gold.draw);
  if (gold.group === "time") {
    const spec = kineticsFromStem(gold.question);
    const direct = buildKineticsScene(gold.question,[],false);
    assert.equal(!!spec,gold.draw); assert.equal(!!direct,gold.draw);
    if (spec && "requested" in gold && gold.requested === null) assert.deepEqual(spec.timesAsked,[]);
    for (const doc of [direct,ordinary?.document,last?.document]) if(doc) {
      const c=compileSceneDocument(doc);assert.ok(c.ok && c.renderScene);
      if ("requested" in gold && gold.requested !== null) {
        const labels=c.renderScene.primitives.flatMap(p=>p.text?[p.text]:[]);
        assert.ok(labels.some(label=>label.replace(/\s/g,"").includes(`${gold.requested}min`)),"requested time visible");
        assert.ok(labels.some(label=>label === "1/8" || label.includes("0.125")),"requested source fraction visible");
      }
    }
  } else {
    const source=readRadiationSource(gold.question);
    if(!gold.draw) assert.equal(source.status,"declined");
    else {
      assert.equal(source.status,"symbolic" in gold && gold.symbolic?"symbolic":"source");
      for(const result of [ordinary,last]) {
        assert.ok(result);const doc=result.document;assert.equal(doc.source.question,gold.question);
        const c=compileSceneDocument(doc);assert.ok(c.ok && c.renderScene);
        const text=c.renderScene.primitives.flatMap(p=>p.text?[p.text]:[]).join(" ");
        assert.ok(text.includes("620"),"actual threshold source paint");
        if("symbolic" in gold && gold.symbolic) {
          assert.ok(!doc.quantities.some(q=>q.symbol === "E"),"no invented numeric incident photon");
          assert.ok(text.includes("not given"),"missing incident photon is explicit");
          assert.ok(doc.entities.some(e=>e.id === "E_top" && e.label === "hν"));
        } else {
          assert.ok(doc.quantities.some(q=>q.symbol === "E" && typeof q.value === "number" && Math.abs(q.value-3.1)<1e-12));
          assert.ok(text.includes("K=1.1"));
        }
      }
    }
  }
  return {id:gold.id,passed:true};
} catch(error) {return {id:gold.id,passed:false,error:String(error)};} });
const report={passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
if(process.argv.includes("--out"))writeFileSync(process.argv[process.argv.indexOf("--out")+1]!,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
