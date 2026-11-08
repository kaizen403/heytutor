import type { SceneDocument } from "../types";

/**
 * Curve label placement, a switch that is off by default
 * (`DIAGRAM_CURVE_LABELS`). Admission stamps the document, as it stamps the
 * yield policy, so the save, every reopen and every resume rebuild the scene
 * the way it was drawn. A document saved without the stamp keeps the placement
 * it was saved with, whatever the switch says later. The stamp is engine only:
 * a planner cannot write it.
 */
export const CURVE_LABEL_PLACEMENT = "on_stroke" as const;

/** Only a graph of y = f(x) is placed by its own stroke. */
export function documentHasFunctionCurve(document: Pick<SceneDocument, "constructions">): boolean {
  return document.constructions.some((construction) => construction.operator === "function_curve");
}

export function isCurveLabelPlacementOnStroke(document: SceneDocument): boolean {
  return document.source.curveLabelPlacement === CURVE_LABEL_PLACEMENT;
}

/** Stamps a document that graphs y = f(x) when on; removes any stamp when off. */
export function withCurveLabelPlacement(document: SceneDocument, onStroke: boolean): SceneDocument {
  const stamped = isCurveLabelPlacementOnStroke(document);
  const wanted = onStroke && documentHasFunctionCurve(document);
  if (stamped === wanted && (wanted || document.source.curveLabelPlacement === undefined)) return document;
  const source = { ...document.source };
  delete source.curveLabelPlacement;
  if (wanted) source.curveLabelPlacement = CURVE_LABEL_PLACEMENT;
  return { ...document, source };
}

/** `DIAGRAM_CURVE_LABELS=on` turns it on; anything else leaves it off. */
export function parseCurveLabelSwitch(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "on";
}
