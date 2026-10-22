import type { SceneDocument } from "../../types";

export const CHEMISTRY_REPRESENTATION_VERSION = "chemistry-representation/v1" as const;

/** Offsets refer to the original question, before notation/case normalization. */
export interface ChemistrySourceSpan { start: number; end: number; text: string }
export type ChemistryStructureResolver = "lewis" | "vsepr" | "organic" | "coordination";
export interface ChemistryNodeBinding {
  nodeKey: string;
  entityId: string;
  /** Formal charges are separate structural symbols, never captions. */
  chargeEntityId?: string;
  /** All nonbonded electrons shown for this node, one id per electron. */
  electronEntityIds: string[];
}
export interface ChemistryBondBinding {
  a: string;
  b: string;
  /** One id per drawn stroke, or one wedge polygon. */
  entityIds: string[];
}
export interface ChemistrySpeciesBinding {
  speciesKey: string;
  source: ChemistrySourceSpan;
  resolver: ChemistryStructureResolver;
  /** Recomputed from the source; a caller's graph key is never authority. */
  identityKey: string;
  nodes: ChemistryNodeBinding[];
  bonds: ChemistryBondBinding[];
  entityIds: string[];
}
export type ChemistryStructuralRule =
  | "sigma_bonds" | "pi_bonds" | "lone_pairs" | "valence_electrons"
  | "electron_count" | "charge" | "formal_charge" | "locant";
export interface ChemistryStructuralQuantity {
  quantityId: string;
  speciesKey: string;
  rule: ChemistryStructuralRule;
  nodeKey?: string;
  locantIndex?: number;
}
export interface ChemistryStructuralText {
  owner: "entity" | "annotation";
  ownerId: string;
  start: number;
  end: number;
  speciesKey: string;
  rule: ChemistryStructuralRule | "species";
  nodeKey?: string;
  locantIndex?: number;
}
export interface ChemistryRepresentation {
  version: typeof CHEMISTRY_REPRESENTATION_VERSION;
  species: ChemistrySpeciesBinding[];
  structuralEntityIds: string[];
  structuralQuantities: ChemistryStructuralQuantity[];
  structuralTexts: ChemistryStructuralText[];
}
export interface ChemistryStructureSymbolProvenance {
  version: typeof CHEMISTRY_REPRESENTATION_VERSION;
  role: "structure_symbol";
}
export type ChemistryRepresentationDocument = SceneDocument & {
  source: SceneDocument["source"] & { chemistryRepresentation: ChemistryRepresentation };
};
