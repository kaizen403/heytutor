import { checkVisualObligations, visualObligationRejection, type VisualObligationSet } from "../../synthesize/visualObligations";
import type { SceneDocument } from "../../types";
import { auditChemistryRepresentation } from "./audit";
import { chemistrySpeciesIdentity, sameOrganicGraph } from "./species";

const GENERIC = /^(?:the\s+)?(?:complex(?:\s+ion)?|solution|molecules?|compounds?|species|reaction|process|system|salt|mixture|sample|substance|products?|reactants?)$/i;
const CHEMISTRY_FAMILIES = new Set(["chem_organic", "chem_vsepr", "chem_lewis", "chem_mo", "chem_orbital", "chem_cft", "chem_coordination", "chem_electrochem", "chem_unit_cell", "chem_kinetics", "chem_thermo", "chem_solutions", "chem_periodic"]);

export interface ChemistryVisualObligationResult {
  rejection: string | null;
  ignoredIds: string[];
  missingSpecies: Array<{ obligationId: string; label: string }>;
}

/** Chemistry-only wrapper. The ordinary nonchem checker is called unchanged. */
export function chemistryVisualObligationCheck(set: VisualObligationSet, document: SceneDocument): ChemistryVisualObligationResult {
  if (!CHEMISTRY_FAMILIES.has(String(document.source.chemistryFamily))) {
    return { rejection: visualObligationRejection(set, document), ignoredIds: [], missingSpecies: [] };
  }
  const ignoredIds: string[] = [];
  const missingSpecies: ChemistryVisualObligationResult["missingSpecies"] = [];
  const question = typeof document.source.question === "string" ? document.source.question : "";
  const audit = auditChemistryRepresentation(document, question);
  for (const obligation of set.obligations) {
    if (obligation.kind !== "named_body") continue;
    const label = obligation.problemLabel?.trim() ?? "";
    if (GENERIC.test(label)) {
      ignoredIds.push(obligation.id); continue;
    }
    const name = label
      .replace(/^(?:the|a|an)\s+/i, "")
      .replace(/^(?:complex(?:\s+ion)?|molecule|compound|species)\s+/i, "")
      .replace(/\s+(?:molecules?|compounds?|species)$/i, "")
      .trim();
    const identity = chemistrySpeciesIdentity(name);
    const matched = identity !== null && [...audit.species.values()].some((species) =>
      identity.key === species.identityKey || (identity.kind === "formula" && identity.key === `formula:${species.formulaKey}`) ||
      (identity.molecule !== undefined && species.molecule !== undefined && sameOrganicGraph(identity.molecule, species.molecule)));
    // Unknown names and ambiguous formulas are retained as failures. A missing
    // species is never classified by inspecting what the candidate happened to draw.
    if (!matched) missingSpecies.push({ obligationId: obligation.id, label: label || obligation.problemEntityId });
  }
  // Named species were checked above. Only generic named_body ids are ignored;
  // associated dimensions, connections and spatial proofs remain native duties.
  const retained = set.obligations.filter((obligation) => obligation.kind !== "named_body");
  const remaining = checkVisualObligations({ ...set, obligations: retained }, document);
  return {
    rejection: missingSpecies.length ? `required chemistry species ${missingSpecies[0]!.label} has no complete source-bound structure`
      : audit.issues[0]?.message ?? remaining.missing[0]?.message ?? null,
    ignoredIds, missingSpecies,
  };
}

export function chemistryVisualObligationRejection(set: VisualObligationSet, document: SceneDocument): string | null {
  return chemistryVisualObligationCheck(set, document).rejection;
}
