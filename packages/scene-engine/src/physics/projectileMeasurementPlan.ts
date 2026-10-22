import type { SceneDocument, SceneIssue } from "../types";
import { equivalentRoundedMeasuredQuantity, validateSceneQuantityAgreement, type TurnPlanV3 } from "../contracts/contractsV3";
import { evaluateChapterRemainderConstruction, validateProjectileMeasurementLabels } from "../compile/chapterRemainderGeometry";
import { validationNumber } from "../compile/sourceScalars";

/** Bind generated measurement symbols to plan scalars too. They are not in
 * document.quantities, so the ordinary quantity audit alone cannot see them. */
export function validateProjectileMeasurementPlan(document: SceneDocument, plan: TurnPlanV3): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const construction of document.constructions) {
    if (construction.operator !== "projectile_trajectory" || construction.inputs.showMeasurements !== true) continue;
    try {
      // Translation cannot affect a displacement or height. Do not resolve a
      // display origin merely to recompute these physical scalar magnitudes.
      const values = evaluateChapterRemainderConstruction(construction.operator, { ...construction.inputs, origin: undefined }, {
        number: value => validationNumber(value, document), point: () => { throw new Error("unexpected origin"); }, geometry: () => undefined,
      }, document);
      validateProjectileMeasurementLabels(construction, document, values);
      for (const value of values.slice(2)) {
        const computed = value.remainder;
        const quantities = [...plan.givens, ...plan.derived].filter(q => q.symbol.normalize("NFKC").trim() === computed.role);
        // Only derived answers may round; source givens retain the strict audit.
        const strictQuantities = quantities.filter(q => !plan.derived.includes(q) ||
          !equivalentRoundedMeasuredQuantity(computed.magnitude, computed.unit, q.value, q.unit));
        const agreement = validateSceneQuantityAgreement(strictQuantities.map(q => ({ id: q.id, value: computed.magnitude, unit: computed.unit })), plan);
        for (const issue of agreement) issues.push({ code: "projectile_measurement_plan_mismatch", severity: "fatal", failureKind: "truth",
          entityIds: construction.outputs.slice(2), message: `Computed ${computed.role} disagrees with its TurnPlan scalar: ${issue.message}` });
      }
    } catch {
      issues.push({ code: "projectile_measurement_unproven", severity: "fatal", failureKind: "truth",
        entityIds: construction.outputs, message: "The projectile measurements could not be recomputed for the authoritative plan." });
    }
  }
  return issues;
}
