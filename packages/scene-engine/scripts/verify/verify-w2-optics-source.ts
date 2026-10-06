import assert from "node:assert/strict";
import {readOpticalConjugateSource, opticalConjugatePlanConflicts} from "../../src/physics/opticalConjugateSource";
import {OPTICS_GENERATORS} from "../../src/archetypes/generators/optics";
import {compileSceneDocument} from "../../src/compile/compiler";
import {opticalConjugateDocument,validateOpticalConjugateSource} from "../../src/ir/opticalConjugateProgram";
import {synthesizeFamilyScene} from "../../src/synthesize/familyScene";
import type {ProblemIR} from "../../src/ir/problemIR";
let checks=0;
for (const [device,kind,v,magnification] of [
 ["mirror","concave",-15,-0.5], ["mirror","convex",7.5,0.25],
 ["lens","convex",15,-0.5], ["lens","concave",-7.5,0.25],
] as const) {
 for (const [u,f] of [["30 cm","10 cm"],["300mm","0.1 m"]]) {
  const question=`An object is placed ${u} in front of a ${kind} ${device} of focal length ${f}. Find the image distance and magnification.`;
  const source=readOpticalConjugateSource(question);assert.ok(source);
  assert.equal(source.v,v);assert.equal(source.magnification,magnification);
  assert.ok(source.inputs.every(row=>question.includes(row.quote)));
  const generator=OPTICS_GENERATORS[device==="mirror"?"spherical_mirror":"thin_lens"]!;
  const context={question,slots:{},sources:{},quantities:[],schematic:false};
  const document=generator(context);assert.ok(document);
  assert.equal(compileSceneDocument(document).ok,true,JSON.stringify(compileSceneDocument(document).report.issues));
  assert.equal(document.quantities.find(row=>row.id==="u")?.value,-30);
  assert.equal(document.quantities.find(row=>row.id==="v")?.value,v);
  const selected=synthesizeFamilyScene({question});assert.ok(selected);
  assert.equal(selected.tier,"question_representation");
  assert.deepEqual(validateOpticalConjugateSource(selected.document,question),[]);
  const setup=question.slice(0,question.indexOf("Find"));
  const problem:ProblemIR={schemaVersion:"problem-ir/v1",id:"concept",question,facts:[
   {id:"setup",kind:"given",statement:setup,evidence:{source:"question",quote:setup,start:0,end:setup.length}},
   {id:"ask",kind:"requested",statement:source.request,evidence:{source:"question",quote:source.request,start:setup.length,end:question.length}},
  ],entities:[{id:"sourceObject",kind:"body",label:"object",evidenceFactIds:["setup"]},{id:"sourceDevice",kind:"body",label:device,evidenceFactIds:["setup"]}],expressions:[],constraints:[],solveRequests:[],representationIntents:[{id:"apparatus",kind:"apparatus",entityIds:["sourceObject","sourceDevice"],evidenceFactIds:["setup"]}]};
  const full=opticalConjugateDocument(question,undefined,problem);assert.ok(full);
  assert.equal(compileSceneDocument(full,{sourceAuthority:{question,problemIR:problem}}).ok,true);
  assert.ok(synthesizeFamilyScene({question,problemIR:problem}));
  const hidden=structuredClone(problem);hidden.entities.push({...hidden.entities[0]!,id:"second",label:"another object"});
  assert.equal(opticalConjugateDocument(question,undefined,hidden),null);
  const unboundNumeric=structuredClone(problem);unboundNumeric.expressions.push({id:"invented",valueType:"scalar",root:{kind:"number",value:source.v},evidenceFactIds:["ask"]});
  assert.equal(opticalConjugateDocument(question,undefined,unboundNumeric),null);
  for (const field of ["quantity","required","reveal"] as const) {
   const forged=structuredClone(selected.document);
   if (field==="quantity") forged.quantities.find(row=>row.id==="v")!.value=999;
   else if (field==="required") forged.requiredEntityIds.pop();
   else forged.revealGroups[0]!.entityIds.pop();
   delete forged.source.slotSources;delete forged.source.archetype;delete forged.source.derivedSlots;
   assert.equal(compileSceneDocument(forged).ok,false);checks++;
  }
  assert.deepEqual(opticalConjugatePlanConflicts(source,[{id:"u",value:30,unit:"cm"},{id:"f",value:10,unit:"cm"},{id:"v",value:v,unit:"cm"}]),[]);
  for (const quantity of [{id:"u",value:40,unit:"cm"},{id:"f",value:10,unit:"m"},{id:"v",value:-v,unit:"cm"}]) {
   assert.ok(opticalConjugatePlanConflicts(source,[quantity]).length);
   assert.equal(generator({...context,quantities:[quantity]}),null);checks++;
  }
  for (const suffix of [" Another lens is present."," The object is virtual."," If the focal length changes, find the image."]) {
   assert.equal(readOpticalConjugateSource(question+suffix),null);
   assert.equal(generator({...context,question:question+suffix}),null);checks++;
  }
  checks++;
 }
}
for (const question of ["Explain how a convex lens forms an image.","Draw a ray diagram for a concave mirror."]) {
 assert.equal(readOpticalConjugateSource(question),null);
 for (const id of ["spherical_mirror","thin_lens"] as const) assert.equal(OPTICS_GENERATORS[id]!({question,slots:{u:30,f:10},sources:{u:"plan",f:"plan"},quantities:[],schematic:true}),null);
 checks++;
}
console.log(`PASS ${checks} source conjugate controls; public trust seams still pending`);
