/** Independent Wave2 motion reproduction and source authority gate. Offline only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readUniformCircularSource } from "../../src/physics/uniformCircularSource";
import { uniformCircularNumericDocument } from "../../src/physics/uniformCircularScene";
import { canonicalizeUniformCircularSourceDocument, validateUniformCircularSourceInputs } from "../../src/physics/uniformCircularSourceBinding";
import { relativeMotionSource, relativeMotionSourceEntityBindings } from "../../src/physics/relativeMotionSource";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/w2-motion/${name}.json`, import.meta.url), "utf8"));
let groups = 0;
const failures: string[] = [];
function check(name: string, run: () => void) {
  groups++;
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const stone = fixture("w1-ucm-stone");
check("actual saved stone arithmetic regenerates exactly", () => {
  const source = readUniformCircularSource(stone.question);
  assert.ok(source?.status === "numeric");
  const document = uniformCircularNumericDocument(stone.question, source);
  document.quantities = stone.actualQuantities;
  assert.deepEqual(validateUniformCircularSourceInputs(document, stone.question), []);
});
const trains = fixture("w1-relative-trains");
check("actual catch and distance request admits both source actors", () => {
  assert.equal(relativeMotionSource(trains.question)?.status, "admitted");
});

const { buildUniformCircularSourceFallback } = await import("../../src/physics/uniformCircularSourceIR");
const { pruneDeadSceneEntities, validateSceneDocument, compileSceneDocument, synthesizeFamilyScene, validateProblemIR, LocalDeterministicSolverProvider } = await import("../../src/index");
const { motionRationalNumber } = await import("../../src/physics/relativeMotionSource");
const { relativeMotionDocument } = await import("../../src/synthesize/relativeMotionScene");
const { applyRelativeMotionAuthority, relativeMotionPlanConflicts } = await import("../../src/physics/motionPlanAgreement");
const { sceneDemand, demandRejection } = await import("../../src/synthesize/sceneDemand");
const { deriveVisualObligations, visualObligationRejection } = await import("../../src/synthesize/visualObligations");
const { verifyTurnPlanAgainstSolver } = await import("../../src/ir/solverAuthority");
const { validateTurnPlanV3 } = await import("../../src/contracts/contractsV3");
import type { ProblemIR, ExpressionNodeIR } from "../../src/ir/problemIR";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { SceneDocument } from "../../src/types";
const cloneJSONB = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).reverse()) : entry));
const close = (a: number, b: number) => assert.ok(Math.abs(a-b) < 1e-12 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
function rejects(document: SceneDocument) {
  delete document.source.archetype;
  delete document.source.slotSources;
  const result = compileSceneDocument(document);
  assert.equal(result.ok, false);
  assert.equal(result.renderScene, null);
}
const sourceStone = readUniformCircularSource(stone.question);
assert.ok(sourceStone?.status === "numeric");
const stoneDocument = uniformCircularNumericDocument(stone.question, sourceStone);
stoneDocument.quantities = stone.actualQuantities;
check("actual full stone IR and solver preserved, canonical JSONB regeneration", () => {
  assert.equal(validateProblemIR(stone.savedIR, stone.question).valid, true);
  assert.equal(stone.savedIR.entities.length, 2);
  assert.equal(stone.savedIR.facts.length, 5);
  assert.equal(stone.savedIR.solveRequests.length, 2);
  const canonical = canonicalizeUniformCircularSourceDocument(cloneJSONB(stoneDocument), stone.question);
  assert.ok(canonical);
  assert.deepEqual(canonical.quantities, uniformCircularNumericDocument(stone.question, sourceStone).quantities);
  assert.deepEqual(canonicalizeUniformCircularSourceDocument(cloneJSONB(canonical), stone.question), cloneJSONB(canonical));
  assert.equal(compileSceneDocument(canonical).ok, true);
});
for (const [name, mutation] of [
  ["one ULP radius literal", (d: SceneDocument) => { d.quantities[0]!.value = 0.8000000000000002; }],
  ["wrong source unit", (d: SceneDocument) => { d.quantities[0]!.unit = "cm"; }],
  ["wrong quantity actor", (d: SceneDocument) => { d.quantities[1]!.symbol = "v_B"; }],
  ["false label", (d: SceneDocument) => { d.entities.find(e => e.id === "accel")!.label = "a=8 m/s^2"; }],
  ["false role metadata", (d: SceneDocument) => { d.entities.find(e => e.id === "accel")!.role = "gravitational acceleration"; }],
  ["identity", (d: SceneDocument) => { d.entities.find(e => e.id === "P")!.label = "Q"; }],
  ["one ULP construction position", (d: SceneDocument) => { const c = d.constructions.find(c => c.outputs.includes("P"))!; c.inputs.x = Number(c.inputs.x) + 4.440892098500626e-16; }],
  ["forged annotation", (d: SceneDocument) => { d.annotations = [{id:"forged",kind:"sense",targetIds:["path"]}]; }],
  ["derived error beyond machine proof", (d: SceneDocument) => { d.quantities[1]!.value = 2.513274122872; }],
] as const) check(`stone rejects ${name} with markers stripped`, () => {
  const d = structuredClone(stoneDocument); mutation(d); rejects(d);
  assert.equal(canonicalizeUniformCircularSourceDocument(d, stone.question), null);
});
check("one ULP external source period cannot bind the old payload",()=>{
  assert.ok(validateUniformCircularSourceInputs(stoneDocument,stone.question.replace("2 s","2.0000000000000004 s")).length>0);
});
const ucmCases = [
  { name:"actual stone", question:stone.question, r:0.8, v:0.8*Math.PI, w:Math.PI, ac:0.8*Math.PI**2, T:2 },
  { name:"actual car", question:fixture("w1-ucm-car").question, r:50, v:20, w:0.4, ac:8, T:5*Math.PI },
  { name:"centimetre bead", question:"A bead moves at a constant speed of 40 cm/s in a circle of radius 2 cm. Find its centripetal acceleration and time for one revolution.", r:0.02,v:0.4,w:20,ac:8,T:Math.PI/10 },
  { name:"fraction radius", question:"A particle moves in a horizontal circle of radius 1/2 m with a period of 4 s. Find its speed and centripetal acceleration.", r:0.5,v:Math.PI/4,w:Math.PI/2,ac:Math.PI**2/8,T:4 },
  { name:"stated sense", question:"A body moves clockwise at a constant speed of 6 m/s in a circle of radius 12 m. Find its angular speed and centripetal acceleration.", r:12,v:6,w:0.5,ac:3,T:4*Math.PI },
];
for (const c of ucmCases) {
  const bundle = await buildUniformCircularSourceFallback(c.question);
  check(`${c.name}: whole source fallback and independent solver oracle`, () => {
    assert.ok(bundle, "complete source fallback must be admitted");
    assert.equal(bundle.problemIR.question, c.question);
    assert.equal(bundle.problemIR.entities.length, 3);
    assert.equal(bundle.problemIR.facts.length, 4);
    assert.equal(bundle.problemIR.solveRequests.length, 4);
    assert.equal(bundle.turnPlan.unknowns.length, 2);
    assert.equal(validateProblemIR(bundle.problemIR, c.question).valid, true);
    assert.equal(validateTurnPlanV3(bundle.turnPlan, c.question).valid, true);
    assert.equal(verifyTurnPlanAgainstSolver(bundle.problemIR,bundle.solverResult,bundle.turnPlan,c.question).status,"verified");
    const source = readUniformCircularSource(c.question); assert.ok(source?.status === "numeric");
    close(source.radiusM,c.r); close(source.speed,c.v); close(source.angularSpeed,c.w);close(source.centripetalAcceleration,c.ac);close(source.period,c.T);
    for (const [id,value] of [["v",c.v],["omega",c.w],["ac",c.ac],["T",c.T]] as const) {
      const result = bundle.solverResult.values.find(v=>v.requestId===`solve_${id}`)!;
      assert.equal(typeof result.approximate,"number");close(result.approximate as number,value);
    }
    const document = uniformCircularNumericDocument(c.question,source);
    const compiled = compileSceneDocument(document);assert.ok(compiled.ok && compiled.renderScene);
    const primitives = compiled.renderScene.primitives;
    const body = primitives.find(p=>p.entityId===(source.sense ? "body":"P") && p.kind==="point")!;
    const centre = primitives.find(p=>p.entityId==="O" && p.kind==="point")!;
    const accel = primitives.find(p=>p.entityId==="accel" && p.kind==="vector")!;
    const inward = {x:centre.points[0]!.x-body.points[0]!.x,y:centre.points[0]!.y-body.points[0]!.y};
    const a = {x:accel.points[1]!.x-accel.points[0]!.x,y:accel.points[1]!.y-accel.points[0]!.y};
    assert.ok(inward.x*a.x+inward.y*a.y>0);
    const tangent = primitives.find(p=>p.entityId===(source.sense ? "velocity":"tangent") && (p.kind==="line" || p.kind==="vector"))!;
    const v = {x:tangent.points[1]!.x-tangent.points[0]!.x,y:tangent.points[1]!.y-tangent.points[0]!.y};
    close((v.x*a.x+v.y*a.y)/(Math.hypot(v.x,v.y)*Math.hypot(a.x,a.y)),0);
    if (!source.sense) assert.ok(!primitives.some(p=>p.entityId==="velocity" && p.kind==="vector"));
    for (const p of primitives) for(const pt of p.points) assert.ok(pt.x>=400&&pt.x<=1160&&pt.y>=0&&pt.y<=700);
    assert.deepEqual(validateUniformCircularSourceInputs(cloneJSONB(document),c.question),[]);
    const forged=structuredClone(document);forged.quantities[0]!.value=source.radius+source.radius*Number.EPSILON;rejects(forged);
    // Exercise real family call with complete IR; record its outcome separately below.
  });
  if (bundle) {
    const scene=synthesizeFamilyScene({question:c.question,turnPlan:bundle.turnPlan,problemIR:bundle.problemIR});
    console.log(`DIAGNOSTIC full-IR family ${c.name}: ${scene ? scene.tier : "declined (parent seam)"}`);
  }
}
for (const [name, question] of [
  ["extra actor",ucmCases[1]!.question.replace("Find","A bus moves at 10 m/s. Find")],
  ["unknown unit",ucmCases[1]!.question.replace("20 m/s","20 mph")],
  ["false request",ucmCases[1]!.question.replace("time for one revolution","the stopping distance")],
  ["extra condition",ucmCases[1]!.question.replace("Find","If the radius doubles, find")],
  ["conflicting rate",ucmCases[1]!.question.replace("Find","Its period is 2 s. Find")],
  ["negative radius",ucmCases[1]!.question.replace("50 m","-50 m")],
  ["mass outside fallback scope",ucmCases[1]!.question.replace("car moves","car of mass 1000 kg moves")],
  ["stated position outside fallback scope",ucmCases[1]!.question.replace("Find","It is at Q=(30,40) m. Find")],
  ["symbolic native outside fallback scope","A particle moves uniformly in a circle of radius R with speed v. Find its centripetal acceleration."],
] as const) {
  const result=await buildUniformCircularSourceFallback(question);
  check(`fallback declines whole-source ${name}`,()=>assert.equal(result,null));
}
check("given speed one-ULP forgery stays exact",()=>{
  const s=readUniformCircularSource(ucmCases[1]!.question);assert.ok(s?.status==="numeric");
  const d=uniformCircularNumericDocument(ucmCases[1]!.question,s);d.quantities.find(q=>q.id==="v")!.value=20.000000000000004;rejects(d);
});
const relativeCases = [
 {name:"actual train",question:trains.question,a:20,b:15,gap:100,t:20,da:400,db:300,requestedDistance:400,travelSpeed:20,travelActor:"A"},
 {name:"smaller metric gap",question:"Two cars A and B move in the same direction at 12 m/s and 8 m/s respectively. A is initially 60 m behind B. Find the time for A to catch B and the distance travelled by B.",a:12,b:8,gap:60,t:15,da:180,db:120,requestedDistance:120,travelSpeed:8,travelActor:"B"},
 {name:"swapped pursuer",question:"Two trains A and B move in the same direction at 54 km/h and 90 km/h respectively. B is initially 0.2 km behind A. Find the time for B to catch A and the distance travelled by B.",a:25,b:15,gap:200,t:20,da:500,db:300,requestedDistance:500,travelSpeed:25,travelActor:"B"},
 {name:"decimal speeds",question:"Two cars A and B move in the same direction at 7.5 m/s and 5 m/s respectively. A is initially 25 m behind B. Find the time for A to catch B and the distance traveled by A.",a:7.5,b:5,gap:25,t:10,da:75,db:50,requestedDistance:75,travelSpeed:7.5,travelActor:"A"},
 {name:"signed west frame",question:"Use the ground frame with west positive. Point A starts at x=0 m and B at x=-150 m at t=0. A moves east at 12 m/s and B moves west at 18 m/s, constantly. Find the time for A to catch B and the distance travelled by A.",a:-12,b:18,gap:-150,t:5,da:60,db:90,requestedDistance:60,travelSpeed:12,travelActor:"A"},
];
const n=(value:number):ExpressionNodeIR=>({kind:"number",value});
const op=(operator:"-"|"/"|"*",left:ExpressionNodeIR,right:ExpressionNodeIR):ExpressionNodeIR=>({kind:"binary",operator,left,right});
for (const c of relativeCases) {
 const admission=relativeMotionSource(c.question);
 const fullIR:ProblemIR=cloneJSONB(trains.normalizedIR);
 // A separately authored full formulation retains source actors, all facts,
 // and both requests; expression trees are variable-free independent math.
 const setupEnd=c.question.indexOf("Find");
 fullIR.question=c.question;fullIR.id="independentMotion";
 fullIR.facts=[{id:"setup",kind:"given",statement:c.question.slice(0,setupEnd),evidence:{source:"question",start:0,end:setupEnd,quote:c.question.slice(0,setupEnd)}},
 {id:"request",kind:"requested",statement:c.question.slice(setupEnd),evidence:{source:"question",start:setupEnd,end:c.question.length,quote:c.question.slice(setupEnd)}}];
 fullIR.entities=[{id:"A",kind:"body",label:"A",evidenceFactIds:["setup"]},{id:"B",kind:"body",label:"B",evidenceFactIds:["setup"]}];
 fullIR.representationIntents=[{id:"motion",kind:"conceptual",entityIds:["A","B"],evidenceFactIds:["setup","request"]}];
 const gap=c.gap;
 const t=op("/",n(gap),op("-",n(c.a),n(c.b)));
 fullIR.expressions=[{id:"time",valueType:"scalar",root:t,evidenceFactIds:["setup","request"]},{id:"distance",valueType:"scalar",root:op("*",n(c.travelSpeed),t),evidenceFactIds:["setup","request"]}];
 fullIR.solveRequests=[{id:"solve_time",kind:"evaluate",expressionId:"time",resultBinding:{turnPlanQuantityId:"t",symbol:"t",unit:"s",evidenceFactIds:["request"]}},
 {id:"solve_distance",kind:"evaluate",expressionId:"distance",resultBinding:{turnPlanQuantityId:"d",symbol:`d_${c.travelActor}`,unit:"m",evidenceFactIds:["request"]}}];
 const solved=await new LocalDeterministicSolverProvider().solve(fullIR);
 check(`${c.name}: source actors and independent full IR solver`,()=>{
  assert.ok(admission?.status==="admitted");const s=admission.source;assert.deepEqual(s.requests.travelActors,[c.travelActor]);
  assert.equal(validateProblemIR(fullIR,c.question).valid,true);
  assert.equal(solved.status,"solved");close(solved.values[0]!.approximate as number,c.t);close(solved.values[1]!.approximate as number,c.requestedDistance);
  close(motionRationalNumber(s.subject.v),c.a);close(motionRationalNumber(s.reference.v),c.b);
  assert.ok(s.encounter.kind==="future");close(motionRationalNumber(s.encounter.time),c.t);
  const raw=relativeMotionDocument(c.question,s);
  const d=validateSceneDocument(pruneDeadSceneEntities(raw as unknown as Record<string,unknown>)).document;assert.ok(d);const compiled=compileSceneDocument(d);assert.ok(compiled.ok&&compiled.renderScene);
  assert.ok(compiled.renderScene.primitives.some(p=>p.kind==="label"&&p.text===s.subject.name));
  assert.ok(compiled.renderScene.primitives.some(p=>p.kind==="label"&&p.text===s.reference.name));
  assert.equal(compileSceneDocument(cloneJSONB(d)).ok,true);
  const plan:TurnPlanV3={schemaVersion:"turn-plan/v3",question:c.question,givens:[],unknowns:[],derived:[{id:"distance",symbol:`d_${s.subject.name}`,value:c.db,unit:"m",provenance:"derived"}],assumptions:[],qualitativeClaims:[],lawIds:[],visualRequirement:"required"};
  assert.equal(relativeMotionPlanConflicts(s,plan,c.question).length,1);
  const result=applyRelativeMotionAuthority(c.question,plan);assert.ok(result);close((result.plan as TurnPlanV3).derived[0]!.value,c.da);
  const forged=structuredClone(d);forged.quantities[0]!.value=999;rejects(forged);
  const wrongActor=structuredClone(d);wrongActor.entities.find(e=>e.label===s.subject.name)!.label="C";rejects(wrongActor);
 });
}
for (const [name,q] of [
 ["wrong catch actor",trains.question.replace("catch B","catch C")],
 ["wrong travel actor",trains.question.replace("by A","by C")],
 ["self catch",trains.question.replace("catch B","catch A")],
 ["unsupported extra request",trains.question.replace("by A.","by A and its force.")],
 ["unreadable unit",trains.question.replace("72 km/h","72 mph")],
 ["extra premise",trains.question.replace("catch B","catch B if B moves at 36 km/h instead")],
 ["delayed start",trains.question.replace("Find","A starts 5 s later. Find")],
 ["third body",trains.question.replace("Find","Train C moves at 36 km/h. Find")],
] as const) check(`relative declines ${name}`,()=>assert.notEqual(relativeMotionSource(q)?.status,"admitted"));
for (const [name,q,kind] of [
 ["slower pursuer",trains.question.replace("72 km/h","36 km/h"),"past_root"],
 ["equal speeds",trains.question.replace("72 km/h","54 km/h"),"never_parallel"],
] as const) check(`relative impossible honesty ${name}`,()=>{
 const a=relativeMotionSource(q);assert.ok(a?.status==="admitted");assert.equal(a.source.encounter.kind,kind);
 const d=validateSceneDocument(pruneDeadSceneEntities(relativeMotionDocument(q,a.source) as unknown as Record<string,unknown>)).document;assert.ok(d);
 const compiled=compileSceneDocument(d);assert.equal(compiled.ok,true,JSON.stringify(compiled.report.issues));
 assert.ok(!compiled.renderScene!.primitives.some(p=>p.kind==="label"&&/t=20 s/.test(p.text??"")));
});
check("actual captured full trains IR preserved with recorded solver defect",()=>{
 assert.equal(trains.normalizedIR.facts.length,7);assert.equal(trains.normalizedIR.entities.length,2);
 assert.equal(trains.rawIR.solveRequests.length,2);assert.equal(trains.normalizedIR.solveRequests.length,1);
 assert.equal(trains.offlineSolverReconstruction.status,"failed");
 assert.equal(trains.offlineSolverReconstruction.issues[0].message,"unsupported free variable v_rel");
 assert.equal(relativeMotionSource(trains.question)?.status,"admitted");
});
check("actual full IR actor alias helper binds both identities without dropping entities",()=>{
 const bindings=relativeMotionSourceEntityBindings(trains.question,trains.normalizedIR);
 assert.ok(bindings);assert.deepEqual([...bindings],[["trainA","A"],["trainB","B"]]);
 const forged=structuredClone(trains.normalizedIR);forged.entities[0].label="Train B";
 assert.equal(relativeMotionSourceEntityBindings(trains.question,forged),null);
 forged.entities[0].label="Train C";assert.equal(relativeMotionSourceEntityBindings(trains.question,forged),null);
 const extra=structuredClone(trains.normalizedIR);extra.entities.push({...extra.entities[0],id:"extra"});
 assert.equal(relativeMotionSourceEntityBindings(trains.question,extra),null);
});
check("actual full-IR family train source is selected without reducing obligations",()=>{
 const scene=synthesizeFamilyScene({question:trains.question,turnPlan:trains.actualPlan,problemIR:trains.normalizedIR});
 const a=relativeMotionSource(trains.question);assert.ok(a?.status==="admitted");
 const document=validateSceneDocument(pruneDeadSceneEntities(relativeMotionDocument(trains.question,a.source) as unknown as Record<string,unknown>)).document!;
 const diagnostic={conflicts:relativeMotionPlanConflicts(a.source,trains.actualPlan,trains.question),demandRejection:demandRejection(document,sceneDemand(trains.question,trains.normalizedIR)),obligationRejection:visualObligationRejection(deriveVisualObligations(trains.normalizedIR),document)};
 assert.ok(scene,JSON.stringify(diagnostic));
 assert.equal(scene.document.source.sourceModel,"relative_motion_1d");
 const texts=scene.renderScene.primitives.filter(p=>p.kind==="label").map(p=>p.text);
 assert.ok(texts.includes("A")&&texts.includes("B"));
});
check("actual stone full-IR source remains a canonical circle",()=>{
 const scene=synthesizeFamilyScene({question:stone.question,turnPlan:stone.actualPlan,problemIR:stone.savedIR});
 assert.ok(scene);assert.equal(scene.document.source.archetype,"uniform_circular_motion_source");
 assert.deepEqual(validateUniformCircularSourceInputs(cloneJSONB(scene.document),stone.question),[]);
});
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Wave2 motion: ${groups - failures.length}/${groups} groups passed (offline)`);
process.exitCode = failures.length ? 1 : 0;
