/**
 * A laid-out molecule onto a ChemScene in the skeletal convention: carbons
 * are unlabelled vertices, heteroatoms carry their symbol with attached
 * hydrogens (OH, NH_2, Cl), collapsed groups carry their group text (NO_2),
 * aromatic six-rings are a hexagon with an inner circle, other double and
 * triple bonds show their strokes, and the compound's name or formula sits
 * under the structure as a pinned caption.
 */
import type { ChemScene } from "../sceneKit";
import { layoutBounds, type LaidOutMolecule, type Vec2 } from "./layout";
import { molecularFormula, neighbours } from "./smiles";

export interface RenderedMolecule {
  /** Every entity id drawn for this molecule (for a reveal group). */
  readonly ids: string[];
  /** Ids of labelled atoms, for label_attached assertions. */
  readonly labelledAtomIds: string[];
  readonly bounds: { minX: number; maxX: number; minY: number; maxY: number };
  readonly labels: string[];
}

function subscript(count: number): string {
  return count > 1 ? `_${count}` : "";
}

/** Symbol plus its hydrogens and charge, the way a skeletal formula labels a heteroatom. */
function atomLabel(laid: LaidOutMolecule, index: number): string | null {
  const molecule = laid.molecule;
  const atom = molecule.atoms[index]!;
  const group = laid.groupLabels.get(index);
  if (group) return group;
  const heavy = neighbours(molecule, index).filter((entry) => !laid.hidden.has(entry.atom)).length;
  const chargeText = atom.charge === 0 ? "" : `^(${Math.abs(atom.charge) > 1 ? Math.abs(atom.charge) : ""}${atom.charge > 0 ? "+" : "-"})`;
  if (atom.element === "C") {
    if (heavy === 0) return `CH${subscript(atom.hydrogens)}${chargeText}`;
    if (atom.charge !== 0) return `C${chargeText}`;
    return null;
  }
  const hydrogens = atom.hydrogens > 0 ? `H${subscript(atom.hydrogens)}` : "";
  return `${atom.element}${hydrogens}${chargeText}`;
}

/**
 * Clearance a bond keeps from a labelled vertex. The label is set in a
 * fixed pixel font while bonds are world units, so the clearance is the
 * label's half width in pixels divided by the figure's pixels per unit.
 */
function labelTrim(text: string | null, pxPerUnit: number): number {
  if (!text) return 0;
  const glyphs = text.replace(/_|\^\(|\)/g, "").length;
  const halfWidthPx = 4.5 * glyphs + 5;
  return Math.min(0.7, Math.max(0.2, halfWidthPx / pxPerUnit));
}

/** Pixels per world unit the compiler will give a figure of this extent (drawing zone about 700 by 340 px). */
export function estimatePxPerUnit(width: number, height: number): number {
  return Math.max(20, Math.min(700 / Math.max(width, 1), 340 / Math.max(height, 1)));
}

/** Caption under a structure: the name when it fits, else the formula. */
export function structureCaption(laid: LaidOutMolecule): string {
  const name = laid.molecule.name ?? "";
  if (name && name.length <= 16) return name;
  const formula = molecularFormula(laid.molecule, true);
  if (formula.length <= 16) return formula;
  return name.slice(0, 16);
}

/**
 * Draw one molecule with its atoms offset by `origin`. Ids are prefixed so
 * several molecules share a scene. Returns the ids drawn and the bounds.
 */
