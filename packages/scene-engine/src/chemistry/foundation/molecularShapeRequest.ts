/** The geometry method is a request operator, never a chemical identity. */
export function molecularShapeMethodRequested(question: string): boolean {
  return positiveShapeMentions(question).some(mention => /^vsepr$/i.test(mention));
}

/** Flat connectivity is not a substitute for a requested molecular geometry. */
export function molecularShapeRequested(question: string): boolean {
  return positiveShapeMentions(question).length > 0;
}

/** An exclusion owns only its local figure noun or closed coordinated list.
 * A later positive predicate still requests geometry; "not only" does too. */
function positiveShapeMentions(question: string): string[] {
  const mentions: string[] = [];
  let previous: { end: number; excluded: boolean } | undefined;
  const nouns = /\bvsepr\b|\b(?:(?:molecular|electron(?:[ -](?:pair|domain))?)\s+)?(?:shapes?|geometr(?:y|ies))\b|\bbond\s+angles?\b/gi;
  for (const match of question.matchAll(nouns)) {
    const before = question.slice(0, match.index);
    const direct = /\b(?:not|rather\s+than|instead\s+of)\s+(?:(?:using|use|showing|drawing)\s+)?(?:(?:its|their|the|an?)\s+)?$/i.test(before);
    const negativePredicate = /\b(?:do\s+not|don['’]t|never)\s+(?:draw|show|sketch|display|include|depict|mark|label|use)\s+(?:(?:its|their|the|an?)\s+)?$/i.test(before);
    const continued = previous?.excluded === true
      && /^(?:\s*,\s*|\s+(?:or|nor|and)\s+|\s*,\s*(?:or|nor|and)\s+)(?:(?:its|their|the|an?)\s+)?$/i.test(question.slice(previous.end, match.index));
    const excluded = direct || negativePredicate || continued;
    if (!excluded) mentions.push(match[0]);
    previous = { end: match.index + match[0].length, excluded };
  }
  return mentions;
}
