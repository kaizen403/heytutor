import { resolveElement } from "./elements";

/**
 * A closed reader for structural requests. Formula parsing owns chemical
 * names: English words left in an argument are not silently assumed to be
 * decoration. This deliberately declines unsupported names rather than
 * maintaining a list of names or drawing a recognized subset.
 */
export function vseprSourceArgumentsComplete(
  sentences: readonly string[],
  formulas: readonly string[],
  centralSymbols: ReadonlySet<string>,
): boolean {
  for (const sentence of sentences) {
    let rest = sentence;
    for (const formula of [...new Set(formulas)].sort((a, b) => b.length - a.length)) {
      rest = rest.replace(new RegExp(`(?<![A-Za-z0-9])${escape(formula)}(?![A-Za-z0-9])`, "g"), " @ ");
    }
    // A bare source atom is a property subject only when its local grammar
    // makes it the center of one of the resolved molecules, never a second
    // named compound. Existing element aliases include sulfur/sulphur.
    rest = rest.replace(/\b[A-Za-z]+\b(?=\s+(?:in|as|at)\b)/g, (word) => {
      const element = resolveElement(word);
      return element && centralSymbols.has(element.symbol) ? " @ " : word;
    });
    const optionClause = /(?:^|\s)\([A-Da-d1-4]\)\s/.test(rest);
    const structuralRequest = /\b(?:draw|show|sketch|compare|depict|illustrate|add|include|including|mark|indicate|label|shapes?|geometr(?:y|ies)|structures?|hybridi[sz](?:ation|ed)|bond\s+angles?|lone[ -]?pairs?)\b/i.test(rest);
    if (!rest.includes("@") && !optionClause && !structuralRequest) continue;
    if (optionClause) rest = rest.replace(/(?:^|\s)\([A-Da-d1-4]\)\s/g, " ");
    // These are grammatical words and the finite structural vocabulary this
    // renderer can fulfill, not alternative spellings of chemical members.
    rest = rest.replace(/\b(?:what|which|where|why|how|is|are|does|do|has|have|can|you|the|a|an|of|in|for|and|or|with|its|their|it|this|that|these|those|at|to|on|as|from|between|also|both|all|each|together|versus|vs|please)\b/gi, " ");
    rest = rest.replace(/\b(?:draw|show|sketch|compare|depict|illustrate|add|explain|describe|mark|include|including|indicate|label|keep|state|predict|determine|find|briefly|brief|explanation)\b/gi, " ");
    rest = rest.replace(/\b(?:molecular|molecules?|ions?|species|electrons?|domains?|pairs?|shapes?|geometr(?:y|ies)|structures?|arrangements?|hybridi[sz](?:ation|ed)|bonds?|angles?|atoms?|lone|number|count|sum|following|positions?|locations?|central|cent(?:er|re)|sits?|go(?:es)?|occup(?:y|ies)|located|placed|points?|dots?|degrees?|deg|stated|given|one|two|three|four|five|six|seven|no|zero)\b/gi, " ");
    rest = rest.replace(/\b(?:square|trigonal|pentagonal|bipyramidal|pyramidal|tetrahedral|octahedral|planar|linear|bent|angular|see[ -]?saw|t[ -]shaped|distorted|equatorial|axial|dipole|moments?|polarity|polar|nonpolar)\b/gi, " ");
    // Numeric counts/angles still face the normal authoritative plan and IR
    // checks. Their presence here never certifies a displayed quantity.
    rest = rest.replace(/[-+]?\d+(?:\.\d+)?/g, " ");
    if (/[\p{L}\p{N}]/u.test(rest)) return false;
  }
  return true;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
