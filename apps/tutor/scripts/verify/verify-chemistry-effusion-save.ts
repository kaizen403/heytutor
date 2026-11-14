import assert from "node:assert/strict";
import { type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

const context="At the same temperature and pressure, gases A and B effuse through the same porous membrane. The molar mass of A is 4 g/mol. ";
const ask=" Calculate the molar mass of B.";
const questions=[
  context+"The effusion rate ratio r_A/r_B = 2."+ask,
  context+"The effusion rate ratio r_B/r_A = 2."+ask,
  context+"For equal gas volumes, the effusion time ratio t_A/t_B = 2."+ask,
  context+"A 1.5 L sample of A takes 290 s to effuse. A 1.5 dm^3 sample of B takes 1085 s to effuse."+ask,
];
async function main() {
  for (const question of questions) {
    const turnPlan: TurnPlanV3={schemaVersion:"turn-plan/v3",question,givens:[],unknowns:[],derived:[],qualitativeClaims:[],lawIds:[],assumptions:[],visualRequirement:"required"};
    const selection=selectProductionScene({question,turnPlan,problemIR:null,requiredRetryEnabled:true});
    assert.equal(selection.visualStatus,"validated",selection.reason);
    const attempted=selection.attemptedRepresentation!;
    assert.equal(attempted.family,"chem_effusion");
    assert.equal(attempted.tier,"qualitative_verified");
    const saved=await canonicalizeTurnSceneMetadata({question,sceneDocument:attempted.sceneDocument,visualStatus:"validated",sceneArtifacts:{schemaVersion:"scene-artifacts/v3",representationTier:attempted.tier,nonMetric:attempted.nonMetric,diagramResultStatus:"ready",turnPlan},segments:[]} as unknown as SubmittedTurnSceneMetadata);
    assert(saved.ok,saved.ok?"":saved.error);
    assert.equal(saved.value.visualStatus,"validated");
    assert(saved.value.sceneDocument);
    const reopened=JSON.parse(JSON.stringify(saved.value.sceneDocument));
    assert.equal(sceneSaveAdmissionFailure({document:reopened,question,turnPlan,tier:attempted.tier}),null);
    const swapped = structuredClone(reopened);
    const unknown = swapped.entities.find((item: {id:string})=>item.id === "comparison_2_1");
    unknown.label = swapped.entities.find((item: {id:string})=>item.id === "comparison_2_0").label;
    swapped.constructions.find((item: {id:string})=>item.id === "make_comparison_2_1").inputs.text = unknown.label;
    assert(sceneSaveAdmissionFailure({document:swapped,question,turnPlan,tier:attempted.tier}));
    const stripped = structuredClone(swapped);
    stripped.source = {question};
    assert(sceneSaveAdmissionFailure({document:stripped,question,turnPlan:null,tier:attempted.tier}));
    const answer = reopened.quantities.find((item: {id:string})=>item.id === "unknown_mass");
    const correctPlan: TurnPlanV3 = {...turnPlan,unknowns:[{id:"unknown_mass",symbol:"M_B",unit:answer.unit}],
      derived:[{id:"unknown_mass",symbol:"M_B",unit:answer.unit,value:answer.value,provenance:"derived",sourceText:"Deterministic source composition"}]};

    const correctSelection = selectProductionScene({question,turnPlan:correctPlan,problemIR:null,requiredRetryEnabled:true});
    assert.equal(correctSelection.visualStatus,"validated",correctSelection.reason);
    const correctAttempt = correctSelection.attemptedRepresentation!;
    const correctSaved = await canonicalizeTurnSceneMetadata({question,sceneDocument:correctAttempt.sceneDocument,visualStatus:"validated",sceneArtifacts:{schemaVersion:"scene-artifacts/v3",representationTier:correctAttempt.tier,nonMetric:correctAttempt.nonMetric,diagramResultStatus:"ready",turnPlan:correctPlan},segments:[]} as unknown as SubmittedTurnSceneMetadata);
    assert(correctSaved.ok,correctSaved.ok?"":correctSaved.error);
    const roundedPlan: TurnPlanV3 = {...correctPlan,derived:correctPlan.derived.map(quantity=>({...quantity,value:Number(quantity.value.toPrecision(3))}))};
    const roundedSelection = selectProductionScene({question,turnPlan:roundedPlan,problemIR:null,requiredRetryEnabled:true});
    assert.equal(roundedSelection.visualStatus,"validated",roundedSelection.reason);
    const roundedAttempt = roundedSelection.attemptedRepresentation!;
    const roundedSaved = await canonicalizeTurnSceneMetadata({question,sceneDocument:roundedAttempt.sceneDocument,visualStatus:"validated",sceneArtifacts:{schemaVersion:"scene-artifacts/v3",representationTier:roundedAttempt.tier,nonMetric:roundedAttempt.nonMetric,diagramResultStatus:"ready",turnPlan:roundedPlan},segments:[]} as unknown as SubmittedTurnSceneMetadata);
    assert(roundedSaved.ok,roundedSaved.ok?"":roundedSaved.error);
    assert(reopened.source.answerLabelEntityIds.length > 0, "computed answer ink is deferred until teaching finishes");
    for (const text of ["42 g/mol","300 K","6 J"]) {
      const forged=structuredClone(reopened);
      forged.annotations.push({id:"forged",kind:"callout",targetIds:[],text});
      assert(sceneSaveAdmissionFailure({document:forged,question,turnPlan,tier:attempted.tier}));
    }
    for (const [symbol,value] of [["M_B",42],["M_B",4],["M_A",16]] as const) {
      const stale={...turnPlan,unknowns:[{id:"unknown_mass",symbol:"M_B",unit:"g/mol"}],derived:[{id:"unknown_mass",symbol,value,unit:"g/mol",sourceText:"stale answer",provenance:"derived" as const}]};
      assert(sceneSaveAdmissionFailure({document:reopened,question,turnPlan:stale,tier:attempted.tier}));
    }
  }
  console.log("effusion: 12 production/save cases (empty, exact and rounded plans), 4 saved-document JSON reopens and 32 rejection controls passed");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
