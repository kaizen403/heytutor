import type { SceneDocument } from "../../types";
import { compileSceneDocument } from "../../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../document/validation";
import { ChemScene } from "../sceneKit";
import { supportedMoleculeGraph } from "../drawingBlocks/moleculeInput";
import { equilibriumArrow, harpoonArrow, panelLabelLines, panelTextWidthPx, readablePanelInk, renderPanelMolecule } from "../drawingBlocks/panelRendering";
import { layoutBounds, layoutMolecule } from "./layout";
import { molecularFormula, type Molecule } from "./smiles";

export interface MoleculePanelItem { readonly molecule: Molecule; readonly label?: string }
export interface MoleculePanelArrow {
  /** Explicit source item indices; no products or ranking are inferred. */
  readonly from: number;
  readonly to: number;
  readonly kind?: "forward" | "equilibrium";
  readonly label?: string;
  readonly belowLabel?: string;
}
export interface MoleculePanelOptions {
  readonly mode?: "comparison" | "reaction";
  /** Each index places a plus between this item and the next item. */
  readonly plusSigns?: readonly number[];
}

const validText = (text: unknown, max: number): text is string => typeof text === "string" && text.trim().length > 0 && text.length <= max && !/[<>]/.test(text) && !Array.from(text).some((character) => character.charCodeAt(0) < 32);

