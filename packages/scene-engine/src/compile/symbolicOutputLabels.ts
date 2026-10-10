import type { SceneDocument } from "../types";

/** A representative's normalized numbers are construction inputs, not source data. */
export function isSymbolicRepresentative(document: SceneDocument): boolean {
  return document.source.nonMetric === true
    && document.source.representationTier === "qualitative_verified"
    && document.quantities.length === 0;
}

/** Identity grammar only: no assignments, units, scalar answers, or question prose. */
export function isSymbolicIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length <= 16
    && /^[\p{L}][\p{L}\p{N}_'′]*(?:\([\p{L}][\p{L}\p{N}_'′]*\))?$/u.test(value.trim());
}

/** Called only after the original typed numeric-claim validator has succeeded. */
export function representativeOutputLabel(label: string | null, requested: unknown, output: unknown): string | null {
  // Counts, probabilities and discrete witnesses remain actual mathematical
  // data even when their diagram uses a nonmetric layout.
  if (typeof output !== "object" || output === null
    || !["opticalImage", "opticalFocus", "electricField", "dipoleField", "chargedRing", "waveDefinition", "waveSample", "remainder"].some((key) => key in output)) return label;
  if (isSymbolicIdentity(requested)) return requested.trim();
  return label?.split(/[=≈]/)[0]?.replace(/ schematic$/, "") ?? null;
}
