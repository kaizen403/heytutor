import {
  opticalConjugateDocument,
  opticalConjugatePlanConflicts,
  opticalConjugateQuantityRole,
  opticalLengthInCm,
  readOpticalConjugateSource,
  readStaticContactTriangle,
  staticContactTriangleDocument,
  validateTurnPlanV3,
  type SceneDocument,
  type SceneIssue,
} from "@heytutor/scene-engine";

const fatal = (code: string, path: string, message: string): SceneIssue =>
  ({ code, severity: "fatal", path, message });

/**
 * Join a supplied plan to the bounded engine source programs again at every
 * trust boundary. The caller separately proves the submitted raw document;
 * candidate metadata, normalized geometry and cached solver audits provide
 * no authority here. Regeneration retains the complete caller IR, including
 * contact request identities, formula evidence and binding units.
 *
 * Legacy turns without a plan and unsupported source profiles keep their
 * existing guards. This helper performs no solving, I/O or asynchronous work.
 */
export function sourceBoundPlanIssues(
  _document: SceneDocument,
  question: string,
  rawPlan: unknown,
  rawProblemIR: unknown,
): SceneIssue[] {
  const contact = readStaticContactTriangle(question);
  const optics = readOpticalConjugateSource(question);
  if ((!contact && !optics) || rawPlan == null) return [];

  const checked = validateTurnPlanV3(rawPlan, question);
  if (!checked.valid || !checked.plan) {
    return checked.issues.map(issue => fatal(
      "source_plan_invalid", `sceneArtifacts.turnPlan.${issue.path}`, issue.message,
    ));
  }
  const plan = checked.plan;
  if (contact) {
    return staticContactTriangleDocument(question, plan, rawProblemIR) ? [] : [fatal(
      "contact_source_plan", "sceneArtifacts.turnPlan",
      "The plan must bind the complete static contact source IR, requested roles and units",
    )];
  }
  if (!optics) return [];

  const issues: SceneIssue[] = [];
  const numericRows = [...plan.givens, ...plan.derived];
  const conflicts = new Set(opticalConjugatePlanConflicts(optics, numericRows));
  for (const row of numericRows) {
    if (conflicts.has(row.id)) {
      issues.push(fatal("optical_source_plan_quantity", `sceneArtifacts.turnPlan.${row.id}`,
        "Optical plan quantities must bind a known source conjugate role and value"));
    }
  }
  for (const row of plan.unknowns) {
    const role = opticalConjugateQuantityRole(row);
    // Preserve the pinned T1 checks. The engine factory owns admission of
    // unrecognized rows/unknown roles (T2); its null result below is fatal.
    const badUnit = role !== null && row.unit !== undefined && (role === "magnification"
      ? row.unit !== "1" : opticalLengthInCm(1, row.unit) === null);
    if (role === "ambiguous" || badUnit) {
      issues.push(fatal("optical_source_plan_unknown", `sceneArtifacts.turnPlan.unknowns.${row.id}`,
        "Optical unknown identities and units must bind source conjugate roles"));
    }
  }
  if (!opticalConjugateDocument(question, plan, rawProblemIR)) {
    issues.push(fatal("optical_source_plan", "sceneArtifacts.turnPlan",
      "The optical plan must regenerate against the actual question and complete caller IR"));
  }
  return issues;
}
