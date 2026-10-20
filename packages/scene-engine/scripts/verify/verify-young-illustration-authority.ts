/** Requested qualitative examples cannot acquire factual count/metric authority. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readApertureSource, readYoungRepresentationRequest } from "../../src/physics/apparatusSource";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import fixtures from "./fixtures/young-illustration-authority.json";

const results:unknown[]=[];let failed=0;
const routes=[["ordinary",synthesizeFamilyScene],["last",synthesizeLastResortScene]] as const;
for(const row of fixtures)for(const[route,produce]of routes){
  const request=readYoungRepresentationRequest(row.question),factual=readApertureSource(row.question);
  const actual=produce({question:row.question});let error:string|null=null;
  try{
    if(row.expected==="declined"){
      assert.equal(request.status,"declined");assert.equal(actual,null,"unsupported request cannot escape through another family");
    }else if(row.expected==="not-young"){
      assert.equal(request.status,"unclaimed");assert.notEqual(actual?.document.source.archetype,"double_slit");
    }else{
      assert.ok(actual);assert.equal(actual.document.source.archetype,"double_slit");
      assert.equal(actual.document.source.question,row.question);
      for(const id of["S1","S2","screen","ray1","ray2","dim_d","dim_D","dim_beta"])assert.ok(actual.document.entities.some(entity=>entity.id===id),id);
      const paint=actual.renderScene.primitives.flatMap(primitive=>primitive.text?[primitive.text]:[]);
      if(row.expected==="illustration"){
        assert.equal(request.status,"illustration");assert.ok(request.status==="illustration");
        assert.equal(factual,null,"requesting an example is not a given slit-count fact");
        assert.equal(actual.tier,"question_representation");assert.equal(actual.nonMetric,true);
        assert.deepEqual(actual.document.quantities,[]);assert.deepEqual(actual.document.source.slotSources,{});
        assert.equal(actual.document.source.exactGrounding,null);
        assert.deepEqual(actual.document.source.youngRepresentationRequest,request);
        assert.equal(request.unmetVariants.length,row.partial?2:0);
        for(const span of request.spans)assert.ok(span.start>=0&&span.end<=row.question.length&&row.question.slice(span.start,span.end).trim());
        assert.ok(paint.includes("Qualitative")&&paint.includes("Young setup"),"actual visible scope qualification");
        assert.equal(paint.includes("Setup only"),row.partial);
        assert.ok(!paint.some(text=>/\b(?:d|D|lambda|λ|β)\s*=/.test(text)),"no numerical result or planner value is supplied");
      }else{
        assert.equal(request.status,"unclaimed");assert.ok(factual);assert.equal(actual.document.quantities.find(quantity=>quantity.symbol==="d")?.value,.5);
        assert.equal(actual.document.quantities.find(quantity=>quantity.symbol==="D")?.value,1);
        assert.equal(actual.document.quantities.find(quantity=>quantity.symbol==="lambda")?.value,500);
      }
    }
  }catch(caught){failed++;error=String(caught);}
  results.push({id:row.id,route,question:row.question,error,request,factual,actual});
}
// An illustration cannot borrow planner values, nor evade a full caller
// obligation that explicitly requires the slab rather than just the setup.
for(const[route,produce]of routes){
 const question="Draw the YDSE setup.";const actual=produce({question,turnPlan:{quantities:[{id:"d",symbol:"d",value:99,unit:"mm"},{id:"D",symbol:"D",value:98,unit:"m"}]}});
 let error:string|null=null;try{assert.ok(actual);assert.deepEqual(actual.document.quantities,[]);assert.deepEqual(actual.document.source.slotSources,{});assert.equal(actual.tier,"question_representation");}catch(caught){failed++;error=String(caught);}results.push({id:"stale-plan-not-given",route,error,actual});
 const fullQuestion="Draw a YDSE setup with a thin glass slab or a path difference.",quote="glass slab",start=fullQuestion.indexOf(quote);
 const problemIR:ProblemIR={schemaVersion:"problem-ir/v1",id:"requiredSlab",question:fullQuestion,
  facts:[{id:"slabRequest",kind:"requested",statement:"The caller requires the slab view.",evidence:{source:"question",start,end:start+quote.length,quote}}],
  entities:[{id:"slab",kind:"body",label:"glass slab",evidenceFactIds:["slabRequest"]}],expressions:[],constraints:[],
  representationIntents:[{id:"showSlab",kind:"apparatus",entityIds:["slab"],evidenceFactIds:["slabRequest"]}],solveRequests:[]};
 let obligationError:string|null=null;const required=produce({question:fullQuestion,problemIR});try{assert.ok(validateProblemIR(problemIR).valid);assert.equal(required,null,"normal required-body obligation remains terminal");}catch(caught){failed++;obligationError=String(caught);}results.push({id:"required-slab-obligation",route,error:obligationError,actual:required});
}
const report={checks:results.length,passed:results.length-failed,failed,results,scope:"Question-only qualitative operator authority; OR variant setups remain PARTIAL, not new complete coverage."};
const out=process.argv.indexOf("--out");if(out>=0)writeFileSync(process.argv[out+1]!,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({checks:report.checks,passed:report.passed,failed}));if(failed)process.exitCode=1;
