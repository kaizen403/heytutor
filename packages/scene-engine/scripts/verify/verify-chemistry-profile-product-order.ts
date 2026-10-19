/** Unspecified product energy is conditional geometry, never an assumed sign. */
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import "../../src/chemistry/families";
import {buildThermoGraphScene} from "../../src/chemistry/thermoGraphs";
import {compileSceneDocument} from "../../src/compile/compiler";
import {parseMathExpression} from "../../src/math/expression";
import {synthesizeFamilyScene,synthesizeLastResortScene} from "../../src/synthesize/familyScene";
import fixtures from "./fixtures/chemistry-profile-product-order.json";
const rows:Array<{id:string;required:boolean;passed:boolean;error?:string;document:unknown;compiled:unknown}>=[];
const ordered:Record<string,unknown>={};
const baselineFlag=process.argv.indexOf("--baseline");
const baseline=baselineFlag<0?null:JSON.parse(readFileSync(process.argv[baselineFlag+1]!,"utf8"));
for(const row of fixtures)for(const route of ["direct","schematic","ordinary","lastResort"] as const){
  let document:ReturnType<typeof buildThermoGraphScene>=null,compiled:ReturnType<typeof compileSceneDocument>|null=null;
  try{
    const result=route==="direct"||route==="schematic"?buildThermoGraphScene(row.question,[],route==="schematic")
      :route==="ordinary"?synthesizeFamilyScene({question:row.question}):synthesizeLastResortScene({question:row.question});
    document=result?"document"in result?result.document:result:null;
    if(row.mode==="ordered"){ordered[`${row.id}/${route}`]=JSON.parse(JSON.stringify(result));if(baseline)assert.deepEqual(ordered[`${row.id}/${route}`],baseline[`${row.id}/${route}`],"existing known-order output byte-equivalent");}
    assert.equal(Boolean(document),row.mode!=="decline",`${row.id}: original draw/refusal gold`);
    if(document){
      compiled=compileSceneDocument(document);assert.ok(compiled.ok&&compiled.renderScene,JSON.stringify(compiled.report.issues));
      assert.equal(document.source.question,row.question);assert.equal(document.source.chemistryFamily,"chem_thermo");
      const labels=compiled.renderScene.primitives.flatMap(p=>p.text?[p.text]:[]);
      const rLabel="reactants"in row?row.reactants!:"R",pLabel="products"in row?row.products!:"P";
      for(const label of [rLabel,pLabel,"TS"])assert.ok(labels.includes(label),`visible ${label}`);
      if(row.mode==="alternatives"){
        assert.equal(document.source.nonMetric,true,"qualitative display cannot imply metric measurements");
        assert.equal(document.source.representationTier,"qualitative_verified");
        assert.match(compiled.renderScene.caption??"",/qualitative/i,"compiled caption retains qualitative scope");
        assert.ok(labels.includes("ΔH not given"));assert.ok(labels.includes("Possibilities"));
        for(const text of ["If ΔH < 0","If ΔH = 0","If ΔH > 0","potential energy","not to scale"])assert.ok(labels.includes(text),`visible ${text}`);
        assert.equal(labels.filter(t=>t===rLabel).length,3);assert.equal(labels.filter(t=>t===pLabel).length,3);assert.equal(labels.filter(t=>t==="TS").length,3);
        assert.equal(document.quantities?.filter(q=>/ΔH|dH/.test(q.symbol)).length??0,0,"no actual reaction enthalpy quantity");
        assert.ok(!document.entities.some(e=>e.role==="enthalpy change"));
        const curves=document.constructions.filter(c=>c.operator==="function_curve").sort((a,b)=>Number(a.inputs.xMin)-Number(b.inputs.xMin));
        assert.equal(curves.length,6,"three complete two-flank paths");
        for(let panel=0;panel<3;panel++){
          const left=curves[2*panel]!,right=curves[2*panel+1]!;
          const evaluate=(curve:typeof left,x:number)=>parseMathExpression(String(curve.inputs.expression)).evaluate(x);
          const xR=Number(left.inputs.xMin),xTS=Number(left.inputs.xMax),xP=Number(right.inputs.xMax);
          assert.equal(xTS,Number(right.inputs.xMin));
          const r=evaluate(left,xR),ts=evaluate(left,xTS),p=evaluate(right,xP);
          assert.ok(Math.abs(ts-evaluate(right,xTS))<1e-8,"exact common transition state");
          assert.ok(ts>r&&ts>p,"activated path above both endpoints");
          assert.ok(panel===0?p<r:panel===1?Math.abs(p-r)<1e-8:p>r,"lower/equal/higher alternatives");
          assert.ok(document.assertions.filter(a=>a.predicate==="function_value"&&a.severity==="fatal").length>=12,"endpoints and joins independently asserted");
          const gap=document.constructions.find(c=>c.outputs.includes(`case_${panel}_ea`));
          assert.equal(gap?.operator,"dimension","each possible activated path retains the symbolic forward gap");
          const foot=document.constructions.find(c=>c.outputs.includes(`case_${panel}_ea_foot`));
          const top=document.constructions.find(c=>c.outputs.includes(`case_${panel}_ea_top`));
          assert.ok(foot&&top);assert.ok(Math.abs(Number(foot.inputs.y)-r)<1e-8);assert.ok(Math.abs(Number(top.inputs.y)-ts)<1e-8);
        }
        const reveal=document.revealGroups;assert.equal(reveal.length,1,"one engine group owns all qualifiers and alternatives; app ordering is independently checked");
        const curveIds=new Set(curves.flatMap(c=>c.outputs));
        for(const e of document.entities.filter(e=>e.kind==="label"||curveIds.has(e.id)))assert.ok(reveal[0]!.entityIds.includes(e.id),`grouped ${e.id}`);
        if("ea"in row){const quantity=document.quantities?.find(q=>q.id==="Ea_forward");assert.equal(quantity?.value,row.ea,"given/derived forward gap retained");}
        else assert.equal(document.quantities?.length??0,0,"no default physical scalars");
      }
    }
    rows.push({id:`${row.id}/${route}`,required:row.required,passed:true,document,compiled});
  }catch(error){rows.push({id:`${row.id}/${route}`,required:row.required,passed:false,error:error instanceof Error?error.message:String(error),document,compiled});}
}
const snapshot=process.argv.indexOf("--ordered-snapshot");if(snapshot>=0)writeFileSync(process.argv[snapshot+1]!,JSON.stringify(ordered,null,2)+"\n",{flag:"wx"});
const required=rows.filter(r=>r.required),report={passed:required.filter(r=>r.passed).length,failed:required.filter(r=>!r.passed).length,desiredPositiveDiagnosticFailures:rows.filter(r=>!r.required&&!r.passed).length,rows};
const out=process.argv.indexOf("--out");if(out>=0)writeFileSync(process.argv[out+1]!,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
for(const row of rows.filter(r=>!r.passed))console.log(`${row.required?"FAIL":"DESIRED-POSITIVE-GAP"} ${row.id}: ${row.error}`);
console.log(JSON.stringify({passed:report.passed,failed:report.failed,desiredPositiveDiagnosticFailures:report.desiredPositiveDiagnosticFailures}));
if(report.failed)process.exitCode=1;
