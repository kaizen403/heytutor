/**
 * The chemistry family catalog: which chemistry figure a stem gets.
 *
 * Each family module owns its cue (`is<Name>Stem`, with vetoes) and its
 * builder. This file only orders them: when several cues fire, the earlier
 * family wins the first attempt and the rest follow in order, exactly as the
 * physics families are tried in `synthesizeFromFamilies`. Families are
 * registered by `registerChemistryFamilies` once the modules exist, so this
 * seam has no import cycle with the family scene layer.
 */
import type { ChemFamilyBuilder } from "./sceneKit";
import { isChemistryStem } from "./classify";

export const CHEMISTRY_SCENE_FAMILIES = [
  // VSEPR sits ahead of the coordination families: it declines a complex
  // itself, so "which of PF5, BrF5, PCl5, [Ni(CN)4]2- is square pyramidal"
  // draws the three p-block species instead of the one complex.
  "chem_vsepr",
  "chem_lewis",
  "chem_mo",
  "chem_orbital",
  "chem_cft",
  "chem_coordination",
  "chem_electrochem",
  "chem_unit_cell",
  "chem_kinetics",
  "chem_thermo",
  "chem_solutions",
  "chem_periodic",
  // Organic goes last: its cue fires on any compound name, while every family
  // above fires on a specific ask. "CH3COOH titrated with NaOH" is a
  // titration curve, not a drawing of acetic acid.
  "chem_organic",
] as const;

export type ChemistrySceneFamily = (typeof CHEMISTRY_SCENE_FAMILIES)[number];

/** What the tutor is told the figure is, in words a student would use. */
export const CHEMISTRY_FAMILY_NAMES: Record<ChemistrySceneFamily, string> = {
  chem_organic: "organic skeletal structure",
  chem_vsepr: "VSEPR molecular shape",
  chem_lewis: "Lewis structure",
  chem_mo: "molecular orbital energy level diagram",
  chem_orbital: "orbital box diagram",
  chem_cft: "crystal field splitting diagram",
  chem_coordination: "coordination complex structure",
  chem_electrochem: "electrochemical cell",
  chem_unit_cell: "crystal unit cell",
  chem_kinetics: "chemical kinetics graph",
  chem_thermo: "reaction energy or thermodynamics graph",
  chem_solutions: "titration or solution graph",
  chem_periodic: "periodic trend graph",
};

/** Human name for any family id; physics families keep their underscores-as-spaces form. */
export function describeSceneFamily(family: string): string {
  return isChemistrySceneFamily(family) ? CHEMISTRY_FAMILY_NAMES[family] : family.replace(/_/g, " ");
}

const CHEMISTRY_FAMILY_SET = new Set<string>(CHEMISTRY_SCENE_FAMILIES);

export function isChemistrySceneFamily(value: string): value is ChemistrySceneFamily {
  return CHEMISTRY_FAMILY_SET.has(value);
}

export interface ChemistryFamilyEntry {
  readonly family: ChemistrySceneFamily;
  readonly cue: (question: string) => boolean;
  readonly build: ChemFamilyBuilder;
}

const REGISTRY = new Map<ChemistrySceneFamily, ChemistryFamilyEntry>();

export function registerChemistryFamily(entry: ChemistryFamilyEntry): void {
  REGISTRY.set(entry.family, entry);
}

export function chemistryFamilyBuilder(family: string): ChemFamilyBuilder | null {
  return isChemistrySceneFamily(family) ? REGISTRY.get(family)?.build ?? null : null;
}

/** Chemistry families whose cue fires on this stem, in catalog order. */
export function inferChemistryFamilies(question: string): ChemistrySceneFamily[] {
  const trimmed = question.trim();
  if (!trimmed) return [];
  const matches: ChemistrySceneFamily[] = [];
  for (const family of CHEMISTRY_SCENE_FAMILIES) {
    const entry = REGISTRY.get(family);
    if (entry && entry.cue(trimmed)) matches.push(family);
  }
  return matches;
}

/** A stem is chemistry when the subject classifier says so or a chemistry cue fires. */
export function isChemistryQuestion(question: string): boolean {
  return isChemistryStem(question) || inferChemistryFamilies(question).length > 0;
}
