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
 *     water bent", "explain why methane is tetrahedral"), with a verb before
 *     the shape word and the shape word closing the clause, so "water linear
 *     speed" and "water has angular momentum" stay physics.
 * A neutral name followed by ion, anion or cation ("the ammonia ion") names
 * an ion the table does not hold, so it is never framed. A name followed by
 * and/or is closed only when every further conjunct is itself a species
 * ("shapes of water and ammonia", never "shape of water and mercury menisci").
 * Physics stems name water, methane and ammonia in flow, heat and pressure
 * problems and in "a bent tube full of water"; none of those is a frame.
 *
 * This grants membership only. Which shape the molecule has is still solved
 * from its formula by `vseprGeometry`, and a multi-centre name (hydrazine,
 * hydrogen peroxide, ethyne) resolves to no single central atom and declines.
 */
import { elementByName } from "./elements";
import { formulaTokens, parseFormula } from "./formula";
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

/** After a governed name: the clause ends or continues with a verb or a method, never a noun the name modifies. */
const CLOSED_AFTER = /^\s*(?:$|[,.;:?!]|(?:molecules?|ions?|species|is|are|has|have|vs\.?|versus|compared|than|using|by|according)\b)/i;

/** A list continues: comma, and/or, or both, then an optional article. */
const CONJUNCT = /^\s*(?:,\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)(?:(?:the|a|an)\s+)?/i;

/** The neutral table name is followed by an ion word: "the ammonia ion" is not NH3. */
const ION_WORD_AFTER = /^\s+(?:ions?|anions?|cations?)\b/i;

const LIST_JOIN = /^\s*(?:,\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)(?:(?:the|a|an)\s+)?$/;

/** Head of a clause whose subject is the name ("why is", "explain why", "how does"). */
const PREDICATE_HEAD = /^\s*(?:(?:explain|state|show|tell|describe|justify)\s+)?(?:(?:why|how|whether)\s+)?(?:(is|are)\s+|(?:does|do)\s+)?(?:(?:the|a|an)\s+)?$/;
/** The shape word closes its clause: end, punctuation, a shape noun, or a further shape word. */
const SHAPE_CLOSES = `(?=\\s*(?:$|[,.;:?!)]|(?:shape|shaped|geometry|molecule)\\b|in\\s+shape\\b|(?:and|or)\\s+(?:(?:a|an)\\s+)?${SHAPE_WORD}\\b))`;
/** A copula before the name ("why is water bent"): the shape word may follow the name directly. */
const PREDICATE_TAIL_AFTER_COPULA = new RegExp(`^\\s+(?:molecules?\\s+)?${SHAPE_WORD}\\b${SHAPE_CLOSES}`);
/** Otherwise a verb comes between the name and the shape word ("methane is tetrahedral", "ammonia has a pyramidal shape"). */
const PREDICATE_TAIL_WITH_VERB = new RegExp(`^\\s+(?:molecules?\\s+)?(?:(?:is|are|adopts?|takes?)\\s+(?:(?:a|an)\\s+)?${SHAPE_WORD}\\b${SHAPE_CLOSES}|(?:has|have|having)\\s+(?:(?:a|an)\\s+)?${SHAPE_WORD}\\s+(?:shape|geometry)\\b)`);

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

/** A table formula with no charge: followed by an ion word it names some other species. */
export function neutralNameOfIon(text: string, mention: NamedSpeciesMention): boolean {
  return (parseFormula(mention.formula)?.charge ?? 0) === 0 && ION_WORD_AFTER.test(text.slice(mention.end));
}

/** The member that starts at `index`: a table name or a written formula, with its end. */
function memberEnd(text: string, mentions: readonly NamedSpeciesMention[], index: number): number | null {
  const name = mentions.find((mention) => mention.start === index);
  if (name) return neutralNameOfIon(text, name) ? null : name.end;
  const word = /^[A-Za-z0-9()^+-]+/.exec(text.slice(index))?.[0];
  if (!word || !formulaTokens(word).includes(word) || !parseFormula(word)) return null;
  return index + word.length;
}

/**
 * The name is closed: what follows it ends the clause, or is a list whose
 * every conjunct is a species and whose last member is closed.
 */
function closedAfter(text: string, mentions: readonly NamedSpeciesMention[], end: number): boolean {
  for (let cursor = end, steps = 0; steps < 12; steps += 1) {
    const after = text.slice(cursor);
    const join = CONJUNCT.exec(after);
    if (!join) return CLOSED_AFTER.test(after);
    // Any conjunct that is not a species leaves the name unbound, a bare
    // comma included: "shape of water, oil and mercury" is not a list of molecules.
    const next = memberEnd(text, mentions, cursor + join[0].length);
    if (next === null) return false;
    cursor = next;
  }
  return false;
}

/** Named species that a molecular shape frame owns, with spans in `text`. */
export function framedNamedSpecies(text: string): NamedSpeciesMention[] {
  const lower = text.toLowerCase();
  const mentions = namedSpeciesMentions(lower);
  const framed: NamedSpeciesMention[] = [];
  for (const mention of mentions) {
    if (neutralNameOfIon(lower, mention)) continue;
    const prefix = clausePrefix(lower, mention.start);
    const after = lower.slice(mention.end);
    const previous = framed.at(-1);
    const listed = previous !== undefined && LIST_JOIN.test(lower.slice(previous.end, mention.start));
    const ownsAfter = closedAfter(text, mentions, mention.end);
    const head = PREDICATE_HEAD.exec(prefix);
    const predicate = head !== null && (head[1] ? PREDICATE_TAIL_AFTER_COPULA : PREDICATE_TAIL_WITH_VERB).test(after);
    if ((ownsAfter && (governed(prefix) || listed)) || predicate) framed.push(mention);
  }
  return framed;
}