/** Complete resolved graphs only; every failed input/layout declines atomically. */
export function buildMoleculePanelScene(question: string, items: readonly MoleculePanelItem[], arrows: readonly MoleculePanelArrow[] = [], options: MoleculePanelOptions = {}): SceneDocument | null {
  if (typeof question !== "string" || !Array.isArray(items) || !Array.isArray(arrows) || !options || items.length < 1 || items.length > 7 || arrows.length > 6) return null;
  if (options.mode !== undefined && !["comparison", "reaction"].includes(options.mode)) return null;
  const plus = options.plusSigns ?? [];
  if (!Array.isArray(plus) || new Set(plus).size !== plus.length || plus.some((index) => !Number.isInteger(index) || index < 0 || index >= items.length - 1)) return null;
  if (options.mode === "comparison" && (arrows.length > 0 || plus.length > 0)) return null;
  const pairs = new Set<string>();
  for (const arrow of arrows) {
    if (!arrow || !Number.isInteger(arrow.from) || !Number.isInteger(arrow.to) || arrow.from < 0 || arrow.to < 0 || arrow.from >= items.length || arrow.to >= items.length || arrow.from === arrow.to) return null;
    if (arrow.kind !== undefined && !["forward", "equilibrium"].includes(arrow.kind)) return null;
    if ((arrow.label !== undefined && !validText(arrow.label, 72)) || (arrow.belowLabel !== undefined && !validText(arrow.belowLabel, 72))) return null;
    const pair = [arrow.from, arrow.to].sort((a, b) => a - b).join(":");
    if (pairs.has(pair)) return null;
    pairs.add(pair);
    if (Math.abs(arrow.from - arrow.to) === 1 && plus.includes(Math.min(arrow.from, arrow.to))) return null;
  }
  try {
    const columns = Math.min(items.length, 4);
    const lineLimit = 16;
    const slots = items.map((item: MoleculePanelItem) => {
      if (!item || !supportedMoleculeGraph(item.molecule) || (item.label !== undefined && !validText(item.label, 96))) return null;
      const laid = layoutMolecule(item.molecule);
      if (!laid) return null;
      // A cycle outside the layout's supported size must not masquerade as
      // an open zigzag closed by one stretched bond.
      if (item.molecule.bonds.some((bond) => {
        if (laid.hidden.has(bond.a) || laid.hidden.has(bond.b)) return false;
        const a = laid.positions[bond.a]!, b = laid.positions[bond.b]!;
        const length = Math.hypot(a.x - b.x, a.y - b.y);
        return !Number.isFinite(length) || length < 0.8 || length > 1.2;
      })) return null;
      const caption = item.label ?? item.molecule.name ?? molecularFormula(item.molecule, true);
      if (!validText(caption, 96)) return null;
      return { laid, caption, lines: panelLabelLines(caption, lineLimit), bounds: layoutBounds(laid) };
    });
    if (slots.some((slot) => slot === null)) return null;
    const resolved = slots.filter((slot) => slot !== null);
    const rows = Math.ceil(items.length / columns);
    // A plus crossing the row break is not a readable common-baseline scheme.
    if (plus.some((index) => index % columns === columns - 1)) return null;
    const routed = arrows.filter((a) => Math.abs(a.from - a.to) > 1 || Math.floor(a.from / columns) !== Math.floor(a.to / columns));
    let scale = 90;
    let widths: number[] = [], rowHeights: number[] = [], gaps: number[] = [];
    for (let iteration = 0; iteration < 12; iteration += 1) {
      widths = Array.from({ length: columns }, (_, column) => Math.max(...resolved.filter((_, index) => index % columns === column).map((slot) => Math.max(slot.bounds.maxX - slot.bounds.minX + 0.5, Math.max(...slot.lines.map(panelTextWidthPx)) / scale))));
      rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...resolved.slice(row * columns, (row + 1) * columns).map((slot) => slot.bounds.maxY - slot.bounds.minY + 0.5 + (slot.lines.length + 1) * 44 / scale)));
      gaps = Array.from({ length: columns - 1 }, (_, column) => {
        const adjacent = arrows.filter((a) => Math.abs(a.from - a.to) === 1 && Math.min(a.from, a.to) % columns === column);
        const textWidth = Math.max(0, ...adjacent.flatMap((a) => [...panelLabelLines(a.label ?? "", lineLimit), ...panelLabelLines(a.belowLabel ?? "", lineLimit)].map(panelTextWidthPx)));
        const routeReserve = routed.some((a) => a.from % columns === column || a.to % columns === column + 1) ? 64 : 0;
        return Math.max((routeReserve + (adjacent.length > 0 ? 52 : 36)) / scale, (routeReserve + textWidth + (adjacent.length > 0 ? 16 : 0)) / scale);
      });
      const width = widths.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
      const routeHeight = routed.reduce((sum, a) => sum + (panelLabelLines(a.label ?? "", lineLimit).length + panelLabelLines(a.belowLabel ?? "", lineLimit).length + 2) * 44 / scale, 0);
      const height = rowHeights.reduce((a, b) => a + b, 0) + (rows - 1) * 58 / scale + routeHeight;
      const next = Math.min(612 / Math.max(width, 1), 427 / Math.max(height, 1));
      if (Math.abs(next - scale) < 0.2) break;
      scale = next;
    }
    if (!Number.isFinite(scale) || scale < 20) return null;
    const c = new ChemScene(question, "explicit source molecule panel", "chem_organic");
    const allIds: string[] = [];
    const placements: Array<{ x: number; y: number; left: number; right: number; top: number; bottom: number }> = [];
    const textLines = (id: string, x: number, y: number, text: string | undefined, above: boolean): void => {
      if (!text) return;
      const lines = panelLabelLines(text, lineLimit);
      lines.forEach((line, index) => allIds.push(c.text(`${id}_${index}`, { x, y: y + (above ? lines.length - index : -index) * 44 / scale }, line, "reagent or condition")));
    };
    let rowTop = 0;
    for (let row = 0; row < rows; row += 1) {
      let cursor = 0;
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const slot = resolved[index];
        if (!slot) break;
        const centerX = cursor + widths[column]! / 2;
        const y = rowTop - (slot.bounds.maxY - slot.bounds.minY) / 2;
        const origin = { x: centerX - (slot.bounds.minX + slot.bounds.maxX) / 2, y: y - (slot.bounds.minY + slot.bounds.maxY) / 2 };
        const drawn = renderPanelMolecule(c, slot.laid, `m${index}`, origin, slot.caption, scale, lineLimit);
        allIds.push(...drawn.ids.filter((id) => c.scene.entities.find((e) => e.id === id)?.kind !== "point"));
        c.scene.labelled(...drawn.labelledAtomIds);
        placements.push({ x: centerX, y, left: cursor, right: cursor + widths[column]!, top: drawn.bounds.maxY, bottom: drawn.bounds.minY });
        cursor += widths[column]! + (gaps[column] ?? 0);
      }
      rowTop -= rowHeights[row]! + 58 / scale;
    }
    plus.forEach((index) => {
      const a = placements[index]!, b = placements[index + 1]!;
      allIds.push(c.text(`plus_${index}`, { x: (a.right + b.left) / 2, y: (a.y + b.y) / 2 }, "+", "reaction plus sign"));
    });
    let lane = Math.max(...placements.map((p) => p.top)) + 40 / scale;
    arrows.forEach((arrow, index) => {
      const a = placements[arrow.from]!, b = placements[arrow.to]!;
      const id = `reaction_arrow_${index}`;
      if (!routed.includes(arrow)) {
        const left = a.x < b.x ? a : b, right = a.x < b.x ? b : a;
        const y = (a.y + b.y) / 2;
        const tail = { x: left.right + 14 / scale, y }, head = { x: right.left - 14 / scale, y };
        const start = arrow.from < arrow.to ? tail : head, end = arrow.from < arrow.to ? head : tail;
        allIds.push(...(arrow.kind === "equilibrium" ? equilibriumArrow(c, id, start, end, 6 / scale, 8 / scale) : [c.arrow(id, start, end, "reaction arrow")]));
        textLines(`${id}_above`, (tail.x + head.x) / 2, y + 6 / scale, arrow.label, true);
        textLines(`${id}_below`, (tail.x + head.x) / 2, y - 44 / scale, arrow.belowLabel, false);
      } else {
        lane += (panelLabelLines(arrow.belowLabel ?? "", lineLimit).length + 1) * 44 / scale;
        // Column gutters remain empty in every row, so a route to a lower
        // row never runs through an intermediate structure or its caption.
        const sourceX = a.right + 24 / scale, targetX = b.left - 24 / scale;
        const start = { x: sourceX, y: a.y + 24 / scale }, end = { x: targetX, y: b.y + 24 / scale };
        const rise = { x: sourceX, y: lane }, fall = { x: targetX, y: lane };
        allIds.push(c.link(`${id}_source`, { x: a.right + 8 / scale, y: start.y }, start, "reaction route", false), c.link(`${id}_rise`, start, rise, "reaction route", false), c.link(`${id}_span`, rise, fall, "reaction route", false), c.link(`${id}_fall`, fall, end, "reaction route", false));
        const arrival = { x: b.left - 8 / scale, y: end.y };
        allIds.push(...(arrow.kind === "equilibrium" ? harpoonArrow(c, id, end, arrival, 8 / scale) : [c.arrow(id, end, arrival, "reaction arrow")]));
        if (arrow.kind === "equilibrium") {
          const reverseStart = { x: end.x - 12 / scale, y: end.y - 12 / scale }, reverseEnd = { x: start.x + 12 / scale, y: start.y - 12 / scale };
          const reverseRise = { x: reverseStart.x, y: lane - 12 / scale }, reverseFall = { x: reverseEnd.x, y: lane - 12 / scale };
          allIds.push(c.link(`${id}_reverse_source`, { x: arrival.x, y: arrival.y - 12 / scale }, reverseStart, "equilibrium reverse route", false), c.link(`${id}_reverse_rise`, reverseStart, reverseRise, "equilibrium reverse route", false), c.link(`${id}_reverse_span`, reverseRise, reverseFall, "equilibrium reverse route", false), c.link(`${id}_reverse_fall`, reverseFall, reverseEnd, "equilibrium reverse route", false), ...harpoonArrow(c, `${id}_reverse`, reverseEnd, { x: a.right + 8 / scale, y: start.y - 12 / scale }, 8 / scale));
        }
        textLines(`${id}_above`, (rise.x + fall.x) / 2, lane + 6 / scale, arrow.label, true);
        textLines(`${id}_below`, (rise.x + fall.x) / 2, lane - 44 / scale, arrow.belowLabel, false);
        lane += (panelLabelLines(arrow.label ?? "", lineLimit).length + 1) * 44 / scale;
      }
    });
    // One figure transform preserves the explicit connection geometry across components.
    c.scene.group("molecule_panel", allIds, "source molecules and explicitly stated connections");
    const document = c.build();
    const checked = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
    if (!checked.document) return null;
    const compiled = compileSceneDocument(checked.document);
    if (!compiled.ok || !compiled.renderScene || !readablePanelInk(compiled.renderScene)) return null;
    return checked.document;
  } catch {
    return null;
  }
}
