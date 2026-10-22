/** Existing deterministic chemical aliases, shared by emitters and source identity.
 * Entries are identities rather than question-routing templates. */
export const REGISTERED_CHEMISTRY_SPECIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bwater\b/, "H2O"], [/\bammonia\b/, "NH3"], [/\bmethane\b/, "CH4"], [/\bethane\b/, "C2H6"],
  [/\bethene\b|\bethylene\b/, "C2H4"], [/\bethyne\b|\bacetylene\b/, "C2H2"], [/\bozone\b/, "O3"],
  [/carbon dioxide/, "CO2"], [/carbon monoxide/, "CO"], [/\bnitrate\b/, "NO3-"], [/\bnitrite\b/, "NO2-"],
  [/\bsulph?ate\b/, "SO4^(2-)"], [/\bcarbonate\b/, "CO3^(2-)"], [/\bphosphate\b/, "PO4^(3-)"], [/\bperchlorate\b/, "ClO4-"],
  [/\bchlorate\b/, "ClO3-"], [/\bchlorite\b/, "ClO2-"], [/\bhypochlorite\b/, "ClO-"], [/\bammonium\b/, "NH4+"],
  [/\bhydronium\b|\boxonium\b/, "H3O+"], [/hydrogen cyanide/, "HCN"], [/\bcyanide\b/, "CN-"], [/nitrogen dioxide/, "NO2"],
  [/sulph?ur dioxide/, "SO2"], [/sulph?ur trioxide/, "SO3"], [/nitrous oxide|dinitrogen (?:mon)?oxide/, "N2O"],
  [/\bdinitrogen\b|nitrogen molecule/, "N2"], [/\bacetate\b|\bethanoate\b/, "CH3COO-"], [/\bformate\b|\bmethanoate\b/, "HCOO-"],
  [/\bhydroxide\b/, "OH-"], [/\bazide\b/, "N3-"], [/boron trifluoride/, "BF3"], [/phosphorus pentachloride/, "PCl5"],
  [/sulph?ur hexafluoride/, "SF6"], [/xenon tetrafluoride/, "XeF4"], [/xenon difluoride/, "XeF2"], [/hydrogen peroxide/, "H2O2"],
  [/\bhydrazine\b/, "N2H4"], [/formaldehyde|\bmethanal\b/, "CH2O"], [/\bphosgene\b/, "COCl2"], [/\bthiocyanate\b/, "SCN-"],
  [/\bcyanate\b/, "NCO-"], [/nitric acid/, "HNO3"], [/sulph?uric acid/, "H2SO4"], [/phosphoric acid/, "H3PO4"],
  [/perchloric acid/, "HClO4"], [/carbonic acid/, "H2CO3"], [/hydrogen fluoride/, "HF"], [/hydrogen chloride/, "HCl"],
  [/\boxygen molecule\b|\bdioxygen\b/, "O2"], [/\bfluorine molecule\b/, "F2"], [/nitric oxide|nitrogen monoxide/, "NO"],
  [/\bsulphite\b|\bsulfite\b/, "SO3^(2-)"], [/\bphosphine\b/, "PH3"], [/hydrogen sulph?ide/, "H2S"],
];

/** Only an entire registered name resolves. Formula validity is checked by the
 * caller's ordinary independent resolver; ambiguous mapped formulas stay red. */
export function registeredChemistryFormula(text: string): string | null {
  if (text.trim() !== text) return null;
  const matches = REGISTERED_CHEMISTRY_SPECIES.filter(([pattern]) => new RegExp(`^(?:${pattern.source})$`, "iu").test(text));
  const formulas = [...new Set(matches.map(([, formula]) => formula))];
  return formulas.length === 1 ? formulas[0]! : null;
}
