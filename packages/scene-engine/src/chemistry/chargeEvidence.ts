/**
 * Does a question write anything that could be a charge?
 *
 * A certificate that trusts "the figure equals a fresh rebuild" trusts the
 * builder's reading of the stem. Builders read some charge spellings and draw
 * the neutral species for the rest (SO3 2-, NO2 minus, Cu II, with charge -1).
 * Listing the spellings a builder misses has failed twice, so this reader
 * inverts the rule: a figure identity or a source certificate applies only
 * when the stem has positive evidence of no charge, that is, no charge-like
 * token anywhere. Any of these is a charge-like token:
 *
 * - a sign character (+, -, the Unicode minus, dashes, plus-minus, the full
 *   width and small forms, superscript and subscript signs). The only sign
 *   not read is a hyphen joining two plain lowercase words, neither of which
 *   is an element name, a species name, a number word, a Roman numeral or a
 *   charge word (see-saw, well-known). C-H bond, 2-methylpropane and
 *   sp3-hybridised are read: a false decline is acceptable, a missed charge
 *   is not;
 * - a superscript digit, a caret, an HTML sup tag, or a radical dot;
 * - a charge word: minus, plus, negative, positive, charge, charged, ion,
 *   ions, ionic, cation, anion, oxidation, radical, valency, valence state,
 *   electrovalent, and their close forms (carbocation, ionised, divalent);
 * - an electron counted as lost, gained, removed or added, or an ionisation
 *   that is not a property name (ionisation energy and electron gain
 *   enthalpy are table values of the neutral atom and stay readable);
 * - a formula or symbol then a lone digit 1 to 8 (Fe 3, SO3 2), or an
 *   element name then a digit or number word (iron 3, copper two);
 * - a Roman numeral II to VIII as a word, or attached to a symbol (CuII);
 * - a bracketed Roman numeral, signed number or bare number: (II), (2-),
 *   (+1), (2);
 * - a name the shared name table reads as a charged species (nitrite,
 *   ammonium), or a common ion or oxidation state name (superoxide, chloride,
 *   ferric, cuprous).
 *
 * This reader only ever removes trust: a true answer makes the figure fall
 * back to the exact label rule and the generic audit, never admits one.
 */
import { elementByName } from "./elements";
import { parseFormula, splitCharge } from "./formula";
import { namedSpeciesMentions } from "./namedSpecies";

/** Every character a student or a renderer may use for a sign. */
const SIGN = /[+\-\u00b1\u02d6\u02d7\u2010-\u2015\u2212\u2213\u207a\u207b\u208a\u208b\u2795\u2796\ufb29\ufe62\ufe63\uff0b\uff0d]/gu;
/** Plain hyphens: the only sign characters a lowercase compound word may use. */
const HYPHEN = /^[-\u2010\u2011]$/u;

/** Superscript digits, caret, HTML superscript, radical and centre dots. */
const SUPERSCRIPT = /[\u00b2\u00b3\u00b9\u2070-\u2079^\u2022\u00b7\u02d9\u2219\u22c5]|<\s*sup\b/iu;

const CHARGE_WORDS = new RegExp([
  "minus", "plus", "negative(?:ly)?", "positive(?:ly)?", "neg", "pos",
  "(?:un)?charge[ds]?", "ions?", "ionic", "ioni[sz](?:ed|e|es|ing)", "zwitterions?",
  "(?:carbo|di|tri|radical )?cations?", "(?:carb|di|tri|oxo|oxy|poly)?anions?", "cationic", "anionic", "zwitterionic", "oxidation", "oxidi[sz](?:ed|es|e|ing)", "radicals?",
  "valency", "valencies", "valence\\s+states?", "electrovalen(?:t|ce|cy)",
  "(?:mono|uni|di|bi|tri|tetra|penta|hexa|poly)?valent", "(?:mono|uni|di|bi|tri)(?:negative|positive)",
  "(?:de)?protonated",
].map((word) => `\\b${word}\\b`).join("|"), "i");

/** Property names that read like a change of charge but name a table value of
 * the neutral atom: first ionisation energy, electron gain enthalpy. They are
 * removed before the ionisation and electron change words are read. */
const NEUTRAL_PROPERTY = /\b(?:(?:first|second|third|1st|2nd|3rd|successive)\s+)?ioni[sz]ation\s+(?:energ(?:y|ies)|enthalp(?:y|ies)|potentials?)\b|\belectron\s+gain\s+(?:enthalp(?:y|ies)|energ(?:y|ies))\b/gi;
/** Any other ionisation: "after ionisation" names an ion. */
const IONISATION = /\bioni[sz]ations?\b/i;

/** A formula or element symbol, a space, then one digit 1 to 8 standing alone
 * (Fe 3, SO3 2): a charge written without its sign. */
const SPACED_COUNT = /(?<![A-Za-z0-9])([A-Z][A-Za-z0-9]*)\s+([1-8])(?![0-9A-Za-z]|[.,]\d|\s*(?:%|\u00b0))/g;
/** An element name then a digit or number word: iron 3, copper two. */
const NAMED_COUNT = /\b([a-z]+)\s+(?:[1-8]|one|two|three|four|five|six|seven|eight)\b(?![0-9.,]\d)/gi;

