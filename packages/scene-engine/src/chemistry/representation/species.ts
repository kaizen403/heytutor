import { registeredChemistryFormula } from "./registeredSpecies";
import { parseComplex, parseFormula, normalizeChemistryText } from "../formula";
import { lewisStructure } from "../lewis";
import { vseprGeometry } from "../vsepr";
import { moleculeFromName } from "../organic/names";
import { molecularFormula, type Molecule } from "../organic/smiles";
import type { ChemistrySourceSpan, ChemistryStructureResolver, ChemistryStructuralRule } from "./types";

export interface ResolvedChemistryNode {
  key: string; label: string | null; charge: number; nonbondedElectrons: number;
}
export interface ResolvedChemistrySpecies {
  identityKey: string;
  formulaKey: string | null;
  nodes: ResolvedChemistryNode[];
  bonds: Array<{ a: string; b: string; order: number }>;
  facts: Partial<Record<ChemistryStructuralRule, number>>;
  locants: number[];
  molecule?: Molecule;
}

/** N3-/O2- cannot distinguish a monatomic charge from a molecular subscript. */
export function ambiguousChemistryFormula(text: string): boolean {
  return /^(?:N3-|O2-)$/u.test(normalizeChemistryText(text).replace(/_/g, ""));
}

export function chemistryFormulaKey(text: string): string | null {
  if (ambiguousChemistryFormula(text)) return null;
  const parsed = parseFormula(text.replace(/_(\d+)/g, "$1"));
  if (!parsed || parsed.atoms.some((atom) => !Number.isSafeInteger(atom.count) || atom.count <= 0)) return null;
  return `${parsed.atoms.map((atom) => `${atom.symbol}:${atom.count}`).sort().join("|")};q:${parsed.charge}`;
}

function graphKey(molecule: Molecule): string {
  return JSON.stringify({
    atoms: molecule.atoms.map((atom) => [atom.element, atom.hydrogens, atom.charge, atom.aromatic]),
    bonds: molecule.bonds.map((bond) => [Math.min(bond.a, bond.b), Math.max(bond.a, bond.b), bond.order]).sort(),
  });
}

/** Match resolved name aliases by graph isomorphism, never by molecular formula alone. */
export function sameOrganicGraph(first: Molecule, second: Molecule): boolean {
  if (first.atoms.length !== second.atoms.length || first.bonds.length !== second.bonds.length) return false;
  const atomKey = (m: Molecule, i: number): string => {
    const a = m.atoms[i]!;
    const orders = m.bonds.filter((b) => b.a === i || b.b === i).map((b) => b.order).sort();
    return JSON.stringify([a.element, a.hydrogens, a.charge, a.aromatic, orders]);
  };
  const edge = (m: Molecule, a: number, b: number): number => m.bonds.find((bond) =>
    (bond.a === a && bond.b === b) || (bond.b === a && bond.a === b))?.order ?? 0;
  const candidates = first.atoms.map((_, i) => second.atoms.flatMap((__, j) => atomKey(first, i) === atomKey(second, j) ? [j] : []));
  const order = first.atoms.map((_, i) => i).sort((a, b) => candidates[a]!.length - candidates[b]!.length);
  const mapping = new Map<number, number>();
  const used = new Set<number>();
  const visit = (position: number): boolean => {
    if (position === order.length) return true;
    const a = order[position]!;
    for (const b of candidates[a]!) {
      if (used.has(b) || [...mapping].some(([x, y]) => edge(first, a, x) !== edge(second, b, y))) continue;
      mapping.set(a, b); used.add(b);
      if (visit(position + 1)) return true;
      mapping.delete(a); used.delete(b);
    }
    return false;
  };
  return visit(0);
}

