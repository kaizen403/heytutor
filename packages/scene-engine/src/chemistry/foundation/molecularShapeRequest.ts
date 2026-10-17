/** Flat connectivity is not a substitute for a requested molecular geometry. */
export function molecularShapeRequested(question: string): boolean {
  return /\bvsepr\b|\bshapes?\b|\bgeometr(?:y|ies)\b|\bbond\s+angles?\b/i.test(question);
}
