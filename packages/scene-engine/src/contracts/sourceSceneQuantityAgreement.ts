import { snapshotMathSourceData } from "../compile/mathSourceData";
import { compileSceneDocument } from "../compile/compiler";
import { relativeMotionSource, motionRationalNumber } from "../physics/relativeMotionSource";
import { relativeMotionPlanConflicts, relativeMotionValues, relativeMotionBindings, motionSymbolKey, motionUnitFactor } from "../physics/motionPlanAgreement";
import { validateRelativeMotionSourceInputs } from "../synthesize/relativeMotionScene";
import { validateProblemIR } from "../ir/problemIR";
import type { SceneDocument } from "../types";
import type { TurnPlanV3 } from "./contractsV3";

/** Caller data, never a proof flag or a list of trusted scalar allowances. */
export interface SourceSceneQuantityContext {
  question: string;
  problemIR: unknown;
  document: SceneDocument;
}

/**
 * Constructed frame origins need not be Plan premises. Independently regenerate
 * the owning programme, bind the whole caller and compile its labels before
 * allowing its quantities to supplement the original, unchanged Plan values.
 * Other programmes retain the existing Plan-only agreement contract.
 */
export function provedSourceSceneQuantityValues(
  suppliedQuantities: Array<Record<string, unknown> & {id: string}>,
  suppliedPlan: TurnPlanV3,
  suppliedTexts: string[],
  suppliedContext: SourceSceneQuantityContext,
): Array<{value: number; unit?: string}> | null {
  let captured;
  try { captured = snapshotMathSourceData({quantities: suppliedQuantities, plan: suppliedPlan, displayedTexts: suppliedTexts, context: suppliedContext}); }
  catch { return null; }
  const {quantities, plan, displayedTexts, context} = captured;
  const source = relativeMotionSource(context.question);
  if (source?.status !== "admitted") return null;
  const original = validateProblemIR(context.problemIR, context.question);
  if (!original.valid || !original.problem || plan.question !== context.question) return null;
  const bindings = new Map(relativeMotionBindings(source.source));
  const initialGap = Math.abs(motionRationalNumber(source.source.reference.x0) - motionRationalNumber(source.source.subject.x0));
  for (const name of ["d0", "gap", "separation", "initialgap"]) bindings.set(name, {dimension:"length", si:initialGap});
  for (const body of [source.source.subject, source.source.reference, ...(source.source.observer ? [source.source.observer] : [])]) {
    const name = body.name.toLowerCase();
    for (const symbol of [`x${name}`, `x${name}0`, `x0${name}`]) bindings.set(symbol, {dimension:"length", si:motionRationalNumber(body.x0), signed:true});
  }
  for (const quantity of [...plan.givens, ...plan.derived]) {
    const role = bindings.get(motionSymbolKey(quantity.symbol));
    const unit = motionUnitFactor(quantity.unit);
    if (!role || !unit || role.dimension !== unit.dimension) return null;
    const value = quantity.value * unit.factor;
    const expected = !role.signed && unit.dimension === "velocity" && quantity.value > 0 ? Math.abs(role.si) : role.si;
    if (Math.abs(value - expected) > 1e-8 * Math.max(1, Math.abs(expected))) return null;
  }
  if (relativeMotionPlanConflicts(source.source, plan, context.question).length ||
      validateRelativeMotionSourceInputs(context.document, context.question).length) return null;
  if (JSON.stringify(quantities) !== JSON.stringify(context.document.quantities)) return null;
  const compiled = compileSceneDocument(context.document, {sourceAuthority: {
    question: context.question, problemIR: context.problemIR, turnPlan: plan,
  }});
  if (!compiled.ok || !compiled.report.valid || !compiled.renderScene?.primitives.length) return null;
  const labels = compiled.renderScene.primitives.flatMap(primitive =>
    (primitive.kind === "label" || primitive.kind === "dimension") && typeof primitive.text === "string"
      ? [primitive.text] : []);
  if (JSON.stringify(labels) !== JSON.stringify(displayedTexts)) return null;
  const values = relativeMotionValues(source.source);
  const units = {velocity: "m/s", length: "m", time: "s", angle: "degree"} as const;
  const computed: Array<{value:number;unit?:string}> = Object.entries(values).flatMap(([dimension, numbers]) =>
    (numbers ?? []).map(value => ({value, unit: units[dimension as keyof typeof units]})));
  return [...computed, ...context.document.quantities.flatMap(quantity =>
    typeof quantity.value === "number" && Number.isFinite(quantity.value)
      ? [{value: quantity.value, ...(typeof quantity.unit === "string" ? {unit: quantity.unit} : {})}] : [])];
}
