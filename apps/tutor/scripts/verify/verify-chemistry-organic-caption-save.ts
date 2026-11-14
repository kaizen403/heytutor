/** Chemical atom counts use board script throughout live/save/reopen. */
import assert from "node:assert/strict";
import { prepareSourceBoundChemistryStructure, synthesizeFamilyScene, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

const examples = [
  ["Benzene (C₆H₆): What is the hybridization of each carbon, and what type of orbitals form the delocalized ring?", "C_6H_6"],
  ["Draw the skeletal structure of butane.", "C_4H_10"],
  ["Draw the geometrical isomers of but-2-ene.", "C_4H_8"],
  ["Draw all structural isomers of C4H10.", "C_4H_10"],
] as const;

async function main(): Promise<void> {
  for (const [question, formula] of examples) {
    const turnPlan: TurnPlanV3 = {
      schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
      qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
    };
    const family = synthesizeFamilyScene({ question, turnPlan });
    assert.equal(family?.family, "chem_organic");
    assert(family);
    const selected = selectProductionScene({ question, turnPlan, problemIR: null, requiredRetryEnabled: true });
    assert.equal(selected.visualStatus, "validated", selected.reason);
    assert(family.document.annotations.some(annotation => annotation.text?.includes(formula)), "caption retains the complete computed molecular formula in board script");
    const attempted = selected.attemptedRepresentation;
    assert.equal(attempted?.family, "chem_organic");
    assert(attempted);
    const saved = await canonicalizeTurnSceneMetadata({
      question, sceneDocument: attempted.sceneDocument, visualStatus: "validated",
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: attempted.tier, nonMetric: attempted.nonMetric, diagramResultStatus: "ready", turnPlan },
      segments: [],
    } as unknown as SubmittedTurnSceneMetadata);
    assert(saved.ok, saved.ok ? "" : saved.error);
    const reopened = JSON.parse(JSON.stringify(attempted.sceneDocument));
    assert.equal(sceneSaveAdmissionFailure({ document: reopened, question, turnPlan, tier: attempted.tier }), null);
    if (question === "Draw the skeletal structure of butane.") {
      const certify = (rawDocument: SceneDocument) => prepareSourceBoundChemistryStructure({ originalQuestion: question, rawDocument }).status;
      assert.equal(certify(reopened), "verified");
      const legacy = structuredClone(reopened);
      legacy.annotations[0].text = "butane C4H10";
      assert.equal(certify(legacy), "verified", "legacy plain captions retain their complete graph proof");
      for (const text of ["butane C_4H_9", "butane C4H9", "butane C_4H_10; 6 J"]) {
        const forged = structuredClone(reopened);
        forged.annotations[0].text = text;
        assert.equal(certify(forged), "declined", "caption source counts and physical claims cannot be forged");
      }
    }
    for (const text of ["6 J", "300 K", "2 mol/L"]) {
      const tampered = structuredClone(reopened);
      tampered.annotations.push({ id: "unproved_measurement", kind: "callout", targetIds: [], text });
      assert.match(sceneSaveAdmissionFailure({ document: tampered, question, turnPlan, tier: attempted.tier }) ?? "", /displayed_quantity_unverified/, "unproved measurements remain rejected");
    }
  }
  console.log(`verify-chemistry-organic-caption-save: ${examples.length} live/save/reopen cases and 12 measured-value controls passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
