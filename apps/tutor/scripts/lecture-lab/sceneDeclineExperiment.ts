export type SceneDeclinePolicy = "unchanged" | "qualitative_setup_v1";

/** Evaluation-only guidance, never imported by the student teaching path. */
export function sceneDeclineExperimentGuidance(policy: SceneDeclinePolicy): string[] {
  return policy === "unchanged" ? [] : [
    "DECLINE POLICY EXPERIMENT: For a bare concept/topic lesson, absence of numeric measurements alone is not a reason for text_only. First try a faithful qualitative setup using only relationships entailed by the question/authoritative plan and the available operators. Dimensionless layout literals may arrange named objects but are never physical values. Preserve symbolic labels and clearly declare the nonmetric representation in visualDecision.reason. Do not invent measurements, physical signs, topology, conditions or assumptions. Do not substitute a simpler or unrelated figure. You must still decline when a necessary operator, source fact or complete faithful setup is unavailable. In text_only, state the specific missing operator/source obligation or safety reason in visualDecision.reason.",
  ];
}
