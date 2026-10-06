import { snapshotMathSourceData } from "../compile/mathSourceData";
import { compileSceneDocument } from "../compile/compiler";
import { relativeMotionSource } from "../physics/relativeMotionSource";
import { relativeMotionValues } from "../physics/motionPlanAgreement";
import { validateRelativeMotionSourceInputs } from "../synthesize/relativeMotionScene";
import { relativeMotionCallerIssues } from "../physics/relativeMotionCallerAuthority";
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
export function provedSourceSceneQuantityValues(suppliedQuantities: Array<Record<string, unknown> & {
  id: string;
}>, suppliedPlan: TurnPlanV3, suppliedTexts: string[], suppliedContext: SourceSceneQuantityContext): Array<{
  value: number;
  unit?: string;
}> | null {
  try {
    const captured = snapshotMathSourceData({ quantities: suppliedQuantities, plan: suppliedPlan, displayedTexts: suppliedTexts, context: suppliedContext });
    const { quantities, plan, displayedTexts, context } = captured;
    if (!context || typeof context.question !== "string" || !context.document ||
      typeof context.document !== "object" || !Array.isArray(context.document.quantities) ||
      relativeMotionCallerIssues(context.question, context.problemIR, plan).length)
      return null;
    const source = relativeMotionSource(context.question);
    if (source?.status !== "admitted")
      return null;
    if (plan.question !== context.question ||
      validateRelativeMotionSourceInputs(context.document, context.question).length)
      return null;
    if (JSON.stringify(quantities) !== JSON.stringify(context.document.quantities))
      return null;
    const compiled = compileSceneDocument(context.document, { sourceAuthority: {
        question: context.question, problemIR: context.problemIR, turnPlan: plan,
      } });
    if (!compiled.ok || !compiled.report.valid || !compiled.renderScene?.primitives.length)
      return null;
    const labels = compiled.renderScene.primitives.flatMap(primitive => (primitive.kind === "label" || primitive.kind === "dimension") && typeof primitive.text === "string"
      ? [primitive.text] : []);
    if (JSON.stringify(labels) !== JSON.stringify(displayedTexts))
      return null;
    const values = relativeMotionValues(source.source);
    const units = { velocity: "m/s", length: "m", time: "s", angle: "degree" } as const;
    const computed: Array<{
      value: number;
      unit?: string;
    }> = Object.entries(values).flatMap(([dimension, numbers]) => (numbers ?? []).map(value => ({ value, unit: units[dimension as keyof typeof units] })));
    return [...computed, ...context.document.quantities.flatMap(quantity => typeof quantity.value === "number" && Number.isFinite(quantity.value)
        ? [{ value: quantity.value, ...(typeof quantity.unit === "string" ? { unit: quantity.unit } : {}) }] : [])];
  }
  catch {
    return null;
  }
}
