/** Complete molecular graphs and derived local facts, composed without planner ink. */
import { measureTextWidth } from "@heytutor/drawing";
import { compileSceneDocument } from "../../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../document/validation";
import { boundsOverlap, type LabelBounds } from "../../labels/labelEngine";
import type { RenderScene, SceneDocument } from "../../types";
import { ChemScene } from "../sceneKit";
import { layoutBounds, layoutMolecule } from "./layout";
import { molecularNeighbourhoods, type CarbonSiteKind, type MolecularNeighbourhood } from "./neighbourhood";
import { renderMolecule } from "./render";

export interface OrganicNeighbourhoodStructure {
  readonly name: string;
  readonly groupId: string;
  readonly atomIds: readonly string[];
  readonly nameLabelIds: readonly string[];
}

export interface OrganicNeighbourhoodFigure {
  readonly document: SceneDocument;
  readonly structures: readonly OrganicNeighbourhoodStructure[];
}

/** Complete compact labels; shared F6 wrapping rule, without truncating names. */
function labelLines(text: string): string[] {
  const lines: string[] = [];
  let rest = text.trim().replace(/\s+/g, " ");
  while (rest.length > 16) {
    const prefix = rest.slice(0, 17);
    const space = prefix.lastIndexOf(" ");
    const hyphen = prefix.slice(0, 16).lastIndexOf("-");
    const end = space > 0 ? space : hyphen >= 0 ? hyphen + 1 : 16;
    lines.push(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  if (rest) lines.push(rest);
  return lines;
}

function descriptions(model: MolecularNeighbourhood, kind: CarbonSiteKind): string[] {
  const { molecule, site } = model;
  if (kind === "alcohol") return [`${site.hybridisation} OH-bearing C`, `C neighbours: ${site.carbonNeighbours.length}`, site.classification];
  if (kind === "carbonyl") return [site.classification, site.hydrogens === 1 ? "carbonyl H" : "two C substituents", "sp2 carbonyl C", "trigonal planar"];
  const symbol = molecule.atoms[site.boundAtom]!.element;
  return [site.classification === "aryl" || site.classification === "vinylic" ? `${site.classification} C-${symbol}` : site.classification,
    `C bonded to ${symbol}`, `${site.hybridisation}; C nbrs:${site.carbonNeighbours.length}`, ...(site.phenyl ? ["Phenyl ring"] : [])];
}

/** Pinned molecular letters and descriptions must still fit and stay separate. */
function readable(scene: RenderScene): boolean {
  const labels = scene.primitives.filter((primitive) => primitive.kind === "label");
  for (const [index, label] of labels.entries()) {
    const box = (label.provenance?.labelCollisionBounds ?? label.provenance?.labelBounds) as LabelBounds | undefined;
    if (!box || box.x < 400 || box.x + box.width > 1160 || box.y < 0 || box.y + box.height > 700) return false;
    for (const other of labels.slice(index + 1)) {
      const otherBox = (other.provenance?.labelCollisionBounds ?? other.provenance?.labelBounds) as LabelBounds | undefined;
      if (!otherBox || boundsOverlap(box, otherBox)) return false;
    }
  }
  return labels.length > 0;
}

/** One to three fully resolved structures; an unsupported member refuses all. */
export function buildNeighbourhoodFigure(question: string, kind: CarbonSiteKind): OrganicNeighbourhoodFigure | null {
  const models = molecularNeighbourhoods(question, kind);
  if (!models) return null;
  const slots = models.map((model) => {
    const skeletal = layoutMolecule(model.molecule);
    if (!skeletal) return null;
    // The ordinary skeletal caption H uses a short 0.75-unit bond. With
    // explicitly labelled carbon vertices it needs the same unit bond
    // length as its heavy neighbours, while retaining its 120-degree ray.
    const laid = { ...skeletal, extraLabels: skeletal.extraLabels.map((extra) => {
      const carbon = skeletal.positions[extra.atom]!;
      const dx = extra.at.x - carbon.x;
      const dy = extra.at.y - carbon.y;
      const distance = Math.hypot(dx, dy);
      return { ...extra, at: { x: carbon.x + dx / distance, y: carbon.y + dy / distance } };
    }) };
    const nameLines = labelLines(model.name);
    const lines = [...nameLines, ...descriptions(model, kind).flatMap(labelLines)];
    return { model, laid, nameLines, lines, bounds: layoutBounds(laid) };
  });
  if (slots.some((slot) => !slot)) return null;
  const complete = slots.filter((slot) => slot !== null);
  const scale = 1.5;
  const graphWidth = complete.reduce((sum, slot) => sum + (slot.bounds.maxX - slot.bounds.minX) * scale + 1.1, 0);
  const pxPerUnit = Math.min(48, 600 / graphWidth);
  if (pxPerUnit < 28) return null;
  const c = new ChemScene(question, "complete source molecular graphs with derived carbon neighbourhoods", "chem_organic");
  const spacing = 56 / pxPerUnit;
  const structures: OrganicNeighbourhoodStructure[] = [];
  let cursor = 0;
  for (const [index, slot] of complete.entries()) {
    const { model, laid, nameLines, lines, bounds } = slot;
    const captionWidth = Math.max(...lines.map((line) => measureTextWidth(line, 24) + 24)) / pxPerUnit;
    const width = Math.max((bounds.maxX - bounds.minX) * scale, captionWidth) + 0.6;
    const centerX = cursor + width / 2;
    const origin = { x: centerX - (bounds.minX + bounds.maxX) * scale / 2, y: -(bounds.minY + bounds.maxY) * scale / 2 };
    const labels = new Map<number, string>();
    // Carbon labels identify graph vertices; carbon-bound H remains implicit
    // in this skeletal convention (the aldehyde H is drawn separately).
    for (const atomIndex of [model.site.atom, ...model.site.carbonNeighbours]) labels.set(atomIndex, "C");
    const prefix = `m${index}`;
    const drawn = renderMolecule(c, laid, prefix, origin, null, pxPerUnit, { atomLabels: labels, scale });
    const ids = [...drawn.ids];
    const nameLabelIds: string[] = [];
    const top = drawn.bounds.minY - spacing;
    lines.forEach((line, lineIndex) => {
      const id = c.text(`${prefix}_description${lineIndex}`, { x: centerX, y: top - lineIndex * spacing }, line, "molecular name and graph-derived neighbourhood");
      ids.push(id);
      if (lineIndex < nameLines.length) nameLabelIds.push(id);
    });
    const minY = top - (lines.length - 1) * spacing - 24 / pxPerUnit;
    const maxY = drawn.bounds.maxY;
    // Reserve every fixed-size glyph with the ordinary panel geometry, as
    // in F6's materialized panel renderer; no label-fit exception is used.
    const panel = c.scene.constructions.find((construction) => construction.outputs.includes(`${prefix}_panel`));
    const center = c.scene.constructions.find((construction) => construction.outputs.includes(`${prefix}_panel_c`));
    if (panel) panel.inputs = { ...panel.inputs, width, height: maxY - minY };
    if (center) center.inputs = { ...center.inputs, x: centerX, y: (minY + maxY) / 2 };
    c.scene.labelled(...drawn.labelledAtomIds);
    c.scene.group(`${prefix}_group`, ids.filter((id) => c.scene.entities.find((entity) => entity.id === id)?.kind !== "point"), `complete structure and ${kind} site of ${model.name}`);
    structures.push({ name: model.name, groupId: `${prefix}_group`, atomIds: drawn.atomIds, nameLabelIds });
    cursor += width + 1.1;
  }
  const document = c.build();
  document.source.organicComparison = { version: "organic-neighbourhood/v1", kind, models: structuredClone(models) };
  // Geometry validation alone does not police pinned-caption collisions.
  // Refuse the whole independently composed scene if its labels do not fit.
  const validated = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
  if (!validated.document) return null;
  const compiled = compileSceneDocument(validated.document);
  return compiled.ok && compiled.renderScene && readable(compiled.renderScene) ? { document, structures } : null;
}

/** Existing family callers receive the identical scene document. */
export function buildNeighbourhoodComparison(question: string, kind: CarbonSiteKind): SceneDocument | null {
  return buildNeighbourhoodFigure(question, kind)?.document ?? null;
}
