import type { SceneDocument } from "../../types";
import { ChemScene } from "../sceneKit";
import { layoutBounds, layoutMolecule } from "./layout";
import { estimatePxPerUnit, panelLabelLines, renderMolecule, structureCaption } from "./render";
import type { Molecule } from "./smiles";

export interface MoleculePanelItem {
  readonly molecule: Molecule;
  readonly label?: string;
}

export interface MoleculePanelArrow {
  /** Zero-based molecule indices. Direction may be reversed. */
  readonly from: number;
  readonly to: number;
  readonly label?: string;
}

/** Explicit chemistry facts only. Shares the family graph layout/rendering,
 * but never reads the question to decide connectivity, products or reagents. */
export function buildMoleculePanelScene(
  question: string,
  items: readonly MoleculePanelItem[],
  arrows: readonly MoleculePanelArrow[],
): SceneDocument {
  const slots = items.map(({ molecule, label }, index) => {
    const laid = layoutMolecule(molecule);
    if (!laid) throw new Error(`molecules[${index}] has topology outside the supported planar layout`);
    const caption = label ?? structureCaption(laid);
    const bounds = layoutBounds(laid);
    const width = Math.max(bounds.maxX - bounds.minX, 0.28 * caption.length + 0.4) + 0.3;
    return { laid, caption, bounds, width };
  });
  const gaps = slots.slice(1).map((_, index) => {
    const arrow = arrows.find((a) => Math.abs(a.from - a.to) === 1 && Math.min(a.from, a.to) === index);
    return arrow ? Math.max(2.2, 0.28 * (arrow.label?.length ?? 0) + 0.8) : 1.2;
  });
  const totalWidth = slots.reduce((sum, slot) => sum + slot.width, 0) + gaps.reduce((sum, gap) => sum + gap, 0);
  const height = Math.max(...slots.map((slot) => slot.bounds.maxY - slot.bounds.minY)) + 1;
  const pxPerUnit = estimatePxPerUnit(totalWidth, height);
  const c = new ChemScene(question, "explicit molecule panel", "chem_organic");
  const arrowLabel = (id: string, at: { x: number; y: number }, label: string): string[] => {
    const lines = panelLabelLines(label);
    const spacing = 56 / pxPerUnit;
    return lines.map((line, index) => c.text(`${id}_label${index ? `_${index}` : ""}`, { x: at.x, y: at.y + (lines.length - 1 - index) * spacing }, line, "reagent or condition"));
  };
  const placements: Array<{ x: number; top: number }> = [];
  let cursor = 0;
  slots.forEach((slot, index) => {
    const centreX = cursor + slot.width / 2;
    const origin = { x: centreX - (slot.bounds.minX + slot.bounds.maxX) / 2, y: -(slot.bounds.minY + slot.bounds.maxY) / 2 };
    const drawn = renderMolecule(c, slot.laid, `m${index}`, origin, slot.caption, pxPerUnit, { captionClearance: Math.max(0.3, 56 / pxPerUnit), captionLines: panelLabelLines(slot.caption) });
    placements.push({ x: centreX, top: drawn.bounds.maxY });
    // Unlabelled carbon vertices are construction anchors, not required dots.
    const visibleIds = drawn.ids.filter((id) => c.scene.entities.find((entity) => entity.id === id)?.kind !== "point");
    c.scene.labelled(...drawn.labelledAtomIds);
    c.scene.group(`m${index}_group`, visibleIds, `structure ${slot.caption}`);
    cursor += slot.width;
    if (index === slots.length - 1) return;
    const gap = gaps[index]!;
    const arrow = arrows.find((a) => Math.abs(a.from - a.to) === 1 && Math.min(a.from, a.to) === index);
    if (arrow) {
      const tail = { x: cursor + 0.35, y: 0 };
      const head = { x: cursor + gap - 0.35, y: 0 };
      const id = `reaction_arrow_${index}`;
      const ids = [c.arrow(id, arrow.from < arrow.to ? tail : head, arrow.from < arrow.to ? head : tail, "reaction arrow")];
      if (arrow.label) ids.push(...arrowLabel(id, { x: cursor + gap / 2, y: 0.55 }, arrow.label));
      c.scene.group(`${id}_group`, ids, arrow.label ?? "reaction", [`m${index}_group`]);
    }
    cursor += gap;
  });
  // Nonadjacent edges use separate lanes above the structures, never through
  // an intermediate molecule. The planner specifies topology, not waypoints.
  arrows.filter((arrow) => Math.abs(arrow.from - arrow.to) > 1).forEach((arrow, index) => {
    const source = placements[arrow.from]!;
    const target = placements[arrow.to]!;
    const lane = Math.max(...placements.map((p) => p.top)) + 1 + index * 1.2;
    const start = { x: source.x, y: source.top + 0.2 };
    const end = { x: target.x, y: target.top + 0.2 };
    const a = { x: source.x, y: lane };
    const b = { x: target.x, y: lane };
    const id = `reaction_arrow_routed_${index}`;
    const ids = [c.link(`${id}_rise`, start, a, "reaction route", false), c.link(`${id}_span`, a, b, "reaction route", false), c.arrow(id, b, end, "reaction arrow")];
    if (arrow.label) ids.push(...arrowLabel(id, { x: (a.x + b.x) / 2, y: lane + 0.65 }, arrow.label));
    c.scene.group(`${id}_group`, ids, arrow.label ?? "reaction", [`m${arrow.from}_group`]);
  });
  return c.build();
}
