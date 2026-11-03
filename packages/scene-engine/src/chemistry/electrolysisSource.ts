/** Original-question authority for a requested electrode-deposition mass. */
import { elementByName, elementBySymbol } from "./elements";
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
  const massCue = /\bmolar\s+mass(?:\s+of\s+([A-Za-z]+))?\s*(?:is|=)|\bM\s*\(\s*([A-Z][a-z]?)\s*\)\s*=/gi;
  for (const match of question.matchAll(massCue)) {
    const owner = match[1] ?? match[2];
    if (owner && (elementByName(owner) ?? elementBySymbol(owner))?.symbol !== deposit.symbol) return null;
  }
  const mass = readChemistryQuantityDeclaration({ question, after: new RegExp(massCue.source, "i"), dimension: "molar_mass", targetUnit: "g/mol", owner: "deposited element molar mass", allowAgreeingRepeats: true });
  const faraday = readChemistryQuantityDeclaration({ question, after: /\bF\s*=|\bFaraday(?:'s)?\s*(?:constant)?\s*(?:is|=)/, dimension: "faraday_constant", targetUnit: "C/mol", owner: "Faraday constant", allowAgreeingRepeats: true });
  if (current.state !== "valid" || time.state !== "valid" || mass.state === "invalid" || faraday.state === "invalid") return null;
  // Explicitly unreadable current/time is not absent just because it supplied
  // no scalar to the inventory. The role reader independently closes each cue.
  for (const [after, dimension, targetUnit] of [
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
