/** Original-question authority for a requested electrode-deposition mass. */
import { elementByName, elementBySymbol } from "./elements";
import { formulaTokens } from "./formula";
import { chemistryQuantityInventoryOwned, readChemistryQuantityDeclaration, readChemistryQuantityInventoryDeclaration, type ChemistryReading, type ChemistryQuantityConsumption, type ChemistryQuantityDeclaration } from "./quantityReader";

const MASS_REQUEST = /\b(?:mass\s+of\s+(?:the\s+)?([a-z]+)|deposited\s+([a-z]+)\s+mass)\b/gi;

/** A source process relation, not a generic aqueous-solution cue. A rejected
 * numerical payload remains claimed here so a missing value cannot default. */
export function claimsElectrodeDepositionMass(question: string): boolean {
  const lower = question.toLowerCase();
  if (!/\bmass\b/.test(lower) || !/\bdeposited|\bdeposition\b/.test(lower)) return false;
  const process = /\belectrolys(?:ed|is|ing)|\belectrolyz(?:ed|ing)|\bcurrent\b[^!?;]{0,100}\b(?:pass(?:es|ed)?|flow(?:s|ed)?)\b[^!?;]{0,70}\bthrough\b/;
  const scope = /\b(?:electrodes?|cathode)\b/;
  const active = lower.split(/[;!?]|\.(?=\s|$)/).some(clause => process.test(clause)
    && !/\bno\s+current\b|\b(?:is|are|was|were|does|do)\s+not\b/.test(clause));
  return active && scope.test(lower);
}

export interface DepositionMassSource {
  readonly question: string;
  readonly symbol: string;
  readonly electrons: number;
  readonly ampere: number;
  readonly seconds: number;
  readonly molarMass: number;
  readonly faraday: number;
  readonly charge: number;
  readonly grams: number;
  readonly bindings: readonly ChemistryQuantityConsumption[];
  readonly molarMassBasis: "source" | "element_reference";
  readonly faradayBasis: "source" | "reference";
}

export function readDepositionMassSource(question: string, deposit: { symbol: string; n: number }): DepositionMassSource | null {
  if (!claimsElectrodeDepositionMass(question)) return null;
  if (!closedDepositionWords(question, deposit)) return null;
  return readDepositionMassInputs(question, deposit, false);
}

/** The words a plain deposition stem with no electrode word may use, once its numbers, formulas and metal are gone. */
const PLAIN_DEPOSITION_WORDS = new Set((
  "a an the of is are by with using for and at on in take given if "
  + "aqueous molten solution electrolysed electrolyzed electrolysis current passed through "
  + "find calculate determine what mass deposited inert electrode electrodes cathode anode "
  + "passes carbon graphite platinum faraday constant m alumina dissolved cryolite"
).split(" "));
const QUANTITY_WITH_UNIT = /\b\d+(?:\.\d+)?\s*(?:amperes?|amps?|a|minutes?|mins?|min|seconds?|secs?|s|hours?|hrs?|h|g\s*\/\s*mol|g\s*mol\^?\(?-1\)?|c\s*\/\s*mol|c\s*mol\^?\(?-1\)?)(?![a-z0-9])/gi;

/**
 * Whether every word outside the numbers, formulas and the metal is in the closed
 * set. A qualifier on the current ("only half", "at 80% efficiency") or anything
 * else the reader cannot own must not get a mass computed as if it were absent.
 */
function closedDepositionWords(question: string, deposit: { symbol: string }): boolean {
  const element = elementBySymbol(deposit.symbol);
  if (!element) return false;
  let rest = question.replace(QUANTITY_WITH_UNIT, " ");
  for (const token of [...formulaTokens(question), ...question.match(/\b[A-Z][A-Za-z0-9()]*\d[A-Za-z0-9()]*\b/g) ?? []]) rest = rest.split(token).join(" ");
  const name = new RegExp(String.raw`\b(?:${element.name}|${element.symbol}|M\s*\(\s*${element.symbol}\s*\)|molar\s+mass|F)\b`, "gi");
  const words = rest.replace(name, " ").toLowerCase().replace(/=/g, " ").split(/[\s.,;:?!()]+/).filter(Boolean);
  return words.every((word) => PLAIN_DEPOSITION_WORDS.has(word));
}

/** A stem that names no electrode. Unread words leave the figure without a mass, never with one computed anyway. */
export function readPlainDepositionMass(question: string, deposit: { symbol: string; n: number }): DepositionMassSource | null {
  return closedDepositionWords(question, deposit) ? readDepositionMassInputs(question, deposit, true) : null;
}

