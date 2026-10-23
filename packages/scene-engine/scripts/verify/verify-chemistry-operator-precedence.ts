/** Full source operators outrank overlapping incomplete request heuristics. */
import assert from "node:assert/strict";
import fs from "node:fs";
import "../../src/chemistry/families";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { readOrganicReactionSource } from "../../src/chemistry/organic/reactionSource";
import { findMentions } from "../../src/chemistry/organic/namedMentions";
import { sourceGraphProductHolds } from "../../src/chemistry/organic/reactionGraph";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { readSourceLawGraph } from "../../src/chemistry/sourceLawGraph";
import rows from "./fixtures/chemistry-operator-precedence.json";
const results: unknown[]=[]; let failed=0;
for (const row of rows) for (const [route,produce] of [["ordinary",synthesizeFamilyScene],["last",synthesizeLastResortScene]] as const) {
  const actual=produce({question:row.question});let error: string|null=null;
  try {
    assert.equal(Boolean(actual),row.draw,"whole independently stated request draws or declines");
    if(actual){
      assert.equal(actual.document.source.question,row.question);
      const compiled=compileSceneDocument(actual.document);assert.ok(compiled.ok&&compiled.renderScene);
      const labels=compiled.renderScene.primitives.flatMap(p=>p.text?[p.text]:[]);
      if(row.kind==="reaction"){
        assert.equal(actual.family,"chem_organic");const read=readOrganicReactionSource(row.question,findMentions(row.question));assert.ok(read.status==="source");
        assert.ok(sourceGraphProductHolds(read.model.kind,read.model.reactant,read.model));
        assert.equal(read.model.carbonCounts[0]!-read.model.carbonCounts[1]!,1);
        assert.ok(labels.includes(`C atoms: ${read.model.carbonCounts[0]}->${read.model.carbonCounts[1]}`));
      } else if(row.kind==="geometric") {
        assert.equal(actual.family,"chem_organic");assert.ok(labels.some(x=>/\bcis-/i.test(x)));assert.ok(labels.some(x=>/\btrans-/i.test(x)));
        assert.equal(actual.document.revealGroups.length,2,"both full structures survive");
      } else if(row.kind==="source-role") {
        // The existing radiation fixture permits the established chemistry
        // producer for atomic-source context; assert the sodium state itself.
        assert.ok(actual.family==="energy_level"||actual.family==="chem_orbital");const read=readRadiationSource(row.question);assert.ok(read.status==="source"&&read.model.kind==="photoelectric");
        assert.equal(read.model.workFunctionEV,2.3);assert.ok(Math.abs(read.model.photonEnergyEV-3.1)<1e-12);assert.ok(Math.abs(read.model.kineticEV!-0.8)<1e-12);
        for(const [symbol,value]of [["(?:E|hν)",3.1],["(?:phi|φ)",2.3],["K",0.8]]as const){const printed=labels.map(x=>new RegExp(`^${symbol}=([0-9]+(?:\\.[0-9]+)?) eV$`).exec(x)).find(Boolean);assert.ok(printed&&Math.abs(Number(printed[1])-value)<1e-12);}
      } else if(row.kind==="series-parallel") {
        assert.equal(actual.family,"circuit_network");assert.ok("series"in row&&"parallel"in row&&"count"in row&&"resistance"in row);
        for(const[symbol,value]of [["Req(s)",row.series],["Req(p)",row.parallel]]as const){const quantity=actual.document.quantities.find(q=>q.symbol===symbol);assert.ok(quantity&&typeof quantity.value==="number"&&typeof value==="number");assert.ok(Math.abs(quantity.value-value)<1e-12);assert.equal(quantity.unit,"ohm");assert.equal(quantity.provenance,"derived");}
        assert.ok(labels.includes(`Req(s)=${row.series} ohm`),"series paint is the actual sum, never the parallel fraction");
        assert.ok(labels.includes(`Req(p)=${row.resistance}/${row.count}Ω`),"parallel fractional label retains the stated equal resistor value/count");
        const sourceResistors=actual.document.quantities.filter(q=>/^R[0-9]+$/.test(q.symbol));assert.equal(sourceResistors.length,row.count);for(const resistor of sourceResistors)assert.equal(resistor.value,row.resistance);
      } else {
        const read=readSourceLawGraph(row.question,"chem_orbital");assert.ok(read.state==="valid");
        assert.equal(actual.family,"chem_orbital");assert.ok(actual.document.constructions.some(step=>step.operator==="function_curve"));
        assert.ok(labels.some(x=>/no.*emission/i.test(x)),"the requested non-emission region survives");
      }
    }
  }catch(e){failed++;error=String(e);}
  results.push({id:row.id,route,question:row.question,error,actual});
}
const out=process.argv.indexOf("--out");if(out>=0)fs.writeFileSync(process.argv[out+1]!,JSON.stringify({checks:results.length,failed,results},null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({checks:results.length,passed:results.length-failed,failed}));if(failed)process.exitCode=1;
