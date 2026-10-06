import { compileSceneDocument } from "../compile/compiler";
import { validateSceneDocument } from "../document/validation";
import { planNamesCircularMotion, readUniformCircularSource, stalePlanQuantities } from "../physics/uniformCircularSource";
import { uniformCircularNumericDocument, uniformCircularSymbolicDocument } from "../physics/uniformCircularScene";
import type { SynthesizedFamilyScene } from "./familyScene";

export type UniformCircularSynthesis =
  | { status: "drawn"; scene: SynthesizedFamilyScene }
  | { status: "declined"; reason: string; legacyOnly?: false }
  /**
   * The plan does not name circular motion, so this family may not draw; but
   * the source binds a uniform circular state (radius plus rate) or a
   * degenerate radius, for which every legacy figure is a static circle, a
   * stock tangent with an invented F_c, or r = 0 drawn as a real circle. The
   * family path draws nothing; a planner scene keeps its own rules.
   */
  | { status: "declined"; reason: string; legacyOnly: true };

export interface UniformCircularPlanContext {
  turnPlan?: unknown;
  problemIR?: unknown;
}

/**
 * The uniform circular motion family. The turn plan or ProblemIR decides the
 * topic: it must name a circular-motion law or quantity, otherwise this
 * returns null and other families answer. The source is then read for its
 * radius and rate. A source the reader rejects, a plan value that disagrees
 * with the recomputed state, or a figure that fails validation or
 * compilation declines atomically: the caller teaches without a figure, so a
 * stale planner number is never paired with this geometry.
 */
export function synthesizeUniformCircularScene(question: string, plan: UniformCircularPlanContext = {}): UniformCircularSynthesis | null {
  if (!planNamesCircularMotion(plan.turnPlan, plan.problemIR)) {
    const keyword = readUniformCircularSource(question);
    if (keyword?.status === "numeric" || (keyword?.status === "reject" && keyword.code === "nonpositive_radius")) {
      return { status: "declined", legacyOnly: true, reason: `legacy_circular_figure_declined: the source binds ${keyword.status === "numeric" ? "a radius and a rate" : "a degenerate radius"} but no plan or ProblemIR names circular motion` };
    }
    return null;
  }
  const source = readUniformCircularSource(question, { planNamesCircularMotion: true });
  if (!source) return null;
  if (source.status === "reject") return { status: "declined", reason: `${source.code}: ${source.reason}` };
  if (source.status === "numeric") {
    const stale = stalePlanQuantities(source, plan.turnPlan);
    if (stale.length) {
      return { status: "declined", reason: `stale_plan_quantity: ${stale.map((entry) => `${entry.symbol || entry.id} plan ${entry.planValue} vs source ${Number(entry.sourceValue.toPrecision(6))} (SI)`).join("; ")}` };
    }
  }
  let document;
  try {
    document = source.status === "numeric"
      ? uniformCircularNumericDocument(question, source)
      : uniformCircularSymbolicDocument(question, source);
  } catch (error) {
    return { status: "declined", reason: error instanceof Error ? error.message : "uniform circular state could not be built" };
  }
  const validated = validateSceneDocument(document as unknown as Record<string, unknown>);
  if (!validated.document) return { status: "declined", reason: validated.report.issues.map((issue) => issue.code).join(", ") };
  const compiled = compileSceneDocument(validated.document);
  if (!compiled.ok || !compiled.renderScene || compiled.renderScene.primitives.length === 0 || compiled.report.issues.some((issue) => issue.severity === "fatal")) {
    return { status: "declined", reason: compiled.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code).join(", ") || "compile failed" };
  }
  return {
    status: "drawn",
    scene: {
      document: validated.document,
      renderScene: compiled.renderScene,
      validationReport: compiled.report,
      tier: "qualitative_verified",
      nonMetric: true,
      reason: source.status === "numeric"
        ? "uniform circular motion state recomputed from the source radius and rate; the drawn radius is a display length"
        : "qualitative uniform circular motion with the source's symbols; no numeric state is assumed",
      family: "vector_diagram",
    },
  };
}