export function renderMolecule(c: ChemScene, laid: LaidOutMolecule, prefix: string, origin: Vec2, caption: string | null, pxPerUnit = 100): RenderedMolecule {
  const molecule = laid.molecule;
  const ids: string[] = [];
  const labelledAtomIds: string[] = [];
  const labels: string[] = [];
  const at = (index: number): Vec2 => ({ x: laid.positions[index]!.x + origin.x, y: laid.positions[index]!.y + origin.y });
  const atomId = (index: number): string => `${prefix}_a${index}`;
  const aromaticEdges = new Set<string>();
  for (const ring of laid.aromaticSixRings) {
    ring.forEach((atom, position) => {
      const next = ring[(position + 1) % ring.length]!;
      aromaticEdges.add(atom < next ? `${atom}-${next}` : `${next}-${atom}`);
    });
  }
  for (const atom of molecule.atoms) {
    if (laid.hidden.has(atom.index)) continue;
    const text = atomLabel(laid, atom.index);
    const id = c.atom(atomId(atom.index), atom.element, at(atom.index), { text, role: `${atom.element} atom` });
    ids.push(id);
    if (text) { labelledAtomIds.push(id); labels.push(text); }
  }
  for (const bond of molecule.bonds) {
    if (laid.hidden.has(bond.a) || laid.hidden.has(bond.b)) continue;
    const key = bond.a < bond.b ? `${bond.a}-${bond.b}` : `${bond.b}-${bond.a}`;
    const order = aromaticEdges.has(key) ? 1 : bond.order;
    const drawn = c.bond(`${prefix}_b${bond.index}`, atomId(bond.a), atomId(bond.b), {
      order,
      spacing: 0.13,
      trimStart: labelTrim(atomLabel(laid, bond.a), pxPerUnit),
      trimEnd: labelTrim(atomLabel(laid, bond.b), pxPerUnit),
    });
    ids.push(...drawn);
  }
  laid.aromaticSixRings.forEach((ring, index) => {
    const centre = ring.reduce((acc, atom) => ({ x: acc.x + at(atom).x / ring.length, y: acc.y + at(atom).y / ring.length }), { x: 0, y: 0 });
    const helper = c.scene.helper(`${prefix}_ar${index}_c`, centre, "aromatic ring centre helper");
    ids.push(c.scene.circle(`${prefix}_ar${index}`, helper, 0.52, "aromatic ring"));
  });
  laid.extraLabels.forEach((extra, index) => {
    const id = c.atom(`${prefix}_h${index}`, "H", { x: extra.at.x + origin.x, y: extra.at.y + origin.y }, { text: extra.text, role: "H atom" });
    ids.push(id);
    ids.push(...c.bond(`${prefix}_hb${index}`, atomId(extra.atom), id));
    labels.push(extra.text);
  });
  const bounds = layoutBounds(laid);
  const shifted = { minX: bounds.minX + origin.x, maxX: bounds.maxX + origin.x, minY: bounds.minY + origin.y, maxY: bounds.maxY + origin.y };
  if (caption) {
    const id = c.text(`${prefix}_name`, { x: (shifted.minX + shifted.maxX) / 2, y: shifted.minY - 0.3 }, caption, "compound name");
    ids.push(id);
    labels.push(caption);
    shifted.minY -= 0.7;
  }
  // A dashed panel around structure and caption: real geometry, so the
  // auto-fit keeps every pinned label of this molecule inside the view.
  const width = Math.max(shifted.maxX - shifted.minX, caption ? 0.28 * caption.length + 0.4 : 1) + 0.3;
  const height = shifted.maxY - shifted.minY + 0.3;
  const centre = { x: (shifted.minX + shifted.maxX) / 2, y: (shifted.minY + shifted.maxY) / 2 };
  const centreId = c.scene.helper(`${prefix}_panel_c`, centre, "structure panel centre helper");
  const panelId = c.scene.rectangle(`${prefix}_panel`, centreId, width, height, "structure panel");
  const entity = c.scene.entities.find((candidate) => candidate.id === panelId);
  if (entity) entity.provenance = { dashed: true, strokeRole: "construction" };
  ids.push(panelId);
  return { ids, labelledAtomIds, bounds: { minX: centre.x - width / 2, maxX: centre.x + width / 2, minY: centre.y - height / 2, maxY: centre.y + height / 2 }, labels };
}

