import type { ParsedFormula } from "../formula";

/** Molecular VSEPR does not determine the topology of a salt or bulk oxide. */
export function isDiscreteVseprCandidate(formula: ParsedFormula): boolean {
  if (formula.charge !== 0) return true;
  // The heavier alkaline-earth compounds need an ionic/lattice builder.
  // BeCl2 remains in the established molecular (gas-phase) subset.
  if (formula.atoms.some((atom) => atom.element.block === "s" && atom.element.group === 2 && atom.symbol !== "Be")) return false;
  const oxygen = formula.atoms.find((atom) => atom.symbol === "O");
  const other = formula.atoms.find((atom) => atom.symbol !== "O");
  // Group-14 dioxides other than CO2 are extended solids in the ordinary
  // syllabus state. Their formula unit cannot supply an O=M=O molecule.
  if (formula.atoms.length === 2 && oxygen?.count === 2 && other?.count === 1 && other.element.group === 14 && other.symbol !== "C") return false;
  return true;
}