function readDepositionMassInputs(question: string, deposit: { symbol: string; n: number }, plainStem: boolean): DepositionMassSource | null {
  const element = elementBySymbol(deposit.symbol);
  if (!element || !Number.isInteger(deposit.n) || deposit.n <= 0) return null;
  // The requested metal must be the independently resolved cathode product.
  let requestedMetal = false;
  for (const match of question.matchAll(MASS_REQUEST)) {
    const name = match[1] ?? match[2]!;
    const target = elementByName(name) ?? elementBySymbol(name);
    if (!target || target.symbol !== deposit.symbol) return null;
    requestedMetal = true;
  }
  if (!requestedMetal) return null;

  const current = readChemistryQuantityInventoryDeclaration({ question, dimension: "current", targetUnit: "A", owner: "deposition current" });
  const time = readChemistryQuantityInventoryDeclaration({ question, dimension: "time", targetUnit: "s", owner: "deposition duration" });
  // "Cu = 63.5 g/mol" is read for the deposited metal only. A value for another element stays unowned below.
  const massCue = plainStem
    ? new RegExp(String.raw`\bmolar\s+mass(?:\s+of\s+([A-Za-z]+))?\s*(?:is|=)|\bM\s*\(\s*([A-Z][a-z]?)\s*\)\s*=|\b(${deposit.symbol})\s*=`, "gi")
    : /\bmolar\s+mass(?:\s+of\s+([A-Za-z]+))?\s*(?:is|=)|\bM\s*\(\s*([A-Z][a-z]?)\s*\)\s*=/gi;
  for (const match of question.matchAll(massCue)) {
    const owner = match[1] ?? match[2] ?? match[3];
    if (owner && (elementByName(owner) ?? elementBySymbol(owner))?.symbol !== deposit.symbol) return null;
  }
  const mass = readChemistryQuantityDeclaration({ question, after: new RegExp(massCue.source, "i"), dimension: "molar_mass", targetUnit: "g/mol", owner: "deposited element molar mass", allowAgreeingRepeats: true });
  const faraday = readChemistryQuantityDeclaration({ question, after: /\bF\s*=|\bFaraday(?:'s)?\s*(?:constant)?\s*(?:is|=)/, dimension: "faraday_constant", targetUnit: "C/mol", owner: "Faraday constant", allowAgreeingRepeats: true });
  if (current.state !== "valid" || time.state !== "valid" || mass.state === "invalid" || faraday.state === "invalid") return null;
  // Explicitly unreadable current/time is not absent just because it supplied
  // no scalar to the inventory. The role reader independently closes each cue.
  // A plain stem's closed words already refuse an unread value ("two amps"), and
  // this cue would refuse its ordinary "a 2.0 A current for 30 minutes".
  if (!plainStem) for (const [after, dimension, targetUnit] of [
    [/\bcurrent(?:\s+of)?\b/, "current", "A"],
    [/\bfor\b/, "time", "s"],
  ] as const) {
    if (readChemistryQuantityDeclaration({ question, after, dimension, targetUnit, owner: dimension, allowAgreeingRepeats: true }).state === "invalid") return null;
  }
  const bindings: ChemistryQuantityConsumption[] = [];
  const consume = (reading: ChemistryReading, owner: string) => { bindings.push({ reading, owner }); return reading.value; };
  const consumeRepeated = (declaration: Extract<ChemistryQuantityDeclaration, { state: "valid" }>, owner: string): number => {
    for (const occurrence of declaration.occurrences) if (occurrence.read.ok) consume(occurrence.read.reading, owner);
    return declaration.reading.value;
  };
  const ampere = consume(current.reading, "deposition current");
  const seconds = consume(time.reading, "deposition duration");
  const molarMass = mass.state === "valid" ? consumeRepeated(mass, "molar mass") : element.mass;
  const f = faraday.state === "valid" ? consumeRepeated(faraday, "Faraday constant") : 96500;
  for (const dimension of ["current", "time", "molar_mass", "faraday_constant"] as const) {
    if (!chemistryQuantityInventoryOwned(question, dimension, bindings.filter(item => item.reading.dimension === dimension))) return null;
  }
  // A nonideal efficiency or other numerical condition is not silently
  // replaced by the complete-deposition idealization of this bounded model.
  if (!chemistryQuantityInventoryOwned(question, "dimensionless", [])) return null;
  if (![ampere, seconds, molarMass, f].every(value => Number.isFinite(value) && value > 0)) return null;
  const charge = ampere * seconds;
  const grams = molarMass * charge / (deposit.n * f);
  if (!Number.isFinite(grams) || grams <= 0) return null;
  return { question, symbol: deposit.symbol, electrons: deposit.n, ampere, seconds, molarMass, faraday: f, charge, grams, bindings, molarMassBasis: mass.state === "valid" ? "source" : "element_reference", faradayBasis: faraday.state === "valid" ? "source" : "reference" };
}
