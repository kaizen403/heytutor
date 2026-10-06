import {
  opticalConjugateDocument,
  circleSourceDocument,readCircleSourceProgram,applyCircleSourceAuthority,
  sectionFormulaScene,readSectionFormulaSource,sectionFormulaPlanIssues,validateProblemIR,
  opticalConjugatePlanConflicts,
  opticalConjugateQuantityRole,
  opticalLengthInCm,
  readOpticalConjugateSource,
  readStaticContactTriangle,
  staticContactTriangleDocument,
  validateTurnPlanV3,
  readUniformCircularRuntimeContract,
  uniformCircularRuntimePlanConflicts,
  stalePlanQuantities,
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
  const circle = readCircleSourceProgram(question).status === "ok";
  const section = readSectionFormulaSource(question);
  const circular = readUniformCircularRuntimeContract(question);
  if (circular?.status === "declined" || circular?.status === "bound" && rawPlan == null) {
    return [fatal("ucm_source_plan", "sceneArtifacts.turnPlan", "Circular runtime admission requires the complete supported source and actual plan")];
  }
  if (circular?.status === "bound") {
    const checked = validateTurnPlanV3(rawPlan, question);
    if (!checked.valid || !checked.plan) return [fatal("ucm_source_plan_invalid", "sceneArtifacts.turnPlan", "Circular runtime admission requires a valid actual source plan")];
    const conflicts = [...uniformCircularRuntimePlanConflicts(question, checked.plan), ...stalePlanQuantities(circular.contract.source, checked.plan)];
    return conflicts.length ? [fatal("ucm_source_plan", "sceneArtifacts.turnPlan", "Every circular plan row and requested role must bind fresh source values and units")] : [];
  }
  if ((!contact && !optics && !circle && section.status!=="ok") || rawPlan == null) return [];

  const checked = validateTurnPlanV3(rawPlan, question);
  if (!checked.valid || !checked.plan) {
    return checked.issues.map(issue => fatal(
      "source_plan_invalid", `sceneArtifacts.turnPlan.${issue.path}`, issue.message,
    ));
  }
  const plan = checked.plan;
  if(section.status==="ok"){
    const scene=sectionFormulaScene(question,rawProblemIR as Parameters<typeof sectionFormulaScene>[1]);
    const problem=rawProblemIR==null?null:validateProblemIR(rawProblemIR,question).problem;
    if(!scene || rawProblemIR!=null && !problem) return [fatal("section_source_plan","sceneArtifacts.turnPlan","Section plan admission requires the complete independently bound source IR")];
    const planIssues=sectionFormulaPlanIssues(question,plan,rawProblemIR);
    if(planIssues.length) return planIssues;
    return [];
  }
  if(circle){
    const authority=applyCircleSourceAuthority(question,plan,rawProblemIR ?? undefined);
    return authority && authority.issues.length===0 && circleSourceDocument(question,rawProblemIR ?? undefined)?[]:[fatal("circle_source_plan","sceneArtifacts.turnPlan","All circle numeric rows and unknowns must bind fresh source roles, units and values, with or without caller IR")];
  }
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
