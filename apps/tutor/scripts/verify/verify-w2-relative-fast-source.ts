import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {selectFastVerifiedRepresentation,selectVerifiedRepresentation} from "../../features/tutor-session/lib/scene/representationFallback";
import {synthesizeFamilyScene,validateSceneQuantityAgreement,compileSceneDocument,type SceneDocument,type TurnPlanV3,type ProblemIR} from "@heytutor/scene-engine";
const fixture=JSON.parse(readFileSync(new URL("./fixtures/w2-relative-fast-original.json",import.meta.url),"utf8")) as {question:string;turnPlan:TurnPlanV3;problemIR:ProblemIR};
let checks=0;const check=(name:string,fn:()=>void)=>{fn();checks++;console.log(`PASS ${name}`);};
const labels=(doc:SceneDocument)=>{const c=compileSceneDocument(doc,{sourceAuthority:fixture});assert.ok(c.ok&&c.renderScene);return c.renderScene.primitives.flatMap(p=>(p.kind==="label"||p.kind==="dimension")&&typeof p.text==="string"?[p.text]:[]);};
const candidate=synthesizeFamilyScene(fixture);assert.ok(candidate);const texts=labels(candidate.document);
check("unchanged original fast result equals normal complete source figure",()=>{const before=JSON.stringify(fixture);const fast=selectFastVerifiedRepresentation(fixture);const normal=selectVerifiedRepresentation(fixture);assert.equal(fast?.tier,"exact_verified");assert.deepEqual(fast?.sceneDocument,normal.sceneDocument);assert.equal(fast?.renderScene.primitives.length,37);assert.equal(JSON.stringify(fixture),before);});
check("literal-only old agreement rejects while regenerated source context proves constructed origins",()=>{assert.ok(validateSceneQuantityAgreement(candidate.document.quantities,fixture.turnPlan,texts).length);assert.deepEqual(validateSceneQuantityAgreement(candidate.document.quantities,fixture.turnPlan,texts,{question:fixture.question,problemIR:fixture.problemIR,document:candidate.document}),[]);});
for(const [name,mutate] of [
 ["changed origin",(d:SceneDocument)=>{d.quantities.find(q=>q.id==="q_x0_A")!.value=1;}],
 ["changed reference rest",(d:SceneDocument)=>{d.quantities.find(q=>q.id==="q_rest_B")!.value=1;}],
 ["extra unproved scalar",(d:SceneDocument)=>{d.quantities.push({id:"extra",value:0,unit:"N"});}],
 ["swapped bodies",(d:SceneDocument)=>{const es=d.entities.filter(e=>e.id==="A"||e.id==="B");if(es.length===2)[es[0]!.label,es[1]!.label]=[es[1]!.label,es[0]!.label];else d.entities[0]!.label="foreign";}],
 ["extra numeric label",(d:SceneDocument)=>{d.entities.push({id:"foreign",kind:"label",role:"derived",label:"999 m"});}],
] as const)check(name,()=>{const document=structuredClone(candidate.document);mutate(document);assert.ok(validateSceneQuantityAgreement(document.quantities,fixture.turnPlan,texts,{question:fixture.question,problemIR:fixture.problemIR,document}).length);});
check("stale Plan role cannot be hidden by another allowed source value",()=>{const turnPlan=structuredClone(fixture.turnPlan);turnPlan.derived.find(q=>q.symbol==="t")!.value=100;assert.equal(selectFastVerifiedRepresentation({...fixture,turnPlan}),null);});
check("unrelated numeric role cannot borrow a source literal",()=>{const turnPlan=structuredClone(fixture.turnPlan);turnPlan.givens.push({id:"force",symbol:"F",value:72,unit:"N",provenance:"given"});assert.equal(selectFastVerifiedRepresentation({...fixture,turnPlan}),null);});
check("missing original caller stays declined",()=>{assert.equal(selectFastVerifiedRepresentation({...fixture,problemIR:null}),null);});
check("added required body cannot be pruned",()=>{const problemIR=structuredClone(fixture.problemIR);problemIR.entities.push({id:"foreign",kind:"body",label:"C",evidenceFactIds:[problemIR.facts[0]!.id]});problemIR.representationIntents[0]!.entityIds.push("foreign");assert.equal(selectFastVerifiedRepresentation({...fixture,problemIR}),null);});
check("different caller question stays declined",()=>{assert.ok(validateSceneQuantityAgreement(candidate.document.quantities,fixture.turnPlan,texts,{question:fixture.question.replace("100 m","200 m"),problemIR:fixture.problemIR,document:candidate.document}).length);});
check("injected displayed measure is not proved",()=>{assert.ok(validateSceneQuantityAgreement(candidate.document.quantities,fixture.turnPlan,[...texts,"0 N"],{question:fixture.question,problemIR:fixture.problemIR,document:candidate.document}).length);});
check("context quantities must be those independently regenerated",()=>{const quantities=structuredClone(candidate.document.quantities);quantities.push({id:"foreign",value:0,unit:"m"});assert.ok(validateSceneQuantityAgreement(quantities,fixture.turnPlan,texts,{question:fixture.question,problemIR:fixture.problemIR,document:candidate.document}).length);});
check("accessors never execute",()=>{let called=0;const context={question:fixture.question,problemIR:fixture.problemIR,document:candidate.document};Object.defineProperty(context,"question",{get(){called++;throw Error("executed");}});assert.ok(validateSceneQuantityAgreement(candidate.document.quantities,fixture.turnPlan,texts,context).length);assert.equal(called,0);});
check("cycles and inherited context are rejected",()=>{const context={question:fixture.question,problemIR:fixture.problemIR,document:candidate.document};Object.assign(context,{cycle:context});assert.ok(validateSceneQuantityAgreement(candidate.document.quantities,fixture.turnPlan,texts,context).length);assert.ok(validateSceneQuantityAgreement(candidate.document.quantities,fixture.turnPlan,texts,Object.create(context)).length);});
const holds=[
 {question:"Two cars A and B move towards each other at 10 m/s and 15 m/s. They are 500 m apart. Find when they meet.",givens:[["v_A",10,"m/s"],["v_B",15,"m/s"],["gap",500,"m"]],derived:[["v_AB",25,"m/s"],["t",20,"s"]]},
 {question:"In the ground frame, east is positive. At t=0 point A is at 100 m and B at 150 m; their constant ground velocities are +20 m/s and +10 m/s. Find the relative velocity of A with respect to B and the encounter time for t>=0.",givens:[["x_A",100,"m"],["x_B",150,"m"],["v_A",20,"m/s"],["v_B",10,"m/s"]],derived:[["v_AB",10,"m/s"],["t",5,"s"]]},
 {question:"Two trains A and B move in the same direction with speeds 24 m/s and 18 m/s respectively. Train A is 120 m behind B. Find how long A takes to catch up with B.",givens:[["v_A",24,"m/s"],["v_B",18,"m/s"],["gap",120,"m"]],derived:[["t",20,"s"]]},
 {question:"In the ground frame, east is positive. At t=0 point A is at 0 m and B at 100 m; their constant ground velocities are +20 m/s and +10 m/s. Observer O starts at x=0 m and moves east at +15 m/s. Report vAO, vBO, vAB and the encounter time for t>=0 in O's frame, using east as positive.",givens:[["v_A",20,"m/s"],["v_B",10,"m/s"],["v_O",15,"m/s"]],derived:[["v_AO",5,"m/s"],["v_BO",-5,"m/s"],["v_AB",10,"m/s"],["t",10,"s"]]},
];
for(const [i,h] of holds.entries())check(`independent complete caller holdout ${i}`,()=>{
 const question=h.question;
 const row=(xs:(string|number)[][],provenance:"given"|"derived")=>xs.map((x,j)=>({id:`${provenance}${j}`,symbol:String(x[0]),value:Number(x[1]),unit:String(x[2]),provenance}));
 const givens=row(h.givens,"given"),derived=row(h.derived,"derived");
 const turnPlan:TurnPlanV3={schemaVersion:"turn-plan/v3",question,givens,derived,unknowns:derived.map(({id,symbol,unit})=>({id,symbol,unit})),assumptions:[],qualitativeClaims:[],lawIds:[],visualRequirement:"required"};
 const entities:ProblemIR["entities"]=["A","B",...(i===3?["O"]:[])].map(id=>({id,kind:"body",label:id,evidenceFactIds:["setup"]}));
 const problemIR:ProblemIR={schemaVersion:"problem-ir/v1",id:`hold${i}`,question,facts:[{id:"setup",kind:"given",statement:question,evidence:{source:"question",start:0,end:question.length,quote:question}}],entities,expressions:[],constraints:[],solveRequests:[],representationIntents:[{id:"motion",kind:"conceptual",entityIds:entities.map(x=>x.id),evidenceFactIds:["setup"]}]};
 const input={question,turnPlan,problemIR};const fast=selectFastVerifiedRepresentation(input),normal=selectVerifiedRepresentation(input);assert.ok(fast,normal.reason);assert.deepEqual(fast.sceneDocument,normal.sceneDocument);
});
console.log(`relative fast source ${checks} checks`);
