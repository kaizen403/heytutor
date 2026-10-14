/**
 * Annotation `placementIntent` values that name a side of a refraction
 * rather than a compass direction. The compiler resolves each from the
 * refraction's own two paths: `incident_side` is the medium the incident ray
 * crosses (n1), `transmitted_side` the medium the refracted ray enters (n2).
 * A medium label on a refraction interface should carry one of them.
 */
export const SCENE_SIDE_PLACEMENT_INTENTS = ["incident_side", "transmitted_side"] as const;

export type SceneSidePlacementIntent = (typeof SCENE_SIDE_PLACEMENT_INTENTS)[number];

/**
 * Read a side intent. The enum values and the free text planners already
 * write for them ("incident side", "refracted side") name the side; any other
 * "<medium> side" returns the medium for the caller to match against the
 * refraction's own n1 and n2 labels and quantities. Anything else is null.
 */
export function parseSidePlacementIntent(
  intent: string | undefined,
): { side: SceneSidePlacementIntent } | { medium: string } | null {
  const text = intent?.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!text) return null;
  if (text === "incident side" || text === "incidence side") return { side: "incident_side" };
  if (text === "transmitted side" || text === "refracted side") return { side: "transmitted_side" };
  const medium = text.match(/^(.+) side$/)?.[1]?.trim();
  return medium ? { medium } : null;
}
