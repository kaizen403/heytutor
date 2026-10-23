import type { SceneDocument } from "../types";
import { chemistryFamilyBuilder } from "./router";
import { CONDUCTANCE_TEACHING_FAMILY } from "./familyTeaching";

/**
 * Old engine conductance documents predate the narrower teaching-family id.
 * Resolve that id through the same registered builder, never through saved
 * prose, question regexes in the app, or replacement of the accepted geometry.
 * The save boundary also revalidates a browser-supplied id through this path.
 */
export function chemistryTeachingFamilyId(document: SceneDocument): string | null {
  const source = document.source;
  if (source.chemistryFamily !== "chem_electrochem") return null;
  if (source.chemistryTeachingFamilyId !== undefined && source.chemistryTeachingFamilyId !== CONDUCTANCE_TEACHING_FAMILY) return null;
  if (typeof source.question !== "string") return null;
  const fresh = chemistryFamilyBuilder("chem_electrochem")?.(source.question, [], false);
  return fresh?.source.chemistryTeachingFamilyId === CONDUCTANCE_TEACHING_FAMILY
    ? CONDUCTANCE_TEACHING_FAMILY : null;
}