export function resolveChemistryStructure(text: string, resolver: ChemistryStructureResolver): ResolvedChemistrySpecies | null {
  if (ambiguousChemistryFormula(text)) return null;
  const structureText = registeredChemistryFormula(text) ?? text;
  const formulaKey = chemistryFormulaKey(structureText);
  if (resolver === "organic") {
    const molecule = moleculeFromName(text);
    if (!molecule || molecule.atoms.length > 32) return null;
    return {
      identityKey: `graph:${graphKey(molecule)}`, formulaKey: chemistryFormulaKey(molecularFormula(molecule, false)), molecule,
      nodes: molecule.atoms.map((atom) => ({
        key: `a${atom.index}`, label: atom.element === "C" && atom.charge === 0 ? null
          : `${atom.element}${atom.hydrogens ? `H${atom.hydrogens > 1 ? `_${atom.hydrogens}` : ""}` : ""}${chargeLabel(atom.charge, true)}`,
        charge: atom.charge, nonbondedElectrons: 0,
      })),
      bonds: molecule.bonds.map((bond) => ({ a: `a${bond.a}`, b: `a${bond.b}`, order: bond.order })),
      facts: { sigma_bonds: molecule.bonds.length, pi_bonds: molecule.bonds.reduce((n, b) => n + b.order - 1, 0), charge: molecule.atoms.reduce((n, a) => n + a.charge, 0) },
      // A locant is accepted only inside the completely resolved name; numeric captions do not inherit it.
      locants: [...text.matchAll(/(?<![A-Za-z\d])(\d+)(?=[,-])/g)].map((match) => Number(match[1])),
    };
  }
  if (resolver === "coordination") {
    const complex = parseComplex(text);
    if (!complex || complex.counterIon !== null || complex.ligands.some((l) => l.spec.denticity !== 1)) return null;
    const nodes: ResolvedChemistryNode[] = [{ key: "metal", label: complex.metal.symbol, charge: 0, nonbondedElectrons: 0 }];
    for (const ligand of complex.ligands) for (let index = 0; index < ligand.count; index += 1) {
      nodes.push({ key: `${ligand.spec.key}:${index}`, label: ligand.spec.label, charge: 0, nonbondedElectrons: 0 });
    }
    return { identityKey: complexIdentity(text)!, formulaKey, nodes, bonds: nodes.slice(1).map((n) => ({ a: "metal", b: n.key, order: 1 })), facts: { charge: complex.charge, sigma_bonds: complex.coordinationNumber }, locants: [] };
  }
  if (!formulaKey) return null;
  if (resolver === "lewis") {
    const result = lewisStructure(structureText);
    if (!result) return null;
    return {
      identityKey: `formula:${formulaKey}`, formulaKey,
      nodes: result.atoms.map((atom) => ({ key: atom.id, label: atom.symbol, charge: atom.formalCharge, nonbondedElectrons: atom.lonePairs * 2 + atom.unpaired })),
      bonds: result.bonds.map((bond) => ({ a: bond.a, b: bond.b, order: bond.order })),
      facts: { sigma_bonds: result.sigmaBonds, pi_bonds: result.piBonds, lone_pairs: result.lonePairs, valence_electrons: result.totalValenceElectrons, charge: result.formula.charge,
        electron_count: result.formula.atoms.reduce((n, a) => n + a.element.z * a.count, 0) - result.formula.charge },
      locants: [],
    };
  }
  const result = vseprGeometry(structureText);
  if (!result) return null;
  const nodes: ResolvedChemistryNode[] = [{ key: "central", label: result.central.symbol, charge: 0, nonbondedElectrons: result.lonePairs * 2 - (result.unpairedElectron ? 1 : 0) }];
  for (const ligand of result.ligands) for (let index = 0; index < ligand.count; index += 1) {
    nodes.push({ key: `${ligand.label}:${index}`, label: ligand.label, charge: 0, nonbondedElectrons: 0 });
  }
  return {
    identityKey: `formula:${formulaKey}`, formulaKey, nodes,
    // Shape representations certify adjacency, not a measurement or a Lewis bond order.
    bonds: nodes.slice(1).map((node) => ({ a: "central", b: node.key, order: 1 })),
    facts: { sigma_bonds: result.bondPairs, lone_pairs: result.lonePairs - (result.unpairedElectron ? 1 : 0), charge: result.charge }, locants: [],
  };
}

export function chargeLabel(charge: number, scripted = false): string {
  if (charge === 0) return "";
  const label = `${Math.abs(charge) > 1 ? Math.abs(charge) : ""}${charge > 0 ? "+" : "-"}`;
  return scripted ? `^(${label})` : label;
}

export function complexIdentity(text: string): string | null {
  const complex = parseComplex(text);
  if (!complex) return null;
  return `complex:${complex.metal.symbol};${complex.ligands.map((ligand) => `${ligand.spec.key}:${ligand.count}`).sort().join("|")};q:${complex.charge};counter:${complex.counterIon ?? ""}`;
}

/** Classification is independent of the candidate, so omitted species cannot disappear from obligations. */
export function chemistrySpeciesIdentity(text: string): { kind: "formula" | "complex" | "organic"; key: string; molecule?: Molecule } | null {
  if (ambiguousChemistryFormula(text)) return null;
  const complex = complexIdentity(text);
  if (complex) return { kind: "complex", key: complex };
  const formula = chemistryFormulaKey(registeredChemistryFormula(text) ?? text);
  if (formula) return { kind: "formula", key: `formula:${formula}` };
  const molecule = moleculeFromName(text);
  return molecule ? { kind: "organic", key: `graph:${graphKey(molecule)}`, molecule } : null;
}

/** One source authority seam for emitters and adversarial metadata. A source
 * substring is never a species when adjacent notation continues its formula,
 * charge, group or hydrate. Unsupported continuations decline atomically. */
export function checkedChemistrySourceIdentity(question: string, source: ChemistrySourceSpan, expectedIdentityKey: string): ReturnType<typeof chemistrySpeciesIdentity> {
  const { start, end, text } = source;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > question.length || question.slice(start, end) !== text || text.trim() !== text) return null;
  const continuation = /[\p{L}\p{N}_^+\-−–—⁺⁻⁽⁾₍₎()[\]{}·•∙/\\*=\u200c\u200d]/u;
  const before = [...question.slice(0, start)].at(-1) ?? "";
  const after = [...question.slice(end)][0] ?? "";
  if (continuation.test(before) || continuation.test(after)) return null;
  // A sentence stop is a delimiter; an adjacent dotted hydrate is not.
  if ((after === "." || after === ":") && continuation.test([...question.slice(end + 1)][0] ?? "")) return null;
  if (before === "." && continuation.test([...question.slice(0, start - 1)].at(-1) ?? "")) return null;
  // Explicit charge/subscript notation may contain spaces. A terminal sign
  // after whitespace is also a charge, rather than a second source species.
  const remainder = question.slice(end);
  if (/^\s+[_^⁺⁻]/u.test(remainder) || /^\s+[+\-−–—](?=\s*(?:[.,;!?)\]]|$))/u.test(remainder)) return null;
  const identity = chemistrySpeciesIdentity(text);
  return identity?.key === expectedIdentityKey ? identity : null;
}
