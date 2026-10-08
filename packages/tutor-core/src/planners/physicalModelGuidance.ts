import { modelAdmissionCatalog } from "@heytutor/scene-engine";

/** Exact source contracts for the reusable EM physical-model lane. This is a
 * formulation catalog, not a topic router: the model must decline unless the
 * question itself proves every listed input role/unit and assumption. */
export function physicalModelPlanningGuidance(): string {
  const catalog = modelAdmissionCatalog().map((entry) => ({
    model: entry.name,
    result: entry.resultKind,
    inputs: Object.entries(entry.roles).map(([key, role]) => [key, role.role, role.unit, role.sourcePhrases ?? null]),
    optionalInputs: Object.entries(entry.optionalRoles).map(([key, role]) => [key, role.role, role.unit, role.sourcePhrases ?? null]),
    optionalGroups: entry.optionalGroups,
    sequences: entry.sequences.map((sequence) => ({
      indexStart: sequence.indexStart,
      minItems: sequence.minItems,
      maxItems: sequence.maxItems,
      fields: Object.entries(sequence.fields).map(([prefix, role]) => [prefix, role.role, role.unit, role.sourcePhrases ?? null]),
    })),
    assumptions: entry.assumptions,
  }));
  return `\nSOURCE-GROUNDED PHYSICAL MODELS
The following JSON is a closed admission catalog, not a classification hint: ${JSON.stringify(catalog)}
Use kind "explicit_physical_model" only when one catalog model is named by, or is an exact restatement of, the submitted source and every catalog input has its own given fact. Each binding must copy the catalog key, role and unit exactly; expressionId must name a number-only scalar expression citing that same given fact; evidenceFactId must name that fact. A normal numeric input requires the exact value and unit in its quoted fact. A categorical input carries a value-to-phrases map in the fourth input slot: use that numeric value only when its quoted fact contains one of the listed affirmative source phrases; never manufacture a literal flag. Quote every listed assumption as an assumption fact from an exact question substring. Never select a model from chapter/topic words alone, never fill a missing value or assumption, never convert a drawing scale into a physical value, and never emit more than one explicit physical-model request.
For result "scalar", include resultBinding for the exact requested catalog output, using the actual TurnPlan unknown id/symbol/unit and requested fact. If the source does not request an output the model proves, decline this lane. For result "representation", omit resultBinding; it proves only the source-bound representation and must not invent a numeric result. Include requested-fact evidenceFactIds in either case. Preserve every unrelated source obligation elsewhere in the ProblemIR.\n`;
}
