/** Bounded graph operations. Names, planner claims and cached formulae are not graph authority. */
import { moleculeFromName } from "./names";
import { elementCounts, neighbours, type Molecule } from "./smiles";

export interface GraphProduct {
  product: Molecule;
  /** Original heavy atom -> product atom; null only for atoms consumed by the operation. */
  atomMap: Array<number | null>;
  consumed: number[];
}
export interface StereoTreeProof { centres: number[]; count: number; rootedTrees: string[] }
const VALENCE: Record<string, number> = { C: 4, N: 3, O: 2, Br: 1 };

export function completeNeutralGraph(molecule: Molecule, maximum = 24): boolean {
  if (!molecule.atoms.length || molecule.atoms.length > maximum) return false;
  const edges = new Set<string>();
  for (const [index, atom] of molecule.atoms.entries()) {
    if (atom.index !== index || atom.charge !== 0 || !Number.isInteger(atom.hydrogens) || atom.hydrogens < 0 || !VALENCE[atom.element]) return false;
    const used = neighbours(molecule, index).reduce((sum, entry) => sum + entry.bond.order, atom.hydrogens);
    if (used !== VALENCE[atom.element]) return false;
  }
  for (const [index, bond] of molecule.bonds.entries()) {
    if (bond.index !== index || !molecule.atoms[bond.a] || !molecule.atoms[bond.b] || bond.a === bond.b || ![1, 2, 3].includes(bond.order)) return false;
    const key = [bond.a, bond.b].sort((a, b) => a - b).join(":");
    if (edges.has(key)) return false;
    edges.add(key);
  }
  const reached = new Set<number>();
  const visit = (at: number): void => { if (reached.has(at)) return; reached.add(at); for (const other of neighbours(molecule, at)) visit(other.atom); };
  visit(0);
  return reached.size === molecule.atoms.length;
}

/** Complete rooted-tree canonical forms: no depth cutoff or ring unfolding. */
export function asymmetricTreeStereo(molecule: Molecule): StereoTreeProof | null {
  if (!completeNeutralGraph(molecule, 16) || molecule.bonds.length !== molecule.atoms.length - 1
    || molecule.atoms.some(atom => atom.aromatic || !["C", "Br"].includes(atom.element))
    || molecule.bonds.some(bond => bond.order !== 1 || bond.aromatic)) return null;
  const branch = (at: number, parent: number): string => {
    const atom = molecule.atoms[at]!;
    return `${atom.element}H${atom.hydrogens}(${neighbours(molecule, at).filter(entry => entry.atom !== parent).map(entry => branch(entry.atom, at)).sort().join(",")})`;
  };
  const centres = molecule.atoms.filter(atom => {
    if (atom.element !== "C" || atom.hydrogens > 1) return false;
    const groups = neighbours(molecule, atom.index).map(entry => branch(entry.atom, atom.index));
    if (atom.hydrogens === 1) groups.push("H");
    return groups.length === 4 && new Set(groups).size === 4;
  }).map(atom => atom.index);
  const rootedTrees = centres.map(index => branch(index, -1));
  // A tree automorphism exchanging stereocentres can create meso equivalence.
  // This operator proves their absence; it does not pretend to enumerate those cases.
  if (new Set(rootedTrees).size !== centres.length) return null;
  return { centres, count: 2 ** centres.length, rootedTrees };
}

export function addRadicalHBr(reactant: Molecule): GraphProduct | null {
  if (!completeNeutralGraph(reactant, 15) || reactant.atoms.some(atom => atom.element !== "C" || atom.aromatic)
    || reactant.bonds.length !== reactant.atoms.length - 1) return null;
  const multiple = reactant.bonds.filter(bond => bond.order !== 1);
  if (multiple.length !== 1 || multiple[0]!.order !== 2) return null;
  const alkene = multiple[0]!;
  const substitution = (at: number): number => neighbours(reactant, at).filter(entry => entry.bond !== alkene && reactant.atoms[entry.atom]!.element === "C").length;
  if (substitution(alkene.a) === substitution(alkene.b)) return null;
  const brominated = substitution(alkene.a) < substitution(alkene.b) ? alkene.a : alkene.b;
  const atoms = reactant.atoms.map(atom => ({ ...atom, explicitH: false }));
  const bonds = reactant.bonds.map(bond => ({ index: bond.index, a: bond.a, b: bond.b, order: bond === alkene ? 1 as const : bond.order, aromatic: false }));
  atoms.push({ index: atoms.length, element: "Br", aromatic: false, charge: 0, hydrogens: 0, explicitH: false });
  bonds.push({ index: bonds.length, a: brominated, b: atoms.length - 1, order: 1, aromatic: false });
  const product: Molecule = { atoms, bonds };
  for (const atom of atoms) atom.hydrogens = VALENCE[atom.element]! - neighbours(product, atom.index).reduce((sum, entry) => sum + entry.bond.order, 0);
  if (!completeNeutralGraph(product, 16)) return null;
  const before = elementCounts(reactant), after = elementCounts(product);
  if (after.get("C") !== before.get("C") || after.get("H") !== (before.get("H") ?? 0) + 1 || after.get("Br") !== 1) return null;
  return { product, atomMap: reactant.atoms.map(atom => atom.index), consumed: [] };
}

