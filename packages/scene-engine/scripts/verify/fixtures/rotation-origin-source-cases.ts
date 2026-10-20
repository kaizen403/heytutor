import assert from "node:assert/strict";
import { synthesizeUniformCircularScene, type SceneDocument, type TurnPlanV3 } from "../../../src/index";

export const circularBaseQuestion = "A particle moves anticlockwise in a circle of radius 2 m with angular speed 3 rad/s.";
export const unsupportedCircularRequests = [
  "Explain simple harmonic motion using this reference circle.",
  "Find the projection of its velocity on the x axis.",
  "Its shadow is projected onto a wall; show SHM.",
  "Use this circular motion in a school project.",
];

/** Synthetic planner documents intentionally omit source-program trust markers. */
export function circularPlannerCases(requests = unsupportedCircularRequests) {
  const plan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question: circularBaseQuestion,
    givens: [], unknowns: [], derived: [], qualitativeClaims: [],
    lawIds: ["uniform circular motion"], assumptions: [], visualRequirement: "required",
  };
  const generated = synthesizeUniformCircularScene(circularBaseQuestion, { turnPlan: plan });
  assert.ok(generated?.status === "drawn", "the supported numeric circular control must synthesize");
  const wrongRadius = synthesizeUniformCircularScene(circularBaseQuestion.replace("radius 2 m", "radius 5 m"), { turnPlan: plan });
  assert.ok(wrongRadius?.status === "drawn", "the wrong-radius candidate must be internally consistent");
  return requests.flatMap((request) => {
    const question = `${circularBaseQuestion}${request ? ` ${request}` : ""}`;
    return ["plain program", "reversed sense", "wrong radius"].map((variant) => {
      const document: SceneDocument = structuredClone(variant === "wrong radius" ? wrongRadius.scene.document : generated.scene.document);
      delete document.source.archetype;
      delete document.source.slotSources;
      document.source.question = question;
      if (variant === "reversed sense") {
        const motion = document.constructions.find((construction) => construction.operator === "rotational_motion")!;
        motion.inputs.angularVelocity = -Number(motion.inputs.angularVelocity);
      }
      // Keep the plan source-grounded even when the candidate is tampered.
      const quantities = generated.scene.document.quantities.map((quantity) => {
        assert.ok(typeof quantity.symbol === "string" && typeof quantity.value === "number");
        return { id: quantity.id, symbol: quantity.symbol, value: quantity.value,
          ...(typeof quantity.unit === "string" ? { unit: quantity.unit } : {}) };
      });
      const turnPlan: TurnPlanV3 = {
        ...plan, question,
        givens: quantities.filter((quantity) => ["r", "omega"].includes(quantity.id))
          .map((quantity) => ({ ...quantity, provenance: "given" })),
        derived: quantities.filter((quantity) => !["r", "omega"].includes(quantity.id))
          .map((quantity) => ({ ...quantity, provenance: "derived" })),
      };
      return { question, variant, document, turnPlan };
    });
  });
}