/** An electron counted out of or into the species. */
const ELECTRON_COUNT = /\belectrons?\b/i;
const ELECTRON_CHANGE = /\b(?:lose|loses|losing|lost|loss|gain|gains|gaining|gained|remove[sd]?|removing|removal|add|adds|added|adding|addition|extra|accept(?:s|ed|ing)?|donate[sd]?|donating)\b/i;

/** Roman numerals II to VIII as their own word. */
const ROMAN_WORD = /\b(?:ii|iii|iv|v|vi|vii|viii)\b/i;
/** A Roman numeral attached to a symbol or name: CuII, FeIII, copperII. */
const ROMAN_ATTACHED = /[A-Za-z](?:II|III|IV|VI|VII|VIII)\b/;
/** A bracket holding only a Roman numeral, a signed number or a bare number. */
const BRACKETED_STATE = /[([{]\s*(?:[iv]+|\d+\s*[+\-\u2212\u2013]?|[+\-\u2212\u2013]\s*\d*)\s*[)\]}]/iu;

/** Names of charged species and oxidation states the shared name table lacks. */
const CHARGED_NAMES = new RegExp(`\\b(?:${[
  "superoxide", "peroxide", "oxide", "ozonide", "hydroxide", "chloride", "fluoride", "bromide", "iodide", "triiodide",
  "sulph?ide", "nitride", "phosphide", "hydride", "carbide", "amide", "imide", "azide", "cyanide",
  "bicarbonate", "hydrogen ?carbonate", "bisulph?ate", "hydrogen ?sulph?ate", "thiosulph?ate", "sulph?ite",
  "chromate", "dichromate", "permanganate", "manganate", "oxalate", "silicate", "borate", "bromate", "iodate", "periodate",
  "arsenate", "selenate", "tetrahydroxoborate", "ferrocyanide", "ferricyanide", "[a-z]*onium",
  "ferrous", "ferric", "cuprous", "cupric", "stannous", "stannic", "plumbous", "plumbic", "mercurous", "mercuric",
  "cobaltous", "cobaltic", "nickelous", "nickelic", "aurous", "auric", "manganous", "manganic", "chromous", "chromic",
].join("|")})s?\\b`, "i");

/** Words a hyphen may join without reading as a sign. */
const NUMBER_WORDS = /^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|single|singly|double|doubly|triple|triply|mono|uni|di|bi|tri|tetra|penta|hexa)$/i;

function plainWord(word: string): boolean {
  if (!/^[a-z]{2,}$/.test(word)) return false;
  if (NUMBER_WORDS.test(word) || ROMAN_WORD.test(word) || CHARGE_WORDS.test(word) || CHARGED_NAMES.test(word)) return false;
  if (elementByName(word) || word === "sulphur" || word === "aluminum" || word === "cesium") return false;
  return namedSpeciesMentions(word).length === 0;
}

/** True when the sign at this index is a hyphen inside a plain lowercase compound word. */
function compoundHyphen(text: string, index: number): boolean {
  if (!HYPHEN.test(text[index]!)) return false;
  const before = /([A-Za-z0-9]*)$/.exec(text.slice(0, index))![1]!;
  const after = /^([A-Za-z0-9]*)/.exec(text.slice(index + 1))![1]!;
  return plainWord(before) && plainWord(after);
}

/** A named species the shared name table reads with a nonzero charge. */
function chargedNamedSpecies(text: string): boolean {
  return namedSpeciesMentions(text).some((mention) => splitCharge(mention.formula).charge !== 0);
}

/** Names the shared table reads as neutral, so "hydrogen peroxide" is not a peroxide ion. */
function withoutNeutralNames(text: string): string {
  let result = text;
  for (const mention of [...namedSpeciesMentions(text)].reverse()) {
    if (splitCharge(mention.formula).charge !== 0) continue;
    result = `${result.slice(0, mention.start)} ${result.slice(mention.end)}`;
  }
  return result;
}

/**
 * True when the question writes anything that could be a charge. A figure
 * identity or a source certificate applies only when this is false.
 */
export function stemHasChargeLikeToken(question: string): boolean {
  const text = question.normalize("NFC");
  for (const match of text.matchAll(SIGN)) {
    if (!compoundHyphen(text, match.index)) return true;
  }
  if (SUPERSCRIPT.test(text)) return true;
  if (CHARGE_WORDS.test(text)) return true;
  const unproperty = text.replace(NEUTRAL_PROPERTY, " ");
  if (IONISATION.test(unproperty)) return true;
  if (ELECTRON_COUNT.test(unproperty) && ELECTRON_CHANGE.test(unproperty)) return true;
  for (const match of text.matchAll(SPACED_COUNT)) {
    if (parseFormula(match[1]!)) return true;
  }
  for (const match of text.matchAll(NAMED_COUNT)) {
    if (elementByName(match[1]!.toLowerCase())) return true;
  }
  if (ROMAN_WORD.test(text) || ROMAN_ATTACHED.test(text) || BRACKETED_STATE.test(text)) return true;
  if (chargedNamedSpecies(text)) return true;
  return CHARGED_NAMES.test(withoutNeutralNames(text));
}