export function degradePrimaryAmide(reactant: Molecule): GraphProduct | null {
  if (!completeNeutralGraph(reactant)) return null;
  const sites = reactant.atoms.flatMap(atom => {
    if (atom.element !== "C" || atom.aromatic || atom.hydrogens !== 0) return [];
    const around = neighbours(reactant, atom.index);
    const oxygen = around.find(entry => entry.bond.order === 2 && reactant.atoms[entry.atom]!.element === "O" && neighbours(reactant, entry.atom).length === 1);
    const nitrogen = around.find(entry => entry.bond.order === 1 && reactant.atoms[entry.atom]!.element === "N" && reactant.atoms[entry.atom]!.hydrogens === 2 && neighbours(reactant, entry.atom).length === 1);
    const group = around.find(entry => entry.bond.order === 1 && reactant.atoms[entry.atom]!.element === "C");
    return oxygen && nitrogen && group && around.length === 3 ? [{ carbon: atom.index, oxygen: oxygen.atom, nitrogen: nitrogen.atom, group: group.atom }] : [];
  });
  if (sites.length !== 1) return null;
  const site = sites[0]!, consumed = [site.carbon, site.oxygen];
  const atomMap: Array<number | null> = reactant.atoms.map(() => null);
  const atoms = reactant.atoms.filter(atom => !consumed.includes(atom.index)).map((atom, index) => { atomMap[atom.index] = index; return { ...atom, index }; });
  const bonds = reactant.bonds.filter(bond => !consumed.includes(bond.a) && !consumed.includes(bond.b)).map((bond, index) => ({ ...bond, index, a: atomMap[bond.a]!, b: atomMap[bond.b]! }));
  bonds.push({ index: bonds.length, a: atomMap[site.nitrogen]!, b: atomMap[site.group]!, order: 1, aromatic: false });
  const product: Molecule = { atoms, bonds };
  if (!completeNeutralGraph(product)) return null;
  const before = elementCounts(reactant), after = elementCounts(product);
  for (const element of new Set([...before.keys(), ...after.keys()])) {
    if ((before.get(element) ?? 0) - (after.get(element) ?? 0) !== (["C", "O"].includes(element) ? 1 : 0)) return null;
  }
  return { product, atomMap, consumed };
}

/** Small complete graph isomorphism for nomenclature roundtrips (aromatic Kekulé choice is immaterial). */
export function sameMolecularGraph(first: Molecule, second: Molecule): boolean {
  if (first.atoms.length !== second.atoms.length || first.bonds.length !== second.bonds.length || first.atoms.length > 24) return false;
  const key = (m: Molecule, i: number): string => { const a = m.atoms[i]!; return [a.element, a.charge, a.hydrogens, a.aromatic, neighbours(m, i).length].join(":"); };
  const edge = (m: Molecule, a: number, b: number): string => { const bond = m.bonds.find(entry => entry.a === a && entry.b === b || entry.a === b && entry.b === a); return !bond ? "" : bond.aromatic ? "ar" : String(bond.order); };
  const map = new Map<number, number>(), used = new Set<number>();
  const search = (): boolean => {
    if (map.size === first.atoms.length) return true;
    const next = first.atoms.filter(a => !map.has(a.index)).map(a => ({ a: a.index, candidates: second.atoms.filter(b => !used.has(b.index) && key(first, a.index) === key(second, b.index)).map(b => b.index) })).sort((a, b) => a.candidates.length - b.candidates.length)[0]!;
    for (const candidate of next.candidates) {
      if ([...map].some(([a, b]) => edge(first, next.a, a) !== edge(second, candidate, b))) continue;
      map.set(next.a, candidate); used.add(candidate);
      if (search()) return true;
      map.delete(next.a); used.delete(candidate);
    }
    return false;
  };
  return search();
}

/** Anti-Markovnikov HBr product whose graph is exactly a terminal bromoalkane.
 * Branched or internal bromides stay unnamed until a complete name is proved. */
