/** The geometry method is a request operator, never a chemical identity. */
export function molecularShapeMethodRequested(question: string): boolean {
  return /\bvsepr\b/i.test(question);
}

/** Flat connectivity is not a substitute for a requested molecular geometry. */
export function molecularShapeRequested(question: string): boolean {
  return molecularShapeMethodRequested(question) || /\bshapes?\b|\bgeometr(?:y|ies)\b|\bbond\s+angles?\b/i.test(question);
}
