/**
 * Reads a mechanism ask from the question text.
 *
 * - A cyclic elimination is named ("ester pyrolysis", "Chugaev", "Cope
 *   elimination"). Without a name this reader draws nothing; a mechanism
 *   ask without one declines so the organic family draws no product row.
 * - Species come from the stated condensed formulas: product sets "A + B"
 *   and single substrates. No species is ever taken from a word list.
 * - Only two shapes of stem are read, and every other stem declines. The
 *   reading accepts what it understands instead of refusing what it has
 *   seen go wrong, because free text always has one more way to say the
 *   opposite:
 *   - an ask: "Show / Draw / Explain (the mechanism of) the <reaction> of
 *     <substrate>", with fixed tails ("on heating", "with curly arrows",
 *     "via a six membered TS", "at 500 C") and an optional "Draw the
 *     arrows.";
 *   - notes: reaction headings, ring size and heat phrases, and product
 *     sets "A + B", with no verb but a bare "<reaction> gives A + B".
 * - In notes, a set is under the group of names last written above or
 *   before it. One name pairs it outright; several (a heading line listing
 *   them) bind it by chemistry, which photographed notes need. A group
 *   listing several names on the set's own line declines, since its order
 *   is not read.
 * - A named class is drawn only when its stated set rebuilds one substrate
 *   whose forward arrows give exactly that set, or its stated substrate
 *   runs under it. A reaction whose own stated products fail is declined
 *   and recorded, and never takes another set; a stated set no declined
 *   reaction can own declines the whole figure. The stated products are
 *   never drawn as if the arrows gave them.
 * - A stated ring size must be the ring of every drawn transition state,
 *   and a stated temperature must be one the class runs at.
 */
import type { SceneDocument } from "../../../types";
import { readCondensed } from "./condensed";
import { CYCLIC_RING_SIZE, cyclicElimination, cyclicEliminationFromProducts, type CyclicElimination, type CyclicEliminationKind } from "./eliminations";
import { buildCyclicEliminationFigure, MECHANISM_TITLES, type DeclinedReaction } from "./figure";
import type { MechState } from "./state";

export type MechanismSourceRead =
  | { status: "not_applicable" }
  | { status: "declined"; reason: string; declined: readonly DeclinedReaction[] }
  | { status: "source"; document: SceneDocument; drawn: readonly CyclicEliminationKind[]; declined: readonly DeclinedReaction[] };

const CYCLIC_NAMES: ReadonlyArray<{ kind: CyclicEliminationKind; pattern: RegExp }> = [
  { kind: "ester_pyrolysis", pattern: /\bester\s+pyrolysis\b|\bpyrolysis\s+of\s+(?:an?\s+)?esters?\b/gi },
  { kind: "xanthate_pyrolysis", pattern: /\bxanthate\s+pyrolysis\b|\bpyrolysis\s+of\s+(?:an?\s+)?xanthates?\b|\bchugaev(?:\s+reaction)?\b|\btschugaeff(?:\s+reaction)?\b/gi },
  { kind: "cope_elimination", pattern: /\bcope\s+elimination\b|\bamine\s+oxide\s+(?:pyrolysis|elimination)\b/gi },
];
/**
 * SN1, SN2, E1, E2 in the spellings stems use (S_N2, SN-2, SN², sn2, e2).
 * Not before a charge or another digit: "Sn2+" is the tin(II) ion.
 */
const MECHANISM_TYPE = /\b[Ss]\s?_?\s?[Nn]\s?-?\s?[12¹²](?![0-9+⁺])|\b[Ee]\s?-?\s?[12¹²](?![0-9+⁺])/;
const ASK_VERB = /\b(?:show|draw|write|explain|illustrate|depict|describe|outline|give|steps|how)\b/i;
/** A comparison of rates or reactivity: "order of reactivity towards SN2" asks for structures, not arrows. */
const COMPARISON = /\breactiv|\b(?:arrange|faster|slower|increasing|decreasing)\b|\border\s+of\b/i;
/**
 * "the Cope rearrangement", "Explain Claisen rearrangement": explaining one
 * is a mechanism ask. Case sensitive and after an article or an ask verb,
 * so a capitalised sentence start ("What rearrangement occurs") is not read
 * as a name.
 */
const NAMED_REARRANGEMENT = /\b(?:the|a|[Ee]xplain|[Ss]how|[Dd]raw|[Dd]escribe|[Gg]ive)\s+[A-Z][a-z]+(?:[-–][A-Z][a-z]+)?\s+rearrangements?\b/;
/**
 * Asks for a mechanism. Without a checked operator they decline rather than
 * fall to a product row. Naming SN1 or SN2 alone is not one: "order of
 * reactivity towards SN2" keeps its structure row. The common misspellings
 * of "mechanism" count.
 */