export function radicalBromoalkaneName(product: Molecule): string | null {
  const bromines = product.atoms.filter(atom => atom.element === "Br");
  const carbons = product.atoms.filter(atom => atom.element === "C");
  if (bromines.length !== 1 || carbons.length + bromines.length !== product.atoms.length) return null;
  if (product.atoms.some(atom => atom.charge !== 0 || atom.aromatic)
    || product.bonds.some(bond => bond.order !== 1 || bond.aromatic || bond.direction)
    || product.bonds.length !== product.atoms.length - 1) return null;
  const carbonNeighbours = (index: number): number => neighbours(product, index).filter(entry => product.atoms[entry.atom]!.element === "C").length;
  if (carbons.some(atom => carbonNeighbours(atom.index) > 2)) return null;
  const attached = neighbours(product, bromines[0]!.index);
  if (attached.length !== 1 || product.atoms[attached[0]!.atom]!.element !== "C") return null;
  const attachedCarbons = carbonNeighbours(attached[0]!.atom);
  if (attachedCarbons !== (carbons.length === 1 ? 0 : 1)) return null;
  const root = ["meth", "eth", "prop", "but", "pent", "hex", "hept", "oct", "non", "dec"][carbons.length - 1];
  if (!root) return null;
  const name = carbons.length <= 2 ? `bromo${root}ane` : `1-bromo${root}ane`;
  const parsed = moleculeFromName(name);
  return parsed && sameMolecularGraph(product, parsed) ? name : null;
}

/** A functional-group naming operation, checked through the existing full-name parser. */
export function primaryAmineName(product: Molecule): string | null {
  const nitrogens = product.atoms.filter(atom => atom.element === "N" && atom.hydrogens === 2 && neighbours(product, atom.index).length === 1);
  const carbons = product.atoms.filter(atom => atom.element === "C");
  if (nitrogens.length !== 1 || carbons.length + 1 !== product.atoms.length) return null;
  const attached = neighbours(product, nitrogens[0]!.index)[0]!.atom;
  let name: string | null = null;
  if (carbons.length === 6 && carbons.every(atom => atom.aromatic) && product.bonds.length === 7) name = "aniline";
  else if (carbons.every(atom => !atom.aromatic && neighbours(product, atom.index).filter(entry => product.atoms[entry.atom]!.element === "C").length <= 2)
    && product.bonds.every(bond => bond.order === 1) && product.bonds.length === product.atoms.length - 1
    && neighbours(product, attached).filter(entry => product.atoms[entry.atom]!.element === "C").length <= 1) {
    const root = ["", "meth", "eth", "prop", "but", "pent", "hex", "hept", "oct", "non", "dec"][carbons.length];
    if (root) name = carbons.length <= 2 ? `${root}anamine` : `${root}an-1-amine`;
  }
  const parsed = name ? moleculeFromName(name) : null;
  return parsed && sameMolecularGraph(product, parsed) ? name : null;
}

/** Recheck a proposed product by the allowed atom edit, not by a proof flag or name. */
export function sourceGraphProductHolds(kind: "radical_hbr" | "hofmann", reactant: Molecule, proposed: GraphProduct): boolean {
  const expected = kind === "radical_hbr" ? addRadicalHBr(reactant) : degradePrimaryAmide(reactant);
  if (!expected || proposed.product.smiles !== undefined || proposed.product.formulaOverride !== undefined || proposed.product.stereo !== undefined) return false;
  const atomKey = (molecule: Molecule): string[] => molecule.atoms.map(atom => [atom.index, atom.element, atom.aromatic, atom.charge, atom.hydrogens, atom.explicitH].join(":"));
  const bondKey = (molecule: Molecule): string[] => molecule.bonds.map(bond => [bond.index, bond.a, bond.b, bond.order, bond.aromatic, bond.direction ?? ""].join(":"));
  if (JSON.stringify(atomKey(proposed.product)) !== JSON.stringify(atomKey(expected.product))
    || JSON.stringify(bondKey(proposed.product)) !== JSON.stringify(bondKey(expected.product))
    || JSON.stringify(proposed.atomMap) !== JSON.stringify(expected.atomMap)
    || JSON.stringify(proposed.consumed) !== JSON.stringify(expected.consumed)) return false;
  if (kind === "radical_hbr") {
    if (proposed.product.name === undefined) return true;
    const proved = radicalBromoalkaneName(expected.product);
    return proved !== null && proposed.product.name === proved;
  }
  return proposed.product.name === primaryAmineName(expected.product);
}
