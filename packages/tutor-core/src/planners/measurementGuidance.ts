import { readScrewGaugeQuestion, SCREW_GAUGE_QUESTION_GUIDANCE, type ExpressionNodeIR } from "@heytutor/scene-engine";

export function measurementPlanningGuidance(question: string): string {
  const source = readScrewGaugeQuestion(question);
  if (source.status !== "ok") return "";
  const n = (value: number): ExpressionNodeIR => ({ kind: "number", value });
  const observed: ExpressionNodeIR = { kind: "binary", operator: "+", left: n(source.values.true_reading.value), right: n(source.values.zero_error.value) };
  const requested: ExpressionNodeIR = { kind: "binary", operator: "/", left: { kind: "binary", operator: "-", left: observed, right: n(source.values.main_scale_reading.value) }, right: n(source.values.least_count.value) };
  return `\n${SCREW_GAUGE_QUESTION_GUIDANCE}\nMEASUREMENT SOURCE DATA\n${JSON.stringify({values:source.values,evidence:source.evidence,observedAST:observed,requestedCountAST:requested})}\n
This complete source requests only a scalar circular-scale count, not a drawing: use visualRequirement=none, no qualitativeClaims and no assumptions. A verified instrument figure is unsupported for this profile. Do not append a diagram request or invent scale geometry. Use the signed zero error exactly as supplied: observed=true diameter+signed zero error, not subtraction of the signed error. Source data supplies the independently recomputed count; option answers are not evidence. Omit sign when unsure; a sign must otherwise be positive, negative or zero, never + or -. In ProblemIR use the complete typed number/binary AST, with a negative numeric value as a number node. Match the exact evidence and actual Plan identities specified above. Retain every returned field and obligation for independent whole-IR audit; this data never substitutes for the model's original returned graph.\n`;
}
