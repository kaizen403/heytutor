import assert from "node:assert/strict";
import { ladderCases } from "./fixtures/w2-kinematics-ladder/core";
import { readStaticContactTriangle, staticContactTriangleDocument } from "../../src/ir/staticContactTriangle";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { applyStaticContactTriangleAuthority } from "../../src/ir/staticContactTriangleAuthority";
import type { ProblemIR } from "../../src/ir/problemIR";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
for (const c of ladderCases) {
  const read = readStaticContactTriangle(c.question);
  assert.ok(read,c.id);
  assert.equal(read.state.height,c.height);
  const source = staticContactTriangleDocument(c.question)!;
  assert.ok(source);
  const compiled=compileSceneDocument(source);
  assert.equal(compiled.ok,true,JSON.stringify(compiled.report.issues));
  const scene=synthesizeFamilyScene({question:c.question});
  assert.ok(scene,c.id);
  assert.equal(scene.document.quantities.find(row=>row.id==="length")?.value,c.length);
  const bad=structuredClone(source);bad.constructions.find(row=>row.outputs.includes("A"))!.inputs.x=10;
  delete bad.source.archetype;delete bad.source.slotSources;
  assert.equal(compileSceneDocument(bad).ok,false);
  for (const suffix of [" Another ladder is present."," The wall is tilted."," The foot is not on the floor."," If the wall moves, find the speed."]) {
    assert.equal(readStaticContactTriangle(c.question+suffix),null);
    assert.equal(synthesizeFamilyScene({question:c.question+suffix}),null);
  }
}
const c=ladderCases[0]!;
const request="Find the height reached.";
const facts:ProblemIR["facts"]=[{id:"setup",kind:"given",statement:c.question.slice(0,c.question.indexOf(request)).trim(),
 evidence:{source:"question",start:0,end:c.question.indexOf(request),quote:c.question.slice(0,c.question.indexOf(request)).trim()}},
 {id:"request",kind:"requested",statement:request,evidence:{source:"question",start:c.question.indexOf(request),end:c.question.length,quote:request}}];
const problem:ProblemIR={schemaVersion:"problem-ir/v1",id:"contact",question:c.question,facts,
 entities:[{id:"sourceLadder",kind:"body",label:"ladder",evidenceFactIds:["setup"]},
 {id:"sourceWall",kind:"line",label:"wall",evidenceFactIds:["setup"]},
 {id:"sourceFloor",kind:"line",label:"floor",evidenceFactIds:["setup"]}],
 expressions:[],constraints:[],solveRequests:[],representationIntents:[{id:"contact",kind:"conceptual",entityIds:["sourceLadder","sourceWall","sourceFloor"],evidenceFactIds:["setup"]}]};
assert.ok(staticContactTriangleDocument(c.question,undefined,problem));
assert.ok(synthesizeFamilyScene({question:c.question,problemIR:problem}));
const extra=structuredClone(problem);extra.entities.push({id:"second",kind:"body",label:"another ladder",evidenceFactIds:["setup"]});
assert.equal(staticContactTriangleDocument(c.question,undefined,extra),null);
const wrong=structuredClone(problem);wrong.facts[0]!.statement+=" The wall is tilted.";
assert.equal(staticContactTriangleDocument(c.question,undefined,wrong),null);
const unboundExpression=structuredClone(problem);
unboundExpression.expressions.push({id:"invented",valueType:"scalar",root:{kind:"number",value:12},evidenceFactIds:["setup"]});
assert.equal(staticContactTriangleDocument(c.question,undefined,unboundExpression),null);
const plan:TurnPlanV3={schemaVersion:"turn-plan/v3",question:c.question,givens:[],derived:[{id:"theta",symbol:"theta",value:60,unit:"degree",provenance:"derived"}],unknowns:[],qualitativeClaims:[],assumptions:[],lawIds:[],visualRequirement:"required"};
assert.equal(staticContactTriangleDocument(c.question,plan),null);
const fixed=applyStaticContactTriangleAuthority(c.question,plan)!;
assert.equal(fixed.plan.derived[0]!.value,Math.atan2(12,5)*180/Math.PI);
assert.ok(staticContactTriangleDocument(c.question,fixed.plan));
assert.equal(plan.derived[0]!.value,60);
console.log("W2 static contact: 4 whole-source geometries, full IR, mutation and stock-angle controls passed (offline)");
