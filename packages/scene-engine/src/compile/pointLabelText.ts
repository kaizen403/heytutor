/**
 * The text a point's label is drawn with, and the rules the label solver
 * gets for it. Compile places the labels; the space view plan reads the same
 * text so it can leave room for a name of its real size.
 */
import { measureTextWidth } from "@heytutor/drawing";
import { POINT_LABEL_TETHER_PX } from "../labels/labelEngine";
import type { SceneDocument } from "../types";

export function compactCalloutLabel(text: string | undefined): string | undefined {
  const normalized = text?.trim();
  if (!normalized) return undefined;
  if (normalized.length <= 16) return normalized;
  const compactResult = normalized
    .replace(/R_?eq\s*,\s*(?:series|parallel)\s*=/i, "R_eq =")
    .replace(/\s+/g, " ");
  if (compactResult.length <= 16) return compactResult;
  const directionalPrefix = compactResult.match(
    /^(.{1,16}?)(?:\s+(?:toward|towards|to the|into|out of|leftward|rightward|upward|downward|clockwise|counterclockwise)\b)/i,
  )?.[1]?.trim();
  if (directionalPrefix) return directionalPrefix;
  const head = normalized.split(/[(:,;]/, 1)[0]?.trim();
  if (head && head.length <= 16) return head;
  return undefined;
}

export function isViewSummaryText(text: string | undefined): boolean {
  const normalized = text?.trim() ?? "";
  return /^(?:series|parallel|result|equivalent|total|answer|fbd|free[- ]body)\b/i.test(normalized) ||
    /^[A-Za-z][A-Za-z0-9_₀-₉,]*\s*=/.test(normalized);
}

export function isPointIdentifierText(text: string): boolean {
  return /^[A-Za-zΑ-ω][A-Za-z0-9₀-₉_]{0,2}$/.test(text.trim());
}

export function pointLabelTether(text: string): number {
  // Keep point identifiers in the same 56 px neighborhood. A measured phrase
  // needs room for its own glyphs: add only its excess half-width, so text
  // remains just as close to the anchor instead of failing on box size alone.
  if (isPointIdentifierText(text)) return POINT_LABEL_TETHER_PX;
  return POINT_LABEL_TETHER_PX + Math.max(0, measureTextWidth(text, 24) - 24) / 2;
}

export interface PointLabelText {
  text: string;
  /** Glyph run width at the 24 px label size. */
  widthPx: number;
  tetherPx: number;
  allowLeader: boolean;
}

/**
 * The one label compile places beside a point entity: its own label, unless
 * a label or callout annotation names it (then that annotation's text), or
 * the first annotation aimed at it when it has no label. Value callouts tied
 * to a quantity and view summaries go to the top of the view, not here.
 */
export function pointLabelText(document: SceneDocument, entityId: string): PointLabelText | null {
  const entity = Array.isArray(document?.entities) ? document.entities.find((candidate) => candidate?.id === entityId) : undefined;
  if (!entity || entity.kind !== "point") return null;
  const annotations = Array.isArray(document.annotations) ? document.annotations : [];
  const textOf = (annotation: (typeof annotations)[number]) => annotation.kind === "callout" ? compactCalloutLabel(annotation.text) : annotation.text;
  const explicit = annotations.some((annotation) =>
    (annotation.kind === "label" || annotation.kind === "callout") &&
    !annotation.quantityId &&
    !(annotation.kind === "callout" && isViewSummaryText(annotation.text)) &&
    Array.isArray(annotation.targetIds) && annotation.targetIds.includes(entityId) &&
    Boolean(textOf(annotation)));
  let text: string | undefined = entity.label && !explicit ? entity.label : undefined;
  if (!text) {
    for (const annotation of annotations) {
      if ((annotation.kind !== "label" && annotation.kind !== "callout") || !Array.isArray(annotation.targetIds) || annotation.targetIds[0] !== entityId) continue;
      const summary = (annotation.kind === "callout" && isViewSummaryText(annotation.text)) || (Boolean(annotation.quantityId) && Boolean(entity.label));
      if (summary && compactCalloutLabel(annotation.text)) continue;
      const raw = annotation.text ?? entity.label;
      text = annotation.kind === "callout" ? compactCalloutLabel(raw) : raw;
      if (text) break;
    }
  }
  if (!text) return null;
  return { text, widthPx: Math.max(8, measureTextWidth(text, 24)), tetherPx: pointLabelTether(text), allowLeader: !isPointIdentifierText(text) };
}
