import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import * as E from "../../src/index";
import type { SceneDocument } from "../../src/types";
import fixtures from "./fixtures/chemistry-owner-scope-regressions.json";
type Oracle = {equivalenceMl?:number;pK?:number;noVolumeLabels?:boolean;volumeLabelsLitres?:number[];deltaUj?:number;workJ?:number;totalPressureTorr?:number;qualitativeOnly?:boolean;noMeasuredPressureValues?:boolean};
type Case = {id:string;family:"chem_thermo"|"chem_solutions";question:string;expectedDraw:boolean;oracle:Oracle;diagnostic?:{reason:string;baselineHead:string}};
type Outcome = {id:string;question:string;route:string;expectedDraw:boolean;oracle:Oracle;document:SceneDocument|null;renderScene:unknown;labels:string[];passed:boolean;diagnostic?:Case["diagnostic"];validation?:ReturnType<typeof E.validateSceneDocument>;compiled?:ReturnType<typeof E.compileSceneDocument>;error?:string};
const results: Outcome[]=[];
for(const row of fixtures.rows as Case[]) for(const route of ["direct","schematic","ordinary","lastResort"]) {
  const outcome: Outcome={id:`${row.id}/${route}`,question:row.question,route,expectedDraw:row.expectedDraw,oracle:row.oracle,document:null,renderScene:null,labels:[],passed:false,...(row.diagnostic ? {diagnostic:row.diagnostic} : {})};
  try {
    const result=route==="direct"||route==="schematic" ? E.chemistryFamilyBuilder(row.family)(row.question,[],route==="schematic")
      : route==="ordinary" ? E.synthesizeFamilyScene({question:row.question}) : E.synthesizeLastResortScene({question:row.question});
    const document=result ? "document" in result ? result.document : result : null;
    outcome.document=document;
    if(document) {
      const validation=E.validateSceneDocument(E.pruneDeadSceneEntities(document as unknown as Record<string,unknown>));outcome.validation=validation;
      if(validation.document) {const compiled=E.compileSceneDocument(validation.document);outcome.compiled=compiled;outcome.renderScene=compiled.renderScene??null;outcome.labels=(compiled.renderScene?.primitives??[]).flatMap(p=>p.text?[p.text]:[]);}
    }
    assert.equal(!!document,row.expectedDraw,"frozen whole draw/refuse oracle");
    if(document) {
      assert.equal(document.source.chemistryFamily,row.family,"actual requested chemistry family");
      assert(outcome.validation?.document);assert(outcome.compiled?.ok&&outcome.renderScene);
      assert(!/NaN|Infinity|undefined/.test(outcome.labels.join(" ")));
      const labels=outcome.labels;const oracle=row.oracle;
      if(oracle.equivalenceMl!==undefined) {
        const foot=document.constructions.find(c=>c.outputs.includes("eq_foot"));assert.equal(foot?.inputs.x,oracle.equivalenceMl);
        assert(labels.includes(`V_eq = ${oracle.equivalenceMl} mL`));
      }
      if(oracle.pK!==undefined) assert((document.annotations.find(a=>a.id==="figure_caption")?.text??"").includes(`pKa = ${oracle.pK}`)||(document.annotations.find(a=>a.id==="figure_caption")?.text??"").includes(`pKb = ${oracle.pK}`));
      if(oracle.noVolumeLabels) assert(!labels.some(label=>/^V\s*=/.test(label)),"heat-source/recipient prepositions supply no process endpoints");
      if(oracle.volumeLabelsLitres) for(const value of oracle.volumeLabelsLitres) assert(labels.includes(`V=${value} L`),"actual endpoint must reach ink");
      if(oracle.deltaUj!==undefined) assert(labels.includes(`dU=+${oracle.deltaUj} J`),"actual first-law result must reach ink");
      if(oracle.workJ!==undefined) {
        const work=`w=${oracle.workJ > 0 ? "+" : ""}${oracle.workJ} J`;
        assert(labels.includes(work),"actual pressure-volume work must reach ink");
        assert(document.constructions.some(c=>c.outputs.includes("w_l")&&c.inputs.text===work),"source document must commit the checked work");
        if(oracle.deltaUj!==undefined) assert(document.constructions.some(c=>c.outputs.includes("du_l")&&c.inputs.text===`dU=+${oracle.deltaUj} J`),"source document must commit the first-law result");
      }
      if(oracle.totalPressureTorr!==undefined) {
        assert(labels.includes(`p_total = ${oracle.totalPressureTorr}`),"actual numeric mixture ink");assert(labels.includes("p (torr)"),"canonical pressure axis");
        assert((document.annotations.find(a=>a.id==="figure_caption")?.text??"").includes(`p_total = ${oracle.totalPressureTorr} torr`));
        assert(document.assertions.some(a=>a.id==="total_at_mix"),"computed mixture must be constrained to actual total curve");
      }
      if(oracle.qualitativeOnly) {assert(labels.includes("schematic"));assert(!labels.some(label=>/^p_total\s*=\s*\d/.test(label)),"unrelated lengths do not authorize measured pressures");}
    }
    outcome.passed=true;
  }catch(error){outcome.error=error instanceof Error?error.message:String(error);}
  results.push(outcome);
}
const required=results.filter(row=>!row.diagnostic);
const report={scope:"Actual public family/synthesis lifecycle with normal prune/validate/compile and complete numeric ink assertions. True inherited diagnostic oracles remain explicit; no native proof or measured coverage claim.",passed:required.filter(r=>r.passed).length,failed:required.filter(r=>!r.passed).length,diagnosticFailures:results.filter(r=>r.diagnostic&&!r.passed).length,results};
const out=process.argv.indexOf("--out");if(out>=0)writeFileSync(process.argv[out+1],JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({passed:report.passed,failed:report.failed,diagnosticFailures:report.diagnosticFailures,failures:required.filter(r=>!r.passed).map(r=>({id:r.id,error:r.error}))},null,2));

if(report.failed)process.exitCode=1;
