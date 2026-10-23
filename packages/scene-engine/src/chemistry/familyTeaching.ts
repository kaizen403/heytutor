/** Reviewed engine facts, selected only by an engine-owned teaching family id. */
export const CONDUCTANCE_TEACHING_FAMILY = "chem_electrochem_conductance" as const;

// NCERT Electrochemistry §2.4.2 and Mainz physical chemistry conductivity lab;
// source links and all required conditions are pinned by the app consumer gate.
const conductanceNotes: readonly string[] = Object.freeze([
      "Λ_m is molar conductivity, κ is conductivity, and c is molar concentration. In consistent SI units Λ_m = κ/c: κ is in S m^-1, c in mol m^-3, and Λ_m in S m^2 mol^-1. With κ in S cm^-1 and c in mol L^-1, Λ_m = 1000κ/c in S cm^2 mol^-1.",
      "On dilution, conductivity κ decreases because there are fewer ions per unit volume, while molar conductivity Λ_m increases. These are different quantities; the Λ_m curve is not a plot of κ.",
      "The strong-electrolyte square-root relation Λ_m ≈ Λ_m° − A√c applies in the dilute, low-concentration limit at fixed solvent and temperature. It is not an exact law for arbitrary or concentrated solutions. A depends on the solvent, temperature and electrolyte type.",
      "Λ_m° is the limiting molar conductivity as c tends to zero. Kohlrausch's law of independent migration concerns this limit: Λ_m° = ν_+λ_+° + ν_-λ_-°. The weak-electrolyte curve is not linear in √c, so use ionic limiting contributions rather than the strong-electrolyte straight-line extrapolation to determine its limit.",
      "The plotted curves use schematic normalized coordinates, not a calibrated concentration scale. Do not read a physical concentration or a measured Λ_m value from their coordinates. For an example, keep it symbolic unless concentration units, coefficients and dilute validity are supplied; an arbitrary √c = 1 does not establish dilute validity.",
]);
const notesByFamily: ReadonlyMap<string, readonly string[]> = new Map([
  [CONDUCTANCE_TEACHING_FAMILY, conductanceNotes],
]);
const noNotes: readonly string[] = Object.freeze([]);

export function chemistryFamilyTeachingNotes(familyId: string | null): readonly string[] {
  return familyId === null ? noNotes : notesByFamily.get(familyId) ?? noNotes;
}
