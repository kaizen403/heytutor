import type { Molecule } from "../organic/smiles";

/** The direct drawing seam also accepts graphs that did not pass the parser. */
export function supportedMoleculeGraph(molecule: Molecule): boolean {
  if (!molecule || !Array.isArray(molecule.atoms) || !Array.isArray(molecule.bonds)) return false;
  if (molecule.atoms.length === 0 || molecule.atoms.length > 64 || molecule.atoms.filter((a) => a?.element !== "H").length > 24) return false;
  // The current drawing block supports resolved alkene geometry, not tetrahedral stereo/isotopes.
  if (molecule.smiles && /@|\[\d/.test(molecule.smiles)) return false;
  const used = Array<number>(molecule.atoms.length).fill(0);
  const edges = new Set<string>();
  for (const bond of molecule.bonds) {
    if (!bond || !Number.isInteger(bond.index) || molecule.bonds[bond.index] !== bond || ![1, 2, 3].includes(bond.order)) return false;
    if (!Number.isInteger(bond.a) || !Number.isInteger(bond.b) || !molecule.atoms[bond.a] || !molecule.atoms[bond.b] || bond.a === bond.b) return false;
    const key = [bond.a, bond.b].sort((a, b) => a - b).join(":");
    if (edges.has(key)) return false;
    edges.add(key);
    used[bond.a]! += bond.order;
    used[bond.b]! += bond.order;
  }
  const caps: Record<string, number> = { H: 1, B: 3, C: 4, N: 3, O: 2, P: 5, S: 6, Si: 4, F: 1, Cl: 1, Br: 1, I: 1 };
  for (const atom of molecule.atoms) {
    if (!atom || !Number.isInteger(atom.index) || molecule.atoms[atom.index] !== atom || !(atom.element in caps)) return false;
    if (!Number.isInteger(atom.charge) || Math.abs(atom.charge) > 1 || !Number.isInteger(atom.hydrogens) || atom.hydrogens < 0 || typeof atom.aromatic !== "boolean" || typeof atom.explicitH !== "boolean") return false;
    let cap = caps[atom.element]!;
    if (atom.charge !== 0) {
      if (["N", "O"].includes(atom.element)) cap += atom.charge;
      else if (["C", "B"].includes(atom.element)) cap -= Math.abs(atom.charge);
      else if (atom.element === "P") cap = 3 + atom.charge;
      else if (atom.element === "S") cap = 2 + atom.charge;
      else return false;
    }
    if (used[atom.index]! + atom.hydrogens > cap) return false;
  }
  const visited = new Set<number>([0]);
  const queue = [0];
  for (let i = 0; i < queue.length; i += 1) {
    for (const bond of molecule.bonds) {
      const next = bond.a === queue[i] ? bond.b : bond.b === queue[i] ? bond.a : null;
      if (next !== null && !visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  if (visited.size !== molecule.atoms.length) return false;
  if (molecule.stereo && (!Number.isInteger(molecule.stereo.bond) || molecule.bonds[molecule.stereo.bond]?.order !== 2 || !["cis", "trans"].includes(molecule.stereo.kind))) return false;
  return true;
}
