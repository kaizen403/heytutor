import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { sceneDemand, demandRejection } from "../../src/synthesize/sceneDemand";
import { deriveVisualObligations, visualObligationRejection } from "../../src/synthesize/visualObligations";
import { buildVseprScene } from "../../src/chemistry/vsepr";

const question = "Using VSEPR theory, predict the shape and the approximate bond angles of SF4, ClF3 and XeF2.";
const demand = sceneDemand(question, null);
console.log("demand", JSON.stringify(demand));
const scene = synthesizeFamilyScene({ question, turnPlan: null, problemIR: null });
if (!scene) {
  console.log("synthesize null");
} else {
  const labels = scene.renderScene.primitives
    .filter((primitive) => primitive.kind === "label" || primitive.kind === "dimension")
    .map((primitive) => ("text" in primitive ? primitive.text : ""));
  console.log(JSON.stringify({
    family: scene.family,
    tier: scene.tier,
    reason: scene.reason,
    primitives: scene.renderScene.primitives.length,
    chem: scene.document.source.chemistryFamily,
    rejection: demandRejection(scene.document, demand),
    labels: labels.slice(0, 24),
    mode: scene.document.visualDecision.mode,
  }, null, 2));
}

const problem = {
  schemaVersion: "problem-ir/v1",
  id: "vsepr",
  question,
  facts: [{ id: "fSf4", kind: "given", statement: "SF4" }],
  entities: [
    { id: "sf4", kind: "body", label: "SF4", evidenceFactIds: ["fSf4"] },
    { id: "clf3", kind: "body", label: "ClF3", evidenceFactIds: ["fSf4"] },
    { id: "xef2", kind: "body", label: "XeF2", evidenceFactIds: ["fSf4"] },
  ],
  expressions: [],
  constraints: [],
  representationIntents: [{
    id: "shapes",
    kind: "conceptual",
    entityIds: ["sf4", "clf3", "xef2"],
    evidenceFactIds: ["fSf4"],
  }],
  solveRequests: [],
};
const withIr = synthesizeFamilyScene({ question, turnPlan: null, problemIR: problem as never });
console.log("with IR", withIr ? withIr.family : null);
const bare = buildVseprScene(question, [], false);
if (bare) {
  const set = deriveVisualObligations(problem as never);
  console.log("rejection", visualObligationRejection(set, bare));
}
