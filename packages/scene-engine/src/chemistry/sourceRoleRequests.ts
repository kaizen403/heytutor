import type { ChemistrySpan } from "./quantityReader";

/** A closed requested role list carries no physical value. Every character
 * between its source-owned role spans must belong to the list grammar.
 * Assignments, units, numbers and unknown material cannot be skipped here. */
export function requestedSourceRoleStarts(source: string, roles: readonly ChemistrySpan[]): ReadonlySet<number> {
  const requested = new Set<number>();
  const request = /\b(?:find|calculate|compute|determine|mark|show|label)\s+(?:(?:the|an?|its|both)\s+)*$/i;
  const separator = /^\s*(?:,\s*(?:and\s+)?|and\s+|&\s*)(?:(?:the|an?|its|both)\s+)*$/i;
  for (let i=0;i<roles.length;i++) {
    const first = roles[i]!;
    const prefix = source.slice(0,first.start).split(/[;!?\n]|\.(?=\s|$)/).at(-1)!;
    if (!request.test(prefix)) continue;
    let last = i;
    while (last+1 < roles.length && separator.test(source.slice(roles[last]!.end,roles[last+1]!.start))) last++;
    const tail = source.slice(roles[last]!.end).split(/[;!?\n]|\.(?=\s|$)/)[0]!;
    if (tail.trim() !== "") continue;
    for (let j=i;j<=last;j++) requested.add(roles[j]!.start);
  }
  return requested;
}

/** Negating a numeric display request never consumes a supplied value; the
 * caller must still inventory/read every physical role independently. */
export function numericalValuesRequested(source: string): boolean {
  for (const word of source.matchAll(/\bnumeric(?:al)?\b/gi)) {
    if (!/\b(?:no|without)\s+(?:exact\s+)?$/i.test(source.slice(0,word.index))) return true;
  }
  return false;
}
