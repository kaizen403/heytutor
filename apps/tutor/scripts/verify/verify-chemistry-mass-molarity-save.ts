/** Offline execution of actual production selection and canonical save/reopen. */
import assert from "node:assert/strict";
import { type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

const questions = [
  "Find the molarity of a solution containing 5.85 g of NaCl in 500 mL of solution.",
  "Find the molarity of a solution containing 0.00585 kg of NaCl in 0.5 L of solution.",
  "A solution contains 7.4092 g of Ca(OH)2 in 100 cm^3 of solution. Find its molarity.",
];
async function main() {
  for (const question of questions) {
    const turnPlan: TurnPlanV3 = {schemaVersion:"turn-plan/v3",question,givens:[],unknowns:[],derived:[],qualitativeClaims:[],lawIds:[],assumptions:[],visualRequirement:"required"};
    const selection = selectProductionScene({question,turnPlan,problemIR:null,requiredRetryEnabled:true});
    assert.equal(selection.visualStatus,"validated",selection.reason);
    const attempted = selection.attemptedRepresentation!;
    assert.equal(attempted.sceneDocument.source.sourceModel,"formula_mass_molarity/v1");
    const saved = await canonicalizeTurnSceneMetadata({question,sceneDocument:attempted.sceneDocument,visualStatus:"validated",sceneArtifacts:{schemaVersion:"scene-artifacts/v3",representationTier:attempted.tier,nonMetric:attempted.nonMetric,diagramResultStatus:"ready",turnPlan},segments:[]} as unknown as SubmittedTurnSceneMetadata);
    assert(saved.ok,saved.ok?"":saved.error);
    assert.equal(saved.value.visualStatus,"validated");
    assert(saved.value.sceneDocument);
    const reopened = JSON.parse(JSON.stringify(saved.value.sceneDocument));
    assert.equal(sceneSaveAdmissionFailure({document:reopened,question,turnPlan,tier:attempted.tier}),null);
    const answer = reopened.quantities.find((item: {id:string})=>item.id === "molarity");
    const correctPlan: TurnPlanV3 = {...turnPlan,unknowns:[{id:"molarity",symbol:"c",unit:answer.unit}],
      derived:[{id:"molarity",symbol:"c",unit:answer.unit,value:answer.value,provenance:"derived",sourceText:"Deterministic source composition"}]};

    const correctSelection = selectProductionScene({question,turnPlan:correctPlan,problemIR:null,requiredRetryEnabled:true});
    assert.equal(correctSelection.visualStatus,"validated",correctSelection.reason);
    const correctAttempt = correctSelection.attemptedRepresentation!;
    const correctSaved = await canonicalizeTurnSceneMetadata({question,sceneDocument:correctAttempt.sceneDocument,visualStatus:"validated",sceneArtifacts:{schemaVersion:"scene-artifacts/v3",representationTier:correctAttempt.tier,nonMetric:correctAttempt.nonMetric,diagramResultStatus:"ready",turnPlan:correctPlan},segments:[]} as unknown as SubmittedTurnSceneMetadata);
    assert(correctSaved.ok,correctSaved.ok?"":correctSaved.error);
    const roundedPlan: TurnPlanV3 = {...correctPlan,derived:correctPlan.derived.map(quantity=>({...quantity,value:Number(quantity.value.toPrecision(3))}))};
    const roundedSelection = selectProductionScene({question,turnPlan:roundedPlan,problemIR:null,requiredRetryEnabled:true});
    assert.equal(roundedSelection.visualStatus,"validated","source-proved computed values retain the existing derived-plan rounding contract: "+roundedSelection.reason);
    const roundedAttempt = roundedSelection.attemptedRepresentation!;
    const roundedSaved = await canonicalizeTurnSceneMetadata({question,sceneDocument:roundedAttempt.sceneDocument,visualStatus:"validated",sceneArtifacts:{schemaVersion:"scene-artifacts/v3",representationTier:roundedAttempt.tier,nonMetric:roundedAttempt.nonMetric,diagramResultStatus:"ready",turnPlan:roundedPlan},segments:[]} as unknown as SubmittedTurnSceneMetadata);
    assert(roundedSaved.ok,roundedSaved.ok?"":roundedSaved.error);
    assert(reopened.source.answerLabelEntityIds.length > 0, "computed answer ink is deferred until teaching finishes");
    for (const text of ["2 mol/L", "300 K", "6 J"]) {
      const forged=structuredClone(reopened);
      forged.annotations.push({id:"forged",kind:"callout",targetIds:[],text});
      assert(sceneSaveAdmissionFailure({document:forged,question,turnPlan,tier:attempted.tier}));
    }
    const forgedRow = structuredClone(reopened);
    const entity = forgedRow.entities.find((entity: {id:string})=>entity.id === "row_4_1");
    entity.label = forgedRow.entities.find((item: {id:string})=>item.id === "row_2_1").label;
    forgedRow.constructions.find((item: {id:string})=>item.id === "make_row_4_1").inputs.text = entity.label;
    assert(sceneSaveAdmissionFailure({document:forgedRow,question,turnPlan,tier:attempted.tier}), "source-derived result label must stay bound to its role");
    for (const value of [2,42]) {
      const stale = {...turnPlan,unknowns:[{id:"molarity",symbol:"c",unit:"mol/L"}],derived:[{id:"molarity",symbol:"c",value,unit:"mol/L",sourceText:"stale answer",provenance:"derived" as const}]};
      assert(sceneSaveAdmissionFailure({document:reopened,question,turnPlan:stale,tier:attempted.tier}));
    }
  }
  console.log("mass-molarity: 9 production/save cases (empty, exact and rounded plans), 3 saved-document JSON reopens and 18 rejection controls passed");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
