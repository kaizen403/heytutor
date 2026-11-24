/** Explicit model parameters restrict applicability; absent counts retain the
 * operator's one-electron caveat rather than inventing an electron inventory. */
export function declaredElectronCounts(text: string, explicitInventoryOnly = false): number[] {
  text = currentEnergyClauses(text).join("; ").replace(/\bn_e\b/gi, "electronCount");
  const counts: number[] = [];
  const words: Readonly<Record<string, number>> = { zero: 0, no: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, multi: 2, multiple: 2 };
  const number = "(?:[+-]?\\d+(?:\\.\\d+)?|zero|no|one|two|three|four|five|six|seven|eight|nine|ten)";
  const excludedPrefix = (at: number) => /\b(?:not|cannot|can't|never|avoid|exclude|excluding|unlike|rather than|instead of)\b(?:\s+[\w-]+){0,4}\s*$/i.test(text.slice(Math.max(0, at - 100), at).split(/[;.!?\n]/).at(-1)!);
  // A declared but unresolved/negated inventory is not an absent inventory.
  // NaN is an unproved constraint, never an invented electron count: every
  // caller must retain its existing count !== 1 refusal for this model.
  const binding = /\b(?:electron[ _-]*count|number\s+of\s+electrons)\s*(!=|≠|>=|<=|>|<|≥|≤|=|:|is\b|of\b)\s*/gi;
  for (const match of text.matchAll(binding)) {
    if (excludedPrefix(match.index!)) continue;
    const tail = text.slice(match.index! + match[0].length);
    const assignment = /^(?:=|:|is|of)$/i.test(match[1]!);
    // "The electron count is N_e=1" names the same inventory twice.
    // The inner binding is independently visited; an arbitrary alias is not.
    if (assignment && /^(?:electron[ _-]*count|number\s+of\s+electrons)\s*(?:=|:|is\b|of\b)/i.test(tail)) continue;
    const literal = new RegExp(`^(${number})(?![\\w]|\\.(?!\\s|$))`, "i").exec(tail);
    if (!literal || !assignment || /^\s*(?:[/+*^=]|-(?!>))/.test(tail.slice(literal[0].length))) counts.push(Number.NaN);
  }
  for (const match of text.matchAll(/\b(?:contains?|has|have|with|having)\s+(?:more\s+than\s+(?:one|1)|at\s+least\s+(?:two|2))\s+(?:bound\s+)?electrons?\b/gi))
    if (!excludedPrefix(match.index!)) counts.push(Number.NaN);
  const declarations = [
    new RegExp(`\\b(?:electron[ _-]*count|number\\s+of\\s+electrons)\\s*(?:=|:|is|of)\\s*(${number})\\b`, "gi"),
    new RegExp(`\\b(?:contains?|has|have|with|having)\\s+(${number})\\s+(?:bound\\s+)?electrons?\\b`, "gi"),
    new RegExp(`\\b(${number})[- ]electrons?\\b`, "gi"),
    /\b(multi|multiple)[- ]?electrons?\b/gi,
  ];
  for (const declaration of explicitInventoryOnly ? declarations.slice(0, 2) : declarations) for (const match of text.matchAll(declaration)) {
    // Generic applicability prose such as "cannot model atoms with one
    // electron" is not the shown ion's inventory. Has/contains are counted
    // declarations; standalone role words remain conceptual caveats here.
    if (explicitInventoryOnly && /^with\b/i.test(match[0])) continue;
    const prefix = text.slice(Math.max(0, match.index! - 100), match.index).split(/[;.!?\n]/).at(-1)!;
    // An excluded two-electron model is not the system's electron count.
    const count = words[match[1]!.toLowerCase()] ?? Number(match[1]);
    if (/\b(?:not|cannot|can't|never|avoid|exclude|excluding|unlike|rather than|instead of)\b(?:\s+[\w-]+){0,4}\s*$/i.test(prefix)) {
      if (count === 1) counts.push(2); // Explicitly excluding one electron is outside this model.
      continue;
    }
    counts.push(count);
  }
  return counts;
}
import { currentEnergyClauses } from "./energySourceScope";

