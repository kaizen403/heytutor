import assert from "node:assert/strict";
import { compileSceneDocument, readUniformCircularSource, synthesizeFamilyScene, synthesizeUniformCircularScene, validateProblemIR } from "../../src/index";

let checks = 0;
const cases = ["P=(1.5,-2)", "Q=(1.5,-2)", "A(1.5,-2)", "(1.5,-2)"];
for (const sense of ["anticlockwise", "clockwise", ""] as const) {
  for (const location of cases) {
    const question = `A particle moves ${sense} with uniform speed in a circle of radius 2.5 m about the origin with angular speed 2 rad/s. It is at ${location} m. Find its velocity.`;
    const end = question.indexOf("Find");
    const name = location.startsWith("(") ? "P" : location.split(/[=(]/)[0]!;
    const problemIR = {
      schemaVersion: "problem-ir/v1", id: "sourceIdentity", question,
      facts: [{ id:"setup",kind:"given",statement:question.slice(0,end),evidence:{source:"question",start:0,end,quote:question.slice(0,end)} },{id:"request",kind:"requested",statement:question.slice(end),evidence:{source:"question",start:end,end:question.length,quote:question.slice(end)}}],
      entities:[{id:name,kind:"point",label:name,evidenceFactIds:["setup"]}],
      expressions:[],constraints:[],solveRequests:[],representationIntents:[{id:"figure",kind:"conceptual",entityIds:[name],evidenceFactIds:["setup"]}],
    };
    assert.equal(validateProblemIR(problemIR,question).valid,true);
    const turnPlan={schemaVersion:"turn-plan/v3",question,givens:[],unknowns:[],derived:[],lawIds:["uniform circular motion"],assumptions:[],qualitativeClaims:[],visualRequirement:"required"};
    const source=readUniformCircularSource(question);
    assert.equal(source?.status,"numeric");
    if(source?.status!=="numeric") throw new Error("supported source declined");
    assert.equal(source.positionName ?? "P",name);
    // Independent physical oracle: radius 2.5, omega2, speed5, acceleration10.
    assert.equal(source.radius,2.5); assert.equal(source.speed,5); assert.equal(source.centripetalAcceleration,10);
    const scene=synthesizeFamilyScene({question,turnPlan,problemIR});
    assert.ok(scene,JSON.stringify({sense,location,result:synthesizeUniformCircularScene(question,{turnPlan,problemIR})}));
    const body=scene.document.entities.find(entity=>entity.role==="body in uniform circular motion");
    assert.equal(body?.label,name);
    assert.ok(scene.renderScene.primitives.some(primitive=>primitive.entityId===body!.id && primitive.text===name));
    const forged=structuredClone(scene.document);
    forged.entities.find(entity=>entity.id===body!.id)!.label=name==="P"?"Q":"P";
    delete forged.source.archetype; delete forged.source.slotSources;
    const result=compileSceneDocument(forged);
    assert.equal(result.ok,false); assert.equal(result.renderScene,null);
    assert.ok(result.report.issues.some(issue=>issue.code==="ucm_source_mismatch"), JSON.stringify({sense,location,issues:result.report.issues})); checks+=12;
  }
  for (const name of ["A1", "q"]) {
    const question=`A particle moves ${sense} with uniform speed in a circle of radius 2.5 m about the origin with angular speed 2 rad/s. It is at ${name}=(1.5,-2) m. Find its velocity.`;
    const source=readUniformCircularSource(question);
    assert.equal(source?.status,"reject");
    assert.ok(source?.status==="reject" && source.code==="unsupported_position_name");
    assert.equal(synthesizeFamilyScene({question,turnPlan:{lawIds:["uniform circular motion"]}}),null); checks+=3;
  }
}
console.log(`UCM source identity: ${checks} checks passed`);
