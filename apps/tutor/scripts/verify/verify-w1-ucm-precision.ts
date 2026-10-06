import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applySourceQuantityAuthority, compileSceneDocument, synthesizeFamilyScene, validateProblemIR, type TurnPlanV3 } from "@heytutor/scene-engine";
import { normalizeProblemIRModelOutput } from "../../../../packages/tutor-core/src/planners/problemPlannerV1";
import { liveSceneSaveFailure, sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { storedTurnSourceIssues } from "../../lib/scene/storedSceneSource";

const original = JSON.parse(readFileSync(new URL("./fixtures/w1-ucm-stone-problem-ir.json",import.meta.url),"utf8"));
let checks = 0;
const cases = [
  { question:original.question as string, r:0.8, v:0.8*Math.PI, omega:Math.PI, ac:0.8*Math.PI**2 },
  { question:"A particle moves with uniform speed in a circle of radius 2/3 m with frequency 0.7 Hz. Find its speed and centripetal acceleration.",r:2/3,omega:1.4*Math.PI,v:2/3*1.4*Math.PI,ac:2/3*(1.4*Math.PI)**2 },
  { question:"A car moves on a circular track of radius 50 m at a constant speed of 20 m/s. Find its centripetal acceleration.",r:50,v:20,omega:0.4,ac:8 },
];
for (const item of cases) {
  for (const sense of ["", "clockwise", "anticlockwise"]) {
    const question = sense ? item.question.replace("moves",`moves ${sense}`) : item.question;
    const plan: TurnPlanV3 = {
      schemaVersion:"turn-plan/v3",question,givens:[{id:"r",symbol:"r",value:item.r,unit:"m",provenance:"given"}],
      derived:[{id:"v",symbol:"v",value:item.v,unit:"m/s",provenance:"derived"},{id:"omega",symbol:"omega",value:item.omega,unit:"rad/s",provenance:"derived"},{id:"a_c",symbol:"a_c",value:item.ac,unit:"m/s^2",provenance:"derived"}],
      unknowns:[],lawIds:["uniform circular motion"],assumptions:[],qualitativeClaims:[],visualRequirement:"required",
    };
    const raw = !sense && question===original.question ? original : {
      schemaVersion:"problem-ir/v1",id:"precision",question,
      facts:[{id:"source",kind:"given",statement:question,evidence:{source:"question",start:0,end:question.length,quote:question}}],
      entities:[{id:"particle",kind:"body",label:"particle",evidenceFactIds:["source"]}],expressions:[],constraints:[],solveRequests:[],
      representationIntents:[{id:"figure",kind:"conceptual",entityIds:["particle"],evidenceFactIds:["source"]}],
    };
    const resultIR = validateProblemIR(normalizeProblemIRModelOutput(raw,question,plan),question);
    assert.ok(resultIR.valid && resultIR.problem);
    const corrected = applySourceQuantityAuthority(plan,resultIR.problem,question).plan;
    const scene = synthesizeFamilyScene({question,turnPlan:corrected,problemIR:resultIR.problem});
    assert.ok(scene);
    for (const [id,value] of [["r",item.r],["v",item.v],["omega",item.omega],["a_c",item.ac]] as const) {
      const actual = scene.document.quantities.find(q=>q.id===id)?.value;
      assert.ok(typeof actual === "number" && Math.abs(actual-value)<=1e-12*Math.max(1,Math.abs(value)),`${question}: ${id} must keep independently computed precision, actual${actual} expected${value}`);checks++;
    }
    assert.equal(compileSceneDocument(scene.document).ok,true);
    assert.equal(liveSceneSaveFailure({document:scene.document,question,turnPlan:corrected,tier:scene.tier}),null);
    assert.equal(sceneSaveAdmissionFailure({document:scene.document,question,turnPlan:corrected,tier:scene.tier}),null);
    assert.equal(storedTurnSourceIssues(scene.document,{question,sceneArtifacts:{turnPlan:corrected,representationTier:scene.tier}}).some(issue=>issue.severity==="fatal"),false);
    const wrong = structuredClone(scene.document);
    wrong.quantities.find(q=>q.id==="v")!.value=item.v+0.1;
    delete wrong.source.archetype;delete wrong.source.slotSources;
    assert.equal(compileSceneDocument(wrong).ok,false);
    assert.ok(liveSceneSaveFailure({document:wrong,question,turnPlan:corrected,tier:scene.tier}));checks+=6;
  }
}
console.log(`UCM numeric authority precision: ${checks} checks passed`);
