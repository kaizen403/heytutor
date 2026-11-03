/**
 * What a physics archetype generator constructed from the question, recorded
 * by the generator itself on the document object it returns.
 *
 * The record lives in a module-private WeakMap keyed by the exact object the
 * generator created (and the validated copy the archetype layer returns), so
 * no caller can attach, edit or forge one: a document that came from anywhere
 * else (a plan, a repair, a copy) has no record. The obligation reader
 * rebuilds the figure from the original question and reads the record of that
 * fresh object only, after proving the candidate is the same figure. Labels
 * never stand in for this record.
 */
import type { SceneDocument } from "../types";

/** The physical role a constructed body plays in its figure. */
export type ArchetypeBodyRole = "projectile" | "trajectory" | "ground" | "river" | "bank" | "current";

export interface CertifiedArchetypeBody {
  readonly role: ArchetypeBodyRole;
  /** The drawn mark that carries this body. */
  readonly entityId: string;
  /** Marks this body uses up; a region named by its bounds consumes none. */
  readonly consumes: readonly string[];
  /** Words the generator can vouch for from what it computed ("parabolic", "near"). */
  readonly attributes: readonly string[];
}

export interface ArchetypeFigureIdentity {
  readonly archetype: string;
  readonly bodies: readonly CertifiedArchetypeBody[];
}

const IDENTITY = new WeakMap<SceneDocument, ArchetypeFigureIdentity>();

/** Generators call this on the document they are about to return. */
export function recordArchetypeFigureIdentity(document: SceneDocument, identity: ArchetypeFigureIdentity): SceneDocument {
  IDENTITY.set(document, identity);
  return document;
}

/** The archetype layer keeps the record on the validated copy it returns. */
export function carryArchetypeFigureIdentity(from: SceneDocument, to: SceneDocument): void {
  const identity = IDENTITY.get(from);
  if (identity) IDENTITY.set(to, identity);
}

/** The record of a document a generator returned; null for every other object. */
export function builtArchetypeFigureIdentity(document: SceneDocument | null | undefined): ArchetypeFigureIdentity | null {
  return document ? IDENTITY.get(document) ?? null : null;
}
