/**
 * Hybridisation of each carbon in a written bond line.
 *
 * VSEPR must not split CH2=C=O or CH3-CH=CH-C≡N into fragment molecules.
 * This figure keeps the closed line and labels every carbon from its bond
 * orders: two double bonds or one triple bond is sp, one double bond is sp2,
 * and a carbon with only single bonds is sp3. Percentage s character is the
 * textbook value for a type that is actually present.
 */
import type { SceneDocument } from "../../types";
import { readClosedBondLines, type BondLine } from "../bondingFigures";
import { ChemScene, chemStem } from "../sceneKit";

type Hybrid = "sp" | "sp2" | "sp3";

const HYBRID_LABEL: Record<Hybrid, string> = { sp: "sp", sp2: "sp^2", sp3: "sp^3" };
const S_CHARACTER: Record<Hybrid, string> = { sp: "sp 50% s", sp2: "sp^2 33.3% s", sp3: "sp^3 25% s" };
const MAX_LINES = 3;
const MAX_ATOMS = 8;

export type CarbonHybridisationRequest = "skip" | "draw" | "decline";

function carbonHybridisationAsked(question: string): boolean {
  const stem = chemStem(question);
  return /hybridi[sz]/.test(stem) && /\bcarbons?\b/.test(stem);
}

function sCharacterAsked(question: string): boolean {
  return /\bs[\s-]*character\b|\bpercentage\s+s\b/.test(chemStem(question));
}

/** Hybrid types the stem names. A bare "sp" does not also mean sp2 or sp3. */
function explicitHybridTypes(stem: string): Hybrid[] {
  const types: Hybrid[] = [];
  if (/\bsp\s*\^?\s*3(?!\s*d)/.test(stem)) types.push("sp3");
  if (/\bsp\s*\^?\s*2/.test(stem)) types.push("sp2");
  if (/\bsp(?!\s*\^?\s*[23d])/.test(stem)) types.push("sp");
  return types;
}

export function carbonHybridisationOf(line: BondLine, index: number): Hybrid | null {
  const atom = line.atoms[index];
  if (!atom || atom.element !== "C") return null;
  const orders = line.bonds.filter((bond) => bond.a === index || bond.b === index).map((bond) => bond.order);
  if (orders.includes(3) || orders.filter((order) => order === 2).length >= 2) return "sp";
  if (orders.includes(2)) return "sp2";
  return "sp3";
}

function presentHybrids(lines: readonly BondLine[]): Set<Hybrid> | null {
  const present = new Set<Hybrid>();
  for (const line of lines) {
    let carbons = 0;
    line.atoms.forEach((_, index) => {
      const hybrid = carbonHybridisationOf(line, index);
      if (!hybrid) return;
      carbons += 1;
      present.add(hybrid);
    });
    if (carbons === 0) return null;
  }
  return present;
}

export function carbonHybridisationRequest(question: string): CarbonHybridisationRequest {
  if (!carbonHybridisationAsked(question)) return "skip";
  const read = readClosedBondLines(question);
  if (read.status === "none") return "skip";
  if (read.status === "incomplete") return "decline";
  if (read.lines.length > MAX_LINES || read.lines.some((line) => line.atoms.length > MAX_ATOMS)) return "decline";
  const present = presentHybrids(read.lines);
  if (!present) return "decline";
  if (explicitHybridTypes(chemStem(question)).some((type) => !present.has(type))) return "decline";
  return "draw";
}

export function buildCarbonHybridisationScene(question: string): SceneDocument | null {
  if (carbonHybridisationRequest(question) !== "draw") return null;
  const read = readClosedBondLines(question);
  if (read.status !== "ok") return null;
  const present = presentHybrids(read.lines);
  if (!present) return null;
  const showCharacter = sCharacterAsked(question);
  const c = new ChemScene(question, "hybridisation of each carbon in the written bond line", "chem_organic");
  const spacing = 2;
  const panel = MAX_ATOMS * spacing;
  const ids: string[] = [];
  read.lines.forEach((line, panelIndex) => {
    const x0 = panelIndex * panel;
    const panelIds: string[] = [];
    line.atoms.forEach((atom, index) => {
      const id = c.atom(`c_${panelIndex}_${index}`, atom.label, { x: x0 + index * spacing, y: 0 }, { role: `${atom.element} atom` });
      panelIds.push(id);
      const hybrid = carbonHybridisationOf(line, index);
      if (!hybrid) return;
      panelIds.push(c.text(`h_${panelIndex}_${index}`, { x: x0 + index * spacing, y: -0.95 }, HYBRID_LABEL[hybrid], `${atom.label} is ${HYBRID_LABEL[hybrid]}`));
    });
    line.bonds.forEach((bond, index) => {
      panelIds.push(...c.bond(`b_${panelIndex}_${index}`, `c_${panelIndex}_${bond.a}`, `c_${panelIndex}_${bond.b}`, {
        order: bond.order,
        role: `bond order ${bond.order}`,
      }));
    });
    ids.push(...panelIds);
    c.scene.group(`line_${panelIndex + 1}`, panelIds, "one closed bond line with the hybridisation of each carbon");
  });
  if (showCharacter) {
    const legend = (["sp", "sp2", "sp3"] as const).filter((type) => present.has(type));
    const span = (read.lines.length - 1) * panel + (read.lines[read.lines.length - 1]!.atoms.length - 1) * spacing;
    legend.forEach((type, index) => {
      const x = legend.length === 1 ? span / 2 : (span * index) / (legend.length - 1);
      ids.push(c.text(`s_${type}`, { x, y: -1.9 }, S_CHARACTER[type], `percentage s character of ${HYBRID_LABEL[type]}`));
    });
  }
  const caption = [...present].map((type) => HYBRID_LABEL[type]).join(", ");
  return c.build({ caption: `carbon hybridisation: ${caption}`.slice(0, 60) });
}
