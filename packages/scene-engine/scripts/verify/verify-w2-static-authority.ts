import assert from "node:assert/strict";
import {applyStaticContactTriangleAuthority} from "../../src/ir/staticContactTriangleAuthority";
import {rightTriangleQuantityRole,resolveLadderSource} from "../../src/ir/rightTriangleSource";
import type {TurnPlanV3} from "../../src/contracts/contractsV3";

const stem="A ladder of length 13 m leans against a vertical wall. Its foot is 5 m from the wall on a horizontal floor. ";
const make=(question:string):TurnPlanV3=>({schemaVersion:"turn-plan/v3",question,givens:[],derived:[],unknowns:[],qualitativeClaims:[],assumptions:[],lawIds:[],visualRequirement:"required"});
let checks=0;
const question=stem+"Find the height reached.",collision=make(question);
collision.derived=[{id:"length",symbol:"height",value:99,unit:"m",provenance:"derived"},{id:"next",symbol:"z",value:5,unit:"m",provenance:"derived",dependsOn:["length"]},{id:"tail",symbol:"w",value:1,unit:"m",provenance:"derived",dependsOn:["next"]}];
collision.unknowns=[{id:"length",symbol:"height",unit:"m"}];
collision.qualitativeClaims=[{id:"linked",text:"height claim",relatedQuantityIds:["tail"]}];
const before=structuredClone(collision),result=applyStaticContactTriangleAuthority(question,collision)!;
assert.equal(rightTriangleQuantityRole(collision.derived[0]!),"ambiguous");assert.ok(result.declineFigure);assert.deepEqual(result.plan.derived,[]);assert.deepEqual(result.plan.unknowns,[]);assert.deepEqual(result.plan.qualitativeClaims,[]);assert.deepEqual(new Set(result.withdrawn),new Set(["length","next","tail"]));assert.deepEqual(collision,before);checks++;
for (const symbol of ["cosTheta","cos_theta","cos(θ)","\\cos{\\theta}"]) {
 const q=stem+"Find the cosine of the angle with the floor.",plan=make(q);
 plan.derived=[{id:"cosTheta",symbol,value:.2,unit:"1",provenance:"derived"}];
 const corrected=applyStaticContactTriangleAuthority(q,plan)!;
 assert.equal(corrected.plan.derived[0]!.value,5/13);assert.equal(corrected.corrections.length,1);assert.equal(corrected.declineFigure,false);assert.ok(resolveLadderSource(q,corrected.plan.derived).ok);checks++;
}
for (const [symbol,unit,value,expected] of [["height","cm",999,1200],["theta","rad",60,Math.atan2(12,5)],["height","m",12,12],["cosTheta","1",5/13,5/13]] as const) {
 const q=stem+(symbol==="theta"?"Find the angle with the floor.":symbol==="cosTheta"?"Find the cosine of the angle with the floor.":"Find the height reached."),plan=make(q);
 plan.derived=[{id:symbol,symbol,value,unit,provenance:"derived"}];const corrected=applyStaticContactTriangleAuthority(q,plan)!;
 assert.ok(Math.abs(corrected.plan.derived[0]!.value-expected)<1e-12);assert.equal(corrected.declineFigure,false);checks++;
}
for (const row of [{id:"cosTheta",symbol:"cosTheta",value:.2,unit:"m"},{id:"theta",symbol:"height",value:12,unit:"m"}]) {
 const plan=make(question);plan.derived=[{...row,provenance:"derived"}];assert.deepEqual(applyStaticContactTriangleAuthority(question,plan)!.plan.derived,[]);checks++;
}
console.log(`PASS ${checks} static scalar source-role corrections/withdrawals; student acceptance pending`);
