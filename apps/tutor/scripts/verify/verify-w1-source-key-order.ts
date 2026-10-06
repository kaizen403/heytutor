import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileSceneDocument, synthesizeFamilyScene, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { sameSceneValue } from "../../../../packages/scene-engine/src/document/valueEquality";
import { liveSceneSaveFailure, sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { storedTurnSourceIssues } from "../../lib/scene/storedSceneSource";

const car = JSON.parse(readFileSync(new URL("./fixtures/w1-ucm-car-jsonb.json",import.meta.url),"utf8")) as {question:string;sceneDocument:SceneDocument;turnPlan:TurnPlanV3};
const trainQuestion = "Two trains A and B move in the same direction with speeds 72 km/h and 54 km/h respectively. Train A is 100 m behind B. Find how long A takes to catch up with B.";
const trainPlan: TurnPlanV3 = {schemaVersion:"turn-plan/v3",question:trainQuestion,givens:[{id:"v_A",symbol:"v_A",value:72,unit:"km/h",provenance:"given"},{id:"v_B",symbol:"v_B",value:54,unit:"km/h",provenance:"given"}],derived:[{id:"t",symbol:"t",value:20,unit:"s",provenance:"derived"}],unknowns:[],lawIds:["relative velocity"],assumptions:[],qualitativeClaims:[],visualRequirement:"required"};
const train = synthesizeFamilyScene({question:trainQuestion,turnPlan:trainPlan});assert.ok(train);
const reverseObjects = (value:unknown):unknown => {
  if (Array.isArray(value)) return value.map(reverseObjects);
  if (typeof value!=="object" || value===null) return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key,child])=>[key,reverseObjects(child)]));
};
let checks = 0;
for (const [question,document,turnPlan] of [[car.question,car.sceneDocument,car.turnPlan],[trainQuestion,train.document,trainPlan]] as const) {
  for (const candidate of [document,reverseObjects(document) as SceneDocument]) {
    assert.equal(compileSceneDocument(candidate).ok,true,"JSONB object ordering must not change source validity");
    assert.equal(liveSceneSaveFailure({document:candidate,question,turnPlan,tier:"qualitative_verified"}),null);
    assert.equal(sceneSaveAdmissionFailure({document:candidate,question,turnPlan,tier:"qualitative_verified"}),null);
    assert.equal(storedTurnSourceIssues(candidate,{question,sceneArtifacts:{turnPlan,representationTier:"qualitative_verified"}}).some(issue=>issue.severity==="fatal"),false);checks+=4;
  }
  for (const mutate of [
    (value:SceneDocument)=>{value.quantities[0]!.value=999;},
    (value:SceneDocument)=>{value.constructions.reverse();},
    (value:SceneDocument)=>{value.assertions.reverse();},
    (value:SceneDocument)=>{const labelled=value.entities.find(entity=>entity.label);if(labelled)labelled.label="forged";},
  ]) {
    const forged=reverseObjects(document) as SceneDocument;mutate(forged);
    delete forged.source.archetype;delete forged.source.sourceModel;delete forged.source.slotSources;
    assert.equal(compileSceneDocument(forged).ok,false);
    assert.ok(liveSceneSaveFailure({document:forged,question,turnPlan,tier:"qualitative_verified"}));checks+=2;
  }
}
assert.equal(sameSceneValue({a:1,b:{x:2,y:[3,4]}},{b:{y:[3,4],x:2},a:1}),true);
assert.equal(sameSceneValue([3,4],[4,3]),false);
assert.equal(sameSceneValue({a:1},{a:"1"}),false);
assert.equal(sameSceneValue({a:null},{}),false);checks+=4;
console.log(`source JSON key ordering: ${checks} checks passed`);
