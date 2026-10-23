/**
 * What a chemistry family builder parsed from the stem and drew, recorded by
 * the builder itself on the document object it returns.
 *
 * The record lives in a module-private WeakMap keyed by the exact object the
 * builder created, so no caller can attach, edit or forge one: a document
 * that came from anywhere else (a plan, a repair, a copy) has no record. The
 * obligation reader rebuilds the figure from the original question and reads
 * the record of that fresh object only, after proving the candidate is the
 * same figure. Labels and captions never stand in for this record.
 */
import type { SceneDocument } from "../types";

export interface CertifiedChemistryAtom {
  /** The drawn atom mark. */
  readonly entityId: string;
  /** Element symbol of the atom, from the builder's parsed structure. */
  readonly symbol: string;
  /** True only for the atom the family itself placed at the centre. */
  readonly central: boolean;
}

export interface CertifiedChemistrySpecies {
  /** Formula as the builder parsed it from the stem (e.g. "NH3", "SO4^(2-)"). */
  readonly formula: string;
  /** The drawn mark that names this species on the board. */
  readonly entityId: string;
  readonly atoms: readonly CertifiedChemistryAtom[];
  /** Direct bonds between atom entity ids, from the parsed structure. */
  readonly bonds: ReadonlyArray<readonly [string, string]>;
  /** False when the family places no central atom (diatomics, chains, MO, orbital boxes). */
  readonly knowsCentral: boolean;
}

export interface CertifiedChemistryElementSet {
  /** Element symbols of every plotted point, in plotted order. */
  readonly symbols: readonly string[];
  /** The drawn mark that carries the whole plotted series. */
  readonly entityId: string;
}

export interface ChemistryFigureIdentity {
  readonly species: readonly CertifiedChemistrySpecies[];
  readonly elementSets: readonly CertifiedChemistryElementSet[];
}

const IDENTITY = new WeakMap<SceneDocument, ChemistryFigureIdentity>();

/** Builders call this on the document they are about to return. */
export function recordChemistryFigureIdentity(document: SceneDocument, identity: ChemistryFigureIdentity): SceneDocument {
  IDENTITY.set(document, identity);
  return document;
}

/** The record of a document a builder returned; null for every other object. */
export function builtChemistryFigureIdentity(document: SceneDocument | null | undefined): ChemistryFigureIdentity | null {
  return document ? IDENTITY.get(document) ?? null : null;
}
