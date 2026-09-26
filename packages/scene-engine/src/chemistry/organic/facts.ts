/**
 * Facts a stem asks about a named compound: molecular formula, degree of
 * unsaturation, hybridisation of each carbon, chiral centres by a
 * neighbour-distinctness test, and the functional groups present. Pure
 * functions over the molecular graph so other lanes can call them.
 */
import { elementCounts, molecularFormula, neighbours, type Molecule } from "./smiles";

export type Hybridisation = "sp" | "sp2" | "sp3";

export interface OrganicFacts {
  readonly formula: string;
  readonly formulaPlain: string;
  readonly degreeOfUnsaturation: number;
  readonly hybridisation: ReadonlyMap<number, Hybridisation>;
  readonly counts: { sp: number; sp2: number; sp3: number };
  readonly chiralCentres: number[];
  readonly functionalGroups: string[];
}

function carbonHybridisation(molecule: Molecule, atom: number): Hybridisation | null {
  const entry = molecule.atoms[atom];
  if (!entry || entry.element !== "C") return null;
  const orders = neighbours(molecule, atom).map((around) => around.bond.order);
  if (entry.aromatic) return "sp2";
  if (orders.includes(3) || orders.filter((order) => order === 2).length >= 2) return "sp";
  if (orders.includes(2)) return "sp2";
  if (entry.charge === 1 && orders.length + entry.hydrogens === 3) return "sp2";
  return "sp3";
}

/** (2C + 2 + N - H - X) / 2 for a neutral molecule; halogens count as hydrogens. */
function degreeOfUnsaturation(molecule: Molecule): number {
  const counts = elementCounts(molecule);
  const c = counts.get("C") ?? 0;
  const n = counts.get("N") ?? 0;
  const h = counts.get("H") ?? 0;
  const x = ["F", "Cl", "Br", "I"].reduce((sum, symbol) => sum + (counts.get(symbol) ?? 0), 0);
  return (2 * c + 2 + n - h - x) / 2;
}

/**
 * A canonical string for the branch entered at `from` coming from `via`,
 * to depth `depth`. Two branches with the same string are treated as the
 * same substituent, so a carbon is chiral when its four branches (implicit
 * hydrogens included) all differ.
 */
function branchSignature(molecule: Molecule, from: number, via: number, depth: number): string {
  const atom = molecule.atoms[from]!;
  const head = `${atom.element}${atom.hydrogens}${atom.charge}`;
  if (depth === 0) return head;
  const children = neighbours(molecule, from)
    .filter((entry) => entry.atom !== via)
    .map((entry) => `${entry.bond.order}${branchSignature(molecule, entry.atom, from, depth - 1)}`)
    .sort();
  return `${head}(${children.join(",")})`;
}

function chiralCentres(molecule: Molecule): number[] {
  const centres: number[] = [];
  for (const atom of molecule.atoms) {
    if (atom.element !== "C" || carbonHybridisation(molecule, atom.index) !== "sp3") continue;
    const around = neighbours(molecule, atom.index);
    if (around.length + atom.hydrogens !== 4 || atom.hydrogens > 1) continue;
    const signatures = around.map((entry) => branchSignature(molecule, entry.atom, atom.index, 8));
    if (atom.hydrogens === 1) signatures.push("H");
    if (new Set(signatures).size === 4) centres.push(atom.index);
  }
  return centres;
}

