/**
 * Named species as VSEPR members: "why is water bent", "sp3 hybridisation in
 * methane", "shape of ammonia". The name authority is `namedSpecies.ts`, the
 * same table the Lewis reader uses; this module only decides when a name is
 * the molecule a shape ask is about.
 *
 * A name counts only inside a molecular frame:
 *   - governed by a shape word through of/in/for, with nothing between them
 *     but closed molecular vocabulary ("hybridisation of carbon in methane",
 *     "the shape and bond angle of water"), and closed after the name, so
 *     "the shape of the water surface" and "the bond angle in water jets"
 *     stay what they are;
 *   - a further name joined to a framed name by a comma or a conjunction
 *     ("shapes of water and ammonia");
 *   - the subject of a shape predicate at the head of its clause ("why is
 *     water bent", "explain why methane is tetrahedral").
 * Physics stems name water, methane and ammonia in flow, heat and pressure
 * problems and in "a bent tube full of water"; none of those is a frame.
 *
 * This grants membership only. Which shape the molecule has is still solved
 * from its formula by `vseprGeometry`, and a multi-centre name (hydrazine,
 * hydrogen peroxide, ethyne) resolves to no single central atom and declines.
 */
import { elementByName } from "./elements";
import { namedSpeciesMentions, type NamedSpeciesMention } from "./namedSpecies";

/** Words that make a name the molecule a shape ask is about. Dipole moment is not one: a physics dipole names water too. */
const GOVERNING_CUE = /\b(?:hybridi[sz](?:ation|ed|es)?|shapes?|geometr(?:y|ies)|bond angles?|lone[ -]?pairs?|vsepr)$/;

/** Closed vocabulary allowed between the cue and its preposition. */
const GAP_WORDS = new Set([
  "and", "or", "the", "a", "an", "its", "of", "central", "atom", "atoms", "molecular", "electron", "electronic",
  "pair", "pairs", "domain", "domains", "lone", "bond", "bonds", "angle", "angles", "shape", "shapes", "geometry",
  "geometries", "hybridisation", "hybridization", "hybridised", "hybridized", "hybrid", "orbitals", "type", "state",
  "sp", "sp2", "sp3", "sp3d", "sp3d2", "sp^2", "sp^3", "vsepr",
]);

const SHAPE_WORD = "(?:bent|linear|angular|v[- ]shaped|non[- ]?linear|pyramidal|trigonal (?:planar|pyramidal|bipyramidal)|pentagonal bipyramidal|tetrahedral|planar|octahedral|see[- ]?saw|t[- ]shaped|square (?:planar|pyramidal)|sp\\^?\\d(?:d\\^?\\d?)?(?: hybridi[sz]ed)?)";

/** After a governed name: the clause ends or continues with a list, a verb or a method, never a noun the name modifies. */
const CLOSED_AFTER = /^\s*(?:$|[,.;:?!]|(?:molecules?|ions?|species|and|or|is|are|has|have|vs\.?|versus|compared|than|using|by|according)\b)/;

const LIST_JOIN = /^\s*(?:,\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)(?:(?:the|a|an)\s+)?$/;

/** Head of a clause whose subject is the name ("why is", "explain why", "how does"). */
const PREDICATE_HEAD = /^\s*(?:(?:explain|state|show|tell|describe|justify)\s+)?(?:(?:why|how|whether)\s+)?(?:(?:is|are|does|do)\s+)?(?:(?:the|a|an)\s+)?$/;
const PREDICATE_TAIL = new RegExp(`^\\s+(?:molecules?\\s+)?(?:(?:is|are|has|have|having|adopts?|takes?)\\s+)?(?:(?:a|an)\\s+)?${SHAPE_WORD}\\b`);

function clausePrefix(text: string, start: number): string {
  return text.slice(0, start).split(/[.;!?\n]/).at(-1)!;
}

function governed(prefix: string): boolean {
  const head = /^(.*?)\s+(?:of|in|for)\s+(?:(?:the|a|an)\s+)?(?:(?:molecules?|ions?)\s+of\s+(?:(?:the|a|an)\s+)?)?$/.exec(prefix);
  if (!head) return false;
  const words = head[1]!.trimEnd().split(/\s+/);
  // Walk back over the closed gap vocabulary to the governing cue.
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index]!;
    if (GOVERNING_CUE.test(word) || (index > 0 && GOVERNING_CUE.test(`${words[index - 1]} ${word}`))) return true;
    if (!GAP_WORDS.has(word) && !elementByName(word)) return false;
  }
  return false;
}

/** Named species that a molecular shape frame owns, with spans in `text`. */
export function framedNamedSpecies(text: string): NamedSpeciesMention[] {
  const lower = text.toLowerCase();
  const mentions = namedSpeciesMentions(lower);
  const framed: NamedSpeciesMention[] = [];
  for (const mention of mentions) {
    const prefix = clausePrefix(lower, mention.start);
    const after = lower.slice(mention.end);
    const previous = framed.at(-1);
    const listed = previous !== undefined && LIST_JOIN.test(lower.slice(previous.end, mention.start));
    const ownsAfter = CLOSED_AFTER.test(after);
    if ((ownsAfter && (governed(prefix) || listed)) || (PREDICATE_HEAD.test(prefix) && PREDICATE_TAIL.test(after))) {
      framed.push(mention);
    }
  }
  return framed;
}
