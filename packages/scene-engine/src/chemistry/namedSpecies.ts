/** Shared chemical-name authority. Order is retained for the Lewis reader. */
export const NAMED_SPECIES: ReadonlyArray<readonly [RegExp, string]> = [
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

export interface NamedSpeciesMention { readonly formula: string; readonly start: number; readonly end: number }

/** Prefer the complete name, so hydrogen cyanide is not also a cyanide ion. */
export function namedSpeciesMentions(text: string): NamedSpeciesMention[] {
  const candidates = NAMED_SPECIES.flatMap(([pattern, formula]) =>
    [...text.toLowerCase().matchAll(new RegExp(pattern.source, "g"))].map((match) =>
      ({ formula, start: match.index, end: match.index + match[0].length })));
  const selected: NamedSpeciesMention[] = [];
  for (const candidate of candidates.sort((a, b) => b.end - b.start - (a.end - a.start))) {
    if (!selected.some((other) => candidate.start < other.end && candidate.end > other.start)) selected.push(candidate);
  }
  return selected.sort((a, b) => a.start - b.start);
}
