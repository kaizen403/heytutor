import { readScrewGaugeQuestion, measurementPlanSourceIssueCodes } from "./measurementSourceAuthority";
import type { TurnPlanV3 } from "../contracts/contractsV3";

/** Question arithmetic cannot erase obligations before the full-IR audit. */
export function applyMeasurementQuestionAuthority(question: string, plan: TurnPlanV3) {
  const read = readScrewGaugeQuestion(question);
  if (read.status === "none") return null;
  const issueCodes = measurementPlanSourceIssueCodes(question, plan);
  if (issueCodes.length || read.status !== "ok") {
    return { plan, corrections: [], issueCodes, declineFigure: true };
  }
  const row = plan.derived[0]!;
  const expected = read.values.circular_reading.value;
  const corrections = row.value === expected ? [] : [{
    quantityId: row.id, symbol: row.symbol, previous: row.value, corrected: expected, unit: row.unit,
  }];
  // All original claims, unknowns, source clauses and dependencies are proved
  // and retained. Only the fully joined scalar can change.
  return {
    plan: { ...plan, derived: [{ ...row, value: expected,
      ...(row.sign === undefined ? {} : { sign: expected > 0 ? "positive" as const : "zero" as const }) }] },
    corrections, issueCodes: corrections.length ? ["measurement_question_values_corrected"] : [], declineFigure: false,
  };
}