function functionalGroups(molecule: Molecule): string[] {
  const found = new Set<string>();
  const element = (index: number): string => molecule.atoms[index]!.element;
  for (const atom of molecule.atoms) {
    const around = neighbours(molecule, atom.index);
    if (atom.element === "C") {
      const oxo = around.filter((entry) => entry.bond.order === 2 && element(entry.atom) === "O");
      const singleO = around.filter((entry) => entry.bond.order === 1 && element(entry.atom) === "O");
      const singleN = around.filter((entry) => entry.bond.order === 1 && element(entry.atom) === "N");
      const halogen = around.filter((entry) => ["F", "Cl", "Br", "I"].includes(element(entry.atom)));
      const carbons = around.filter((entry) => element(entry.atom) === "C");
      if (oxo.length === 1) {
        const hydroxyl = singleO.find((entry) => molecule.atoms[entry.atom]!.hydrogens === 1 && neighbours(molecule, entry.atom).length === 1);
        const etherO = singleO.find((entry) => neighbours(molecule, entry.atom).length === 2);
        if (hydroxyl) found.add("carboxylic acid");
        else if (etherO) {
          const otherC = neighbours(molecule, etherO.atom).find((entry) => entry.atom !== atom.index);
          const otherIsAcyl = otherC && neighbours(molecule, otherC.atom).some((entry) => entry.bond.order === 2 && element(entry.atom) === "O");
          found.add(otherIsAcyl ? "acid anhydride" : "ester");
        }
        else if (singleN.length === 1) found.add("amide");
        else if (halogen.length === 1) found.add("acyl halide");
        else if (atom.hydrogens >= 1 || carbons.length + atom.hydrogens < 2) found.add("aldehyde");
        else if (carbons.length === 2) found.add("ketone");
      }
      if (around.some((entry) => entry.bond.order === 3 && element(entry.atom) === "N")) found.add("nitrile");
      if (around.some((entry) => entry.bond.order === 3 && element(entry.atom) === "C")) found.add("alkyne");
      if (around.some((entry) => entry.bond.order === 2 && element(entry.atom) === "C" && !entry.bond.aromatic)) found.add("alkene");
      if (atom.aromatic) found.add("aromatic ring");
      if (halogen.length > 0 && oxo.length === 0) found.add(atom.aromatic ? "aryl halide" : "alkyl halide");
    }
    if (atom.element === "O") {
      const carbons = around.filter((entry) => element(entry.atom) === "C");
      if (atom.hydrogens === 1 && carbons.length === 1) {
        const carbon = carbons[0]!;
        const acyl = neighbours(molecule, carbon.atom).some((entry) => entry.bond.order === 2 && element(entry.atom) === "O");
        if (!acyl) found.add(molecule.atoms[carbon.atom]!.aromatic ? "phenol" : "alcohol");
      }
      if (carbons.length === 2 && atom.hydrogens === 0) {
        const acyl = carbons.some((carbon) => neighbours(molecule, carbon.atom).some((entry) => entry.bond.order === 2 && element(entry.atom) === "O"));
        if (!acyl) found.add("ether");
      }
    }
    if (atom.element === "N" && atom.charge === 0) {
      const carbons = around.filter((entry) => element(entry.atom) === "C" && entry.bond.order === 1);
      const acyl = carbons.some((carbon) => neighbours(molecule, carbon.atom).some((entry) => entry.bond.order === 2 && element(entry.atom) === "O"));
      if (!acyl && carbons.length === around.length && carbons.length > 0) {
        found.add(atom.hydrogens === 2 ? "primary amine" : atom.hydrogens === 1 ? "secondary amine" : "tertiary amine");
      }
    }
    if (atom.element === "N" && atom.charge === 1 && around.filter((entry) => element(entry.atom) === "O").length === 2) found.add("nitro");
    if (atom.element === "S" && around.filter((entry) => element(entry.atom) === "O").length === 3) found.add("sulphonic acid");
  }
  return [...found];
}

export function organicFacts(molecule: Molecule): OrganicFacts {
  const hybridisation = new Map<number, Hybridisation>();
  const counts = { sp: 0, sp2: 0, sp3: 0 };
  for (const atom of molecule.atoms) {
    const kind = carbonHybridisation(molecule, atom.index);
    if (!kind) continue;
    hybridisation.set(atom.index, kind);
    counts[kind] += 1;
  }
  return {
    formula: molecularFormula(molecule, true),
    formulaPlain: molecularFormula(molecule, false),
    degreeOfUnsaturation: degreeOfUnsaturation(molecule),
    hybridisation,
    counts,
    chiralCentres: chiralCentres(molecule),
    functionalGroups: functionalGroups(molecule),
  };
}

