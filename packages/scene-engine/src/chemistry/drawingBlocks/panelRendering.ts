import type { ChemScene } from "../sceneKit";
import type { LaidOutMolecule, Vec2 } from "../organic/layout";
import { renderMolecule, type RenderedMolecule } from "../organic/render";
import { measureTextWidth } from "@heytutor/drawing";
import type { RenderScene } from "../../types";
import { boundsOverlap, type LabelBounds } from "../../labels/labelEngine";

/** Same fixed 24px handwritten-label measurement as the ordinary compiler. */
export const panelTextWidthPx = (text: string): number => measureTextWidth(text, 24) + 24;

/** Complete text only: ordinary compact labels, with word/hyphen wrapping. */
export function panelLabelLines(text: string, limit = 12): string[] {
  const lines: string[] = [];
  let remaining = text.replace(/\s+/g, " ").trim();
  while (remaining.length > limit) {
    const prefix = remaining.slice(0, limit + 1);
    const space = prefix.lastIndexOf(" ");
    const hyphen = prefix.slice(0, limit).lastIndexOf("-");
    const end = space > 0 ? space : hyphen >= 0 ? hyphen + 1 : limit;
    lines.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

/** Reuse atom/bond rendering from #106, then reserve the complete caption extent. */
export function renderPanelMolecule(c: ChemScene, laid: LaidOutMolecule, prefix: string, origin: Vec2, caption: string, pxPerUnit: number, lineLimit = 12): RenderedMolecule {
  const drawn = renderMolecule(c, laid, prefix, origin, null, pxPerUnit);
  const lines = panelLabelLines(caption, lineLimit);
  const ids = [...drawn.ids];
  const spacing = 44 / pxPerUnit;
  const x = (drawn.bounds.minX + drawn.bounds.maxX) / 2;
  const top = drawn.bounds.minY - spacing;
  lines.forEach((line, index) => ids.push(c.text(`${prefix}_name${index ? `_${index}` : ""}`, { x, y: top - index * spacing }, line, "compound name")));
  const minY = top - (lines.length - 1) * spacing - 24 / pxPerUnit;
  const width = Math.max(drawn.bounds.maxX - drawn.bounds.minX, Math.max(...lines.map(panelTextWidthPx)) / pxPerUnit);
  const maxY = drawn.bounds.maxY;
  const center = { x, y: (minY + maxY) / 2 };
  // Replace the base caption-free frame before the document leaves the builder.
  const panel = c.scene.constructions.find((construction) => construction.outputs.includes(`${prefix}_panel`));
  const centerConstruction = c.scene.constructions.find((construction) => construction.outputs.includes(`${prefix}_panel_c`));
  if (panel) panel.inputs = { ...panel.inputs, width, height: maxY - minY };
  if (centerConstruction) centerConstruction.inputs = { ...centerConstruction.inputs, x: center.x, y: center.y };
  return { ...drawn, ids, labels: [...drawn.labels, ...lines], bounds: { minX: x - width / 2, maxX: x + width / 2, minY, maxY } };
}

/** Equilibrium harpoons use ordinary segments with one-sided heads. */
export function harpoonArrow(c: ChemScene, id: string, from: Vec2, to: Vec2, headSize: number): string[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const u = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  return [c.link(id, from, to, "equilibrium harpoon", false), c.link(`${id}_head`, to, { x: to.x - u.x * headSize - u.y * headSize, y: to.y - u.y * headSize + u.x * headSize }, "equilibrium harpoon head", false)];
}

export function equilibriumArrow(c: ChemScene, id: string, from: Vec2, to: Vec2, separation: number, headSize: number): string[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const u = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  const n = { x: -u.y, y: u.x };
  const shifted = (p: Vec2, sign: number): Vec2 => ({ x: p.x + n.x * separation * sign, y: p.y + n.y * separation * sign });
  const a = shifted(from, 1), b = shifted(to, 1), d = shifted(to, -1), e = shifted(from, -1);
  return [
    c.link(`${id}_forward`, a, b, "equilibrium forward harpoon", false),
    c.link(`${id}_forward_head`, b, { x: b.x - u.x * headSize + n.x * headSize, y: b.y - u.y * headSize + n.y * headSize }, "equilibrium harpoon head", false),
    c.link(`${id}_reverse`, d, e, "equilibrium reverse harpoon", false),
    c.link(`${id}_reverse_head`, e, { x: e.x + u.x * headSize - n.x * headSize, y: e.y + u.y * headSize - n.y * headSize }, "equilibrium harpoon head", false),
  ];
}

/** Pinned symbols still need an atomic ink/label clearance decision. */
export function readablePanelInk(scene: RenderScene): boolean {
  const labels = scene.primitives.filter((p) => p.kind === "label");
  const arrowInk = scene.primitives.filter((p) => /^reaction_arrow_/.test(p.entityId) && p.kind !== "label");
  const crosses = (a: Vec2, b: Vec2, box: LabelBounds): boolean => {
    let near = 0, far = 1;
    for (const [start, delta, low, high] of [[a.x, b.x - a.x, box.x, box.x + box.width], [a.y, b.y - a.y, box.y, box.y + box.height]]) {
      if (Math.abs(delta!) < 1e-9) { if (start! <= low! || start! >= high!) return false; continue; }
      const t0 = (low! - start!) / delta!, t1 = (high! - start!) / delta!;
      near = Math.max(near, Math.min(t0, t1)); far = Math.min(far, Math.max(t0, t1));
      if (near >= far) return false;
    }
    return near < far;
  };
  for (let index = 0; index < labels.length; index += 1) {
    const box = labels[index]!.provenance?.labelBounds as LabelBounds | undefined;
    if (!box || box.x < 400 || box.x + box.width > 1160 || box.y < 0 || box.y + box.height > 700) return false;
    for (const other of labels.slice(index + 1)) {
      const otherBox = other.provenance?.labelBounds as LabelBounds | undefined;
      if (!otherBox || boundsOverlap(box, otherBox)) return false;
    }
    for (const ink of arrowInk) for (let k = 0; k + 1 < ink.points.length; k += 1) if (crosses(ink.points[k]!, ink.points[k + 1]!, box)) return false;
  }
  const segments = arrowInk.flatMap((ink) => ink.points.slice(1).map((end, index) => ({ arrow: /^reaction_arrow_(\d+)/.exec(ink.entityId)?.[1], a: ink.points[index]!, b: end })));
  const orientation = (a: Vec2, b: Vec2, c: Vec2): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < segments.length; i += 1) {
    const a = segments[i]!;
    for (const b of segments.slice(i + 1)) {
      if (a.arrow === b.arrow) continue;
      const ab0 = orientation(a.a, a.b, b.a), ab1 = orientation(a.a, a.b, b.b);
      const ba0 = orientation(b.a, b.b, a.a), ba1 = orientation(b.a, b.b, a.b);
      if (ab0 * ab1 < -1e-6 && ba0 * ba1 < -1e-6) return false;
      if (Math.abs(ab0) < 1e-6 && Math.abs(ab1) < 1e-6) {
        const horizontal = Math.abs(a.b.x - a.a.x) > Math.abs(a.b.y - a.a.y);
        const values = [a.a, a.b, b.a, b.b].map((p) => horizontal ? p.x : p.y);
        if (Math.min(Math.max(values[0]!, values[1]!), Math.max(values[2]!, values[3]!)) - Math.max(Math.min(values[0]!, values[1]!), Math.min(values[2]!, values[3]!)) > 1) return false;
      }
    }
  }
  return true;
}
