import type { ParsedComplex } from "../formula";

const PLANAR_D8_METALS = new Map<string, readonly number[]>([
  ["Pt", [2]], ["Pd", [2]], ["Au", [3]], ["Rh", [1]], ["Ir", [1]],
]);
const HALIDES = new Set(["F", "Cl", "Br", "I"]);

/** Supported CN4 policy shared by CFT and coordination, with no rank inference. */
export function fourCoordinateGeometry(complex: ParsedComplex): "square_planar" | "tetrahedral" | null {
  if (complex.coordinationNumber !== 4) return null;
  const metal = complex.metal.symbol;
  const oxidation = complex.oxidationState;
  const keys = complex.ligands.map((ligand) => ligand.spec.key);
  if ((PLANAR_D8_METALS.get(metal) ?? []).includes(oxidation)) return "square_planar";
  if (metal === "Ni" && oxidation === 2) {
    if (keys.every((key) => key === "CN" || key === "dmg")) return "square_planar";
    if (keys.every((key) => HALIDES.has(key) || key === "PPh3") && keys.some((key) => HALIDES.has(key))) return "tetrahedral";
    // Other Ni(II) donor sets need geometry evidence that rank alone cannot
    // supply. Decline rather than turn mixed strong sets into tetrahedra.
    return null;
  }
  if (metal === "Cu" && oxidation === 2) {
    if (keys.every((key) => key === "NH3" || key === "en")) return "square_planar";
    return keys.every((key) => HALIDES.has(key)) ? "tetrahedral" : null;
  }
  return "tetrahedral";
}