const MECHANISM_ASK = /\bmec?h?ani?s[ia]?m|\bmechanistic\b|\bcurly\s+arrows?\b|\b(?:with|using|use|by)\s+(?:curly\s+)?arrows\b|\b(?:draw|show|add|mark)\s+(?:in\s+)?(?:the\s+)?arrows?\b|\barrow\s+pushing\b|\belectron\s+(?:movement|flow|pushing)\b|\bmovement\s+of\s+(?:the\s+)?electrons?\b|\btransition\s+state\b/i;
const RING_SIZE = /\b(three|four|five|six|seven|eight|[3-8])[\s-]*(?:membered|cent(?:re|er)(?:d|ed)?|atom)\b/gi;
const SIZE_WORDS: Readonly<Record<string, number>> = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
/** "500 C", "400 °C". A sign before it is left as a symbol, which no shape reads. */
const TEMPERATURE = /\b\d+(?:\.\d+)?\s*°?\s*C\b/g;
/** Where each class runs: a stated temperature outside it is a false condition. */
const TEMPERATURE_RANGE_C: Readonly<Record<CyclicEliminationKind, readonly [number, number]>> = {
  ester_pyrolysis: [250, 700],
  xanthate_pyrolysis: [100, 700],
  cope_elimination: [100, 700],
};
const FORMULA_TOKEN = /^[A-Za-z0-9_(){}=#≡\-−–^+]+$/;
/** The name tokens the shapes see, one per class. */
const NAME_TOKEN: Readonly<Record<CyclicEliminationKind, string>> = { ester_pyrolysis: "zester", xanthate_pyrolysis: "zxanthate", cope_elimination: "zcope" };
const NAME_TOKEN_KINDS: Readonly<Record<string, CyclicEliminationKind>> = Object.fromEntries(Object.entries(NAME_TOKEN).map(([kind, token]) => [token, kind as CyclicEliminationKind]));
const NAME = "(?:zester|zxanthate|zcope)";
const VERB = "(?:show|draw|explain|depict|illustrate|give|write|outline|describe|sketch)";
const TS = "(?:transition state|ts)";
const TAIL = `(?:on heating|with (?:the )?curly arrows|with arrows|with (?:the |its )?mechanism|using curly arrows|(?:via|through) (?:a |the )?(?:zsize )?(?:cyclic )?(?:zsize )?${TS}|at ztemp)`;
const FOLLOW = "(?:(?:draw|show) (?:the )?(?:curly )?(?:arrows|mechanism)|explain)";
/** The ask shape over the stem's words, with names, the substrate, ring sizes and temperatures as tokens. */
const ASK_SHAPE = new RegExp(`^(?:please )?(?:${VERB} (?:the )?(?:(?:curly arrow )?mechanisms? (?:of|for) (?:the )?)?|what is the mechanism (?:of|for) (?:the )?)${NAME} (?:of|for) zsub(?: ${TAIL})*(?: ${FOLLOW})?$`);
/** The words notes may carry beside headings and sets. */
const NOTES_WORDS: ReadonlySet<string> = new Set(["a", "the", "ts", "zsize", "heat", "heating", "on", "notes", "note", "and", "each", "for", "through", "via", "cyclic", "syn", "concerted", "transition", "state", "mechanism", "mechanisms", "curly", "arrow", "arrows", "zset"]);
/**
 * The one descriptive phrase notes may carry, in a sentence whose only name
 * is the Cope elimination: "the Cope elimination involves the cleavage of
 * amine oxides". A stored question cut inside it ("amine oxid") still reads.
 */
const COPE_PHRASE = /\binvolves (?:the )?cleavage of (?:an )?amine oxides?\b/g;
const COPE_PHRASE_CUT = /\binvolves(?: (?:the|th|t)?)?(?: (?:cleavage|cleavag|cleava|cleav|clea|cle|cl|c)?)?(?: (?:of|o)?)?(?: (?:amine|amin|ami|am|a)?)?(?: (?:oxide|oxid|oxi|ox|o)?)?$/;
/**
 * Outside formula tokens, the characters a shape may hold; any other symbol
 * ("←", "⇌", "≠", "<", "/") declines. A bare "-" declines too: a spaced sign
 * ("at - 300 C") or a "none" mark in a table. "->" is read as an arrow first.
 */
const SHAPE_CHARACTERS = /^[\p{L}\p{N}\s.,;:?!()→⟶⇒Δ]*$/u;
const PAIRING_VERB: ReadonlySet<string> = new Set(["gives", "yields", "forms", "produces"]);

interface StatedSet { text: string; at: number; end: number; species: MechState[] | null }
interface StatedSingle { state: MechState; at: number; end: number }
interface StatedSpecies {
  /** Every "A + B" whose two sides look like formulas; species null when either side fails the checked reader. */
  sets: StatedSet[];
  /** Single formulas outside any set that read as checked structures. */
  singles: StatedSingle[];
}

function statedSpecies(question: string): StatedSpecies {
  const tokens = [...question.replace(/->|[→⟶⇒]/g, (arrow) => " ".repeat(arrow.length)).matchAll(/\S+/g)]
    .map((match) => ({ text: match[0].replace(/[,;:.?!]+$/, ""), at: match.index! }))
    .filter((token) => token.text);
  const formulaLike = (token: string): boolean => FORMULA_TOKEN.test(token) && /[A-Z]/.test(token);
  const sets: StatedSet[] = [];
  const inSet = new Set<number>();
  for (let index = 1; index < tokens.length - 1; index += 1) {
    if (tokens[index]!.text !== "+") continue;
    const left = tokens[index - 1]!;
    const right = tokens[index + 1]!;
    if (!formulaLike(left.text) || !formulaLike(right.text)) continue;
    inSet.add(index - 1).add(index + 1);
    const a = readCondensed(left.text);
    const b = readCondensed(right.text);
    sets.push({ text: `${left.text} + ${right.text}`, at: left.at, end: right.at + right.text.length, species: a && b ? [a, b] : null });
  }
  const singles = tokens.flatMap((token, index) => {
    if (inSet.has(index) || !formulaLike(token.text) || token.text.length < 4) return [];
    const state = readCondensed(token.text);
    return state ? [{ state, at: token.at, end: token.at + token.text.length }] : [];
  });
  return { sets, singles };
}

function nameMentions(question: string): Array<{ kind: CyclicEliminationKind; start: number; end: number }> {
  return CYCLIC_NAMES.flatMap((entry) => [...question.matchAll(entry.pattern)].map((match) => ({ kind: entry.kind, start: match.index!, end: match.index! + match[0].length })))
    .sort((a, b) => a.start - b.start);
}

export function namedCyclicEliminations(question: string): CyclicEliminationKind[] {
  return CYCLIC_NAMES.filter((entry) => question.match(entry.pattern)).map((entry) => entry.kind);
}

export function isMechanismAsk(question: string): boolean {
  if (namedCyclicEliminations(question).length || MECHANISM_ASK.test(question)) return true;
  if (NAMED_REARRANGEMENT.test(question)) return true;
  // "Show how bromoethane undergoes E2", "The SN2 reaction of bromoethane gives
  // ethanol. Explain.": a named type in a stem that asks, unless it compares reactivity.
  return MECHANISM_TYPE.test(question) && ASK_VERB.test(question) && !COMPARISON.test(question);
}

interface Slot { at: number; end: number; token: string }

/** The stem's words with every slot, ring size, temperature and "T.S." standing as one token. */
function shapeWords(question: string, slots: readonly Slot[]): { text: string; words: string[] } {
  let text = question;
  for (const slot of [...slots].sort((a, b) => b.at - a.at)) text = `${text.slice(0, slot.at)} ${slot.token} ${text.slice(slot.end)}`;
  text = text.replace(RING_SIZE, " zsize ").replace(TEMPERATURE, " ztemp ").replace(/\bT\.\s?S\./gi, " ts ").toLowerCase();
  return { text, words: text.split(/[^\p{L}\p{N}]+/u).filter(Boolean) };
}

/**
 * Notes: every word is a notes word, a heading, a set, or a pairing verb
 * between a heading and its set, beside the one Cope phrase. Returns the
 * first word outside, or null.
 */
function notesOutside(question: string, text: string): string | null {
  const sentences = text.split(/[.?!\n]+/);
  const lastSentence = sentences.map((sentence, index) => (/[\p{L}\p{N}]/u.test(sentence) ? index : -1)).reduce((a, b) => Math.max(a, b), -1);
  for (const [index, raw] of sentences.entries()) {
    const names = raw.match(/\bz(?:ester|xanthate|cope)\b/g) ?? [];
    let sentence = raw;
    if (names.length && names.every((name) => name === NAME_TOKEN.cope_elimination)) {
      sentence = sentence.replace(COPE_PHRASE, " ");
      // Cut by storage: only a question ending in a letter, and only in its last sentence.
      if (index === lastSentence && /\p{L}$/u.test(question)) sentence = sentence.trimEnd().replace(COPE_PHRASE_CUT, " ");
    }
    const words = sentence.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (const [at, word] of words.entries()) {
      if (NOTES_WORDS.has(word) || word in NAME_TOKEN_KINDS) continue;
      if (PAIRING_VERB.has(word) && words[at - 1]! in NAME_TOKEN_KINDS && words[at + 1] === "zset") continue;
      return word;
    }
  }
  return null;
}
/** A line or sentence break; "T.S." is not one. */
const breaksIn = (text: string): boolean => /[.?!;\n]/.test(text.replace(/\bT\.\s?S\./gi, "TS"));
/**
 * The heading of each set in notes: the group of names last written before
 * it, a group being names with no line or sentence break and no set
 * between them.
 */
function setHeadings(question: string, sets: readonly StatedSet[], mentions: ReturnType<typeof nameMentions>): Array<{ kinds: CyclicEliminationKind[]; sameLine: boolean; group: number; joined: boolean }> {
  const groups: Array<{ kinds: CyclicEliminationKind[]; end: number; joined: boolean }> = [];
  for (const [index, mention] of mentions.entries()) {
    const previous = mentions[index - 1];
    const between = previous ? question.slice(previous.end, mention.start) : "\n";
    const split = breaksIn(between) || sets.some((set) => set.at >= previous!.end && set.end <= mention.start);
    if (split || !groups.length) groups.push({ kinds: [], end: mention.end, joined: false });
    const group = groups.at(-1)!;
    // "Cope elimination and ester pyrolysis", "A, B": the names are said to share what follows.
    if (!split && previous && /\band\b|,/i.test(between)) group.joined = true;
    if (!group.kinds.includes(mention.kind)) group.kinds.push(mention.kind);
    group.end = mention.end;
  }
  return sets.map((set) => {
    const index = groups.reduce((last, group, at) => (group.end <= set.at ? at : last), -1);
    const heading = groups[index];
    return { kinds: heading?.kinds ?? [], sameLine: heading ? !question.slice(heading.end, set.at).includes("\n") : false, group: index, joined: heading?.joined ?? false };
  });
}

const declinedRead = (reason: string, declined: readonly DeclinedReaction[] = []): MechanismSourceRead => ({ status: "declined", reason, declined });

export function readMechanismSource(question: string): MechanismSourceRead {
  const named = namedCyclicEliminations(question);
  if (!named.length) return isMechanismAsk(question) ? declinedRead("no checked mechanism operator for this ask") : { status: "not_applicable" };
  const { sets, singles } = statedSpecies(question);
  const mentions = nameMentions(question);
  // A single formula is read as a substrate only when a named class runs on it; any other stays a word, and no shape reads it.
  const runs = singles.flatMap((single) => named.flatMap((kind) => {
    const read = cyclicElimination(single.state, kind);
    return read.ok ? [{ single, kind, model: read.model }] : [];
  }));
  const substrates = [...new Set(runs.map((run) => run.single))];
  const { text, words } = shapeWords(question, [
    ...mentions.map((mention) => ({ at: mention.start, end: mention.end, token: NAME_TOKEN[mention.kind] })),
    ...sets.map((set) => ({ at: set.at, end: set.end, token: "zset" })),
    ...substrates.map((single) => ({ at: single.at, end: single.end, token: "zsub" })),
  ]);
  if (!SHAPE_CHARACTERS.test(text.replace(/->/g, "→"))) return declinedRead("a symbol outside formulas (an arrow back, a negation, an inequality) that no shape reads");
  const sizes = new Set([...question.matchAll(RING_SIZE)].map((match) => SIZE_WORDS[match[1]!.toLowerCase()] ?? Number(match[1])));
  if (sizes.size > 1) return declinedRead("more than one ring size stated: no size can be bound to one reaction");
  const declined: DeclinedReaction[] = [];
  const drawn: CyclicElimination[] = [];
  const keepIfSized = (model: CyclicElimination): void => {
    if (sizes.size && !sizes.has(CYCLIC_RING_SIZE[model.kind])) declined.push({ reaction: MECHANISM_TITLES[model.kind], reason: `the stated ring size disagrees with its ${CYCLIC_RING_SIZE[model.kind]} atom transition state` });
    else drawn.push(model);
  };

  if (!sets.length) {
    // The ask shape: its grammar holds one name and one substrate the named class runs on.
    if (!ASK_SHAPE.test(words.join(" "))) return declinedRead("not a plain ask for the mechanism of one named reaction of one stated substrate");
    const temperatures = [...question.matchAll(TEMPERATURE)].map((match) => Number.parseFloat(match[0]));
    const [low, high] = TEMPERATURE_RANGE_C[named[0]!];
    if (temperatures.some((value) => value < low || value > high)) return declinedRead(`a stated temperature outside ${low} to ${high} C, where this reaction runs`);
    const run = runs.find((candidate) => candidate.kind === named[0]);
    if (!run) return declinedRead("no stated substrate the named reaction runs on");
    keepIfSized(run.model);
    if (!drawn.length) return declinedRead("the stated ring size disagrees with the transition state", declined);
  } else {
    // The notes shape.
    // A substrate or temperature beside the sets stands as "zsub" or "ztemp", which no notes word reads.
    const outside = notesOutside(question, text);
    if (outside) return declinedRead(`the notes say "${outside}", which the mechanism reader does not read: the figure could answer something else`);
    // A set followed in its sentence by a name, linked by anything but "and" or "the" ("A + B via ester pyrolysis", "A + B (Chugaev reaction)"), may be that name's: its heading cannot be read. Bare juxtaposition is the next heading, as photographed notes run a set into it.
    const linkedAfter = sets.some((set) => {
      const next = mentions.find((mention) => mention.start >= set.end);
      const between = next ? question.slice(set.end, next.start) : "";
      return next !== undefined && !breaksIn(between) && !/^\s*(?:and\s+)?(?:the\s+)?$/i.test(between);
    });
    if (linkedAfter) return declinedRead("a product set is followed by a reaction name it may belong to: which heading it is under cannot be read");
    const headings = setHeadings(question, sets, mentions);
    const setsUnder = (group: number): number => headings.filter((heading) => heading.group === group).length;
    if (headings.some((heading) => heading.joined && setsUnder(heading.group) < heading.kinds.length)) return declinedRead("names joined as sharing a heading over fewer product sets than names: the text gives a set to more than one reaction");
    if (headings.some((heading) => heading.sameLine && heading.kinds.length > 1)) return declinedRead("two reactions and their products listed on one line without saying which gives which");
    const verifies = sets.map((set, index) => new Map(headings[index]!.kinds.flatMap((kind) => {
      if (!set.species) return [];
      const read = cyclicEliminationFromProducts(set.species, kind);
      return read.ok ? [[kind, read.model] as const] : [];
    })));
    const unbound = sets.filter((_, index) => verifies[index]!.size === 0);
    for (const kind of named) {
      const decline = (reason: string): void => { declined.push({ reaction: MECHANISM_TITLES[kind], reason }); };
      const fromSets = verifies.flatMap((map, index) => (map.has(kind) ? [index] : []));
      // The text gave this reaction its own products and they fail: another set fitting it would be a silent correction.
      if (headings.some((heading, index) => heading.kinds.length === 1 && heading.kinds[0] === kind && !verifies[index]!.has(kind))) decline("the products the text gives it do not follow from its arrows");
      else if (fromSets.length > 1) decline("more than one stated product set fits it");
      else if (fromSets.length === 1 && verifies[fromSets[0]!]!.size !== 1) decline("its stated products fit more than one named mechanism");
      else if (fromSets.length === 1) keepIfSized(verifies[fromSets[0]!]!.get(kind)!);
      else decline("no stated product set follows from its arrows");
    }
    for (const set of unbound) {
      declined.push({ reaction: `stated products ${set.text}`, reason: set.species ? "they do not follow from the arrows of any named mechanism" : "they do not read as checked structures" });
    }
    if (!drawn.length) return declinedRead("no named mechanism verified against its stated species", declined);
    // A set the text gives another reaction that a drawn class also gives: the drawn panel would answer the contradicted reaction.
    const drawnFrom = new Set(drawn.map((model) => sets.findIndex((_, index) => verifies[index]!.get(model.kind) === model)));
    if (sets.some((set, index) => !drawnFrom.has(index) && set.species && drawn.some((model) => cyclicEliminationFromProducts(set.species!, model.kind).ok))) return declinedRead("a set the text gives another reaction is a drawn panel's own products: the figure would answer that reaction", declined);
    // Each stated set no drawn reaction gives must belong to a declined one; a spare set is an option or a contradiction the drawn panel would answer.
    if (unbound.length > named.length - drawn.length) return declinedRead("a stated product set that no named reaction gives sits beside the drawn one: the figure would answer it", declined);
  }
  const document = buildCyclicEliminationFigure({ question, reactions: drawn, declined });
  if (!document) return declinedRead("the verified mechanism could not be laid out", declined);
  return { status: "source", document, drawn: drawn.map((model) => model.kind), declined };
}
