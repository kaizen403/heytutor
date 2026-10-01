import { buildSolidFigure } from "./solidFigure";
import { buildPlanarMensuration } from "./planarMensuration";
import type { ProblemStructureView } from "./familyClassification";

/**
 * Geometry, not a topic-name match, supplies structure when the semantic
 * planner is unavailable. A source program must bind complete dimensions;
 * incomplete/ambiguous geometry declines without claiming a capability.
 */
export function sourceMensurationStructure(question: string): ProblemStructureView | null {
  const solid = buildSolidFigure(question);
  if (solid) return { entities: [{ kind: "solid" }] };
  const region = buildPlanarMensuration(question);
  return region ? { entities: [{ kind: "region" }] } : null;
}
