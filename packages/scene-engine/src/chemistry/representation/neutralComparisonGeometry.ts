/** PRIVATE independent graph/operator audit; the resulting proof is inert. */
import * as e from "./neutralComparisonDependencies";
import { measureTextWidth, measureTextInkBounds } from "@heytutor/drawing";
import { layoutMolecule } from "../organic/layout";
import { molecularFormula } from "../organic/smiles";
import { closeComparisonSource, type SourceArgument, type ComparisonSpecies } from "./neutralComparisonSource";
import { existingOrganicComponents, type ExistingOrganicComponent } from "./existingOrganicSource";

import { requireOrdinarySceneWitness, requireSceneContainment } from "./neutralComparisonWitness";

type Point = { x: number; y: number };
export interface StructuralSymbolProof {
  readonly entityId: string; readonly primitiveId: string; readonly sourceArgument: SourceArgument;
  readonly graphIdentity: string; readonly sourceAtom: number; readonly hydrogenSlot: number | null;
  readonly text: "O" | "OH" | "H"; readonly worldAnchor: Point; readonly compiledAnchor: Point;
}
export interface CompleteNameLineProof {
  readonly entityId: string; readonly primitiveId: string; readonly sourceArgument: SourceArgument;
  readonly lineIndex: number; readonly originalStart: number; readonly originalEnd: number;
  /** Only a complete single-line typed alias owns the whole source argument. */
  readonly projection?: "canonical_same_graph";
  readonly text: string; readonly worldAnchor: Point; readonly compiledAnchor: Point;
}
export interface NeutralComparisonProof {
  readonly version: "neutral-comparison-source-proof/v1";
  readonly inert: true; readonly originalQuestion: string;
  readonly sourceBindings: readonly { source: SourceArgument; sourceIdentity: string; graphIdentity: string }[];
  readonly virtualCarbonAnchors: readonly { prefix: string; sourceAtom: number; hydrogens: number; worldAnchor: Point }[];
  readonly bondStrokes: readonly { entityId: string; primitiveId: string; prefix: string; sourceBond: number | null; hydrogenParentAtom: number | null; hydrogenSlot: number | null; offset: number }[];
  readonly symbols: readonly StructuralSymbolProof[];
  readonly nameLines: readonly CompleteNameLineProof[];
  readonly drawableEntityIds: readonly string[];
  readonly limitations: readonly string[];
}
export interface AuditResult { readonly ok: boolean; readonly issues: readonly string[]; readonly proof: NeutralComparisonProof | null; readonly renderScene?: e.RenderScene }
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (p: Point, n: number): Point => ({ x: p.x * n, y: p.y * n });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const unit = (p: Point): Point => scale(p, 1 / Math.hypot(p.x, p.y));
const close = (a: Point, b: Point, tolerance = 0.00018): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
const keys = (value: Record<string, unknown>, expected: string[]): boolean => Object.keys(value).sort().join("|") === [...expected].sort().join("|");
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
function fail(reason: string): never { throw new Error(reason); }

/** Original question is the only species authority. Strict raw input checks
 * precede public compilation. No panel renderer is called by this audit. */
export function auditNeutralComparison(document: e.SceneDocument, question: string, actualScene?: e.RenderScene): AuditResult {
  const closure = closeComparisonSource(question);
  if (!closure.ok) return { ok: false, issues: closure.issues, proof: null };
  return auditComponentGeometry(document, question, closure.species, actualScene, false);
}

/** Source-derived complete existing graphs only; the original closed-neutral path above is unchanged. */
export function auditExistingOrganicGeometry(document: e.SceneDocument, question: string, actualScene?: e.RenderScene): AuditResult | null {
  try {
    const components = existingOrganicComponents(document, question);
    if (!components) return null;
    return auditComponentGeometry(document, question, components, actualScene, true);
  } catch(error) { return {ok:false,issues:[error instanceof Error ? error.message : String(error)],proof:null}; }
}

function auditComponentGeometry(document: e.SceneDocument, question: string, species: readonly ComparisonSpecies[], actualScene: e.RenderScene | undefined, existing: boolean): AuditResult {
  try {
    if (!keys(document as unknown as Record<string, unknown>, ["schemaVersion", "visualDecision", "source", "quantities", "entities", "constructions", "relations", "assertions", "annotations", "requiredEntityIds", "revealGroups", "teachingTimeline"]) || document.schemaVersion !== "scene-document/v2" || !keys(document.visualDecision as unknown as Record<string, unknown>, ["mode", "reason"]) || document.visualDecision.mode !== "scene") fail("unsupported_raw_document_shape");
    if (document.source.question !== question) fail("source_question_mismatch");
    if (!keys(document.source as unknown as Record<string, unknown>, ["question", "synthesizedFamily", "archetype", "chemistryFamily"]) || document.source.chemistryFamily !== "chem_organic" || document.source.archetype !== "chem_organic" || document.source.synthesizedFamily !== true) fail("unsupported_source_metadata");
    if (document.quantities.length || document.relations.length || (!existing && document.annotations.length)) fail("unsupported_physical_annotation_authority");
    if (existing && document.annotations.length) {
      const caption = document.annotations[0];
      const sourceCaption = species.map(s => `${(s as ExistingOrganicComponent).renderedName} ${molecularFormula(s.resolved.molecule!, false)}`).join(". ");
      // Ordinary validation adds an undefined optional style. This has no paint
      // or source authority and disappears in JSON; any supplied style declines.
      const captionKeys = caption && Object.hasOwn(caption, "style")
        ? ["id", "kind", "targetIds", "text", "style"]
        : ["id", "kind", "targetIds", "text"];
      if (document.annotations.length !== 1 || !caption || !keys(caption as unknown as Record<string, unknown>, captionKeys) || caption.style !== undefined || caption.id !== "figure_caption" || caption.kind !== "callout" || caption.targetIds.length || caption.text !== sourceCaption) fail("unproved_existing_structural_caption");
    }
    if (!unique(document.entities.map(v => v.id)) || !unique(document.constructions.map(v => v.id))) fail("duplicate_entity_or_operator");
    const entities = new Map(document.entities.map(v => [v.id, v]));
    const producers = new Map<string, e.SceneConstruction>();
    for (const c of document.constructions) {
      if (!keys(c as unknown as Record<string, unknown>, ["id", "operator", "inputs", "outputs"])) fail(`unsupported_raw_construction:${c.id}`);
      if (c.outputs.length !== 1 || producers.has(c.outputs[0]!) || !entities.has(c.outputs[0]!)) fail("ambiguous_output_ownership");
      producers.set(c.outputs[0]!, c);
      if (!(["point", "segment", "label", "rectangle"] as string[]).includes(c.operator)) fail(`unsupported_operator:${c.operator}`);
      const shape = c.operator === "point" ? ["x", "y", "coordinateSpace"] : c.operator === "segment" ? ["start", "end"] : c.operator === "label" ? ["target", "text"] : ["center", "width", "height"];
      if (!keys(c.inputs, shape)) fail(`unsupported_operator_inputs:${c.outputs[0]}`);
      const entity = entities.get(c.outputs[0]!)!;
      if (entity.kind !== c.operator) fail(`operator_entity_kind:${entity.id}`);
      // Styling/position hints are outside this canonical operator contract.
      if (!keys(entity as unknown as Record<string, unknown>, entity.kind === "label" ? ["id", "kind", "role", "label", "provenance"] : entity.kind === "rectangle" ? ["id", "kind", "role", "provenance"] : ["id", "kind", "role"])) fail(`unsupported_entity_inputs:${entity.id}`);
      if (entity.kind === "label" && (!entity.provenance || !keys(entity.provenance as unknown as Record<string, unknown>, ["pinLabel"]) || entity.provenance.pinLabel !== true)) fail(`unsupported_label_placement:${entity.id}`);
      if (entity.kind === "rectangle" && (!entity.provenance || !keys(entity.provenance as unknown as Record<string, unknown>, ["dashed", "strokeRole"]) || entity.provenance.dashed !== true || entity.provenance.strokeRole !== "construction")) fail(`unsupported_frame_style:${entity.id}`);
    }
    if (producers.size !== entities.size) fail("missing_entity_producer");
    const owned = new Set<string>(), drawable = new Set<string>();
    function take(id: string, operator: string): e.SceneConstruction {
      const c = producers.get(id);
      if (!c || c.operator !== operator || owned.has(id)) fail(`missing_duplicate_or_wrong_operator:${id}`);
      owned.add(id); if (operator !== "point") drawable.add(id);
      return c;
    }
    function point(id: unknown): Point {
      if (typeof id !== "string") fail("unsupported_point_reference");
      const c = take(id, "point");
      if (c.inputs.coordinateSpace !== "world" || typeof c.inputs.x !== "number" || typeof c.inputs.y !== "number" || !Number.isFinite(c.inputs.x) || !Number.isFinite(c.inputs.y)) fail(`unsupported_world_point:${id}`);
      return { x: c.inputs.x, y: c.inputs.y };
    }
    function peekPoint(id: unknown): Point {
      if (typeof id !== "string") fail("unsupported_point_reference");
      const c = producers.get(id);
      if (!c || c.operator !== "point" || c.inputs.coordinateSpace !== "world" || typeof c.inputs.x !== "number" || typeof c.inputs.y !== "number" || !Number.isFinite(c.inputs.x) || !Number.isFinite(c.inputs.y)) fail(`unsupported_world_point:${id}`);
      return { x: c.inputs.x, y: c.inputs.y };
    }
    const expectedVisible = new Map<string, { kind: "line" | "label" | "rectangle"; points: Point[]; text?: string }>();
    const virtualCarbonAnchors: NeutralComparisonProof["virtualCarbonAnchors"][number][] = [];
    const bondStrokes: NeutralComparisonProof["bondStrokes"][number][] = [];
    const symbolDraft: Omit<StructuralSymbolProof, "primitiveId" | "compiledAnchor">[] = [];
    const nameDraft: Omit<CompleteNameLineProof, "primitiveId" | "compiledAnchor">[] = [];
    function label(id: string, text: string): Point {
      const c = take(id, "label");
      if (c.inputs.target !== `${id}_p` || c.inputs.text !== text || entities.get(id)!.label !== text || !text || text.length > 16) fail(`source_label_text_or_anchor:${id}`);
      const anchor = point(c.inputs.target);
      expectedVisible.set(id, { kind: "label", points: [anchor], text });
      return anchor;
    }
    const componentBounds: { left: number; right: number; bottom: number; top: number }[] = [];
    for (let component = 0; component < species.length; component++) {
      const s = species[component]!, m = s.resolved.molecule!, prefix = `m${component}`;
      const completeName = existing ? (s as ExistingOrganicComponent).renderedName : s.source.text;
      const canonicalProjection = existing && (completeName.toLowerCase() !== s.source.text.toLowerCase() || completeName.length !== s.source.text.length);
      const laid = layoutMolecule(m);
      if (!laid || laid.hidden.size || laid.groupLabels.size) fail(`unsupported_canonical_layout:${prefix}`);
      // A first actual heteroatom fixes translation. Hydrocarbons use their
      // first untrimmed single carbon bond; source graph fixes orientation.
      const firstO = m.atoms.find(a => a.element === "O");
      let origin: Point;
      if (firstO) {
        const c = producers.get(`${prefix}_a${firstO.index}`);
        if (!c || c.operator !== "label") fail(`missing_source_oxygen:${prefix}`);
        origin = sub(peekPoint(c.inputs.target), laid.positions[firstO.index]!);
      } else {
        const b = m.bonds[0]!, c = producers.get(`${prefix}_b${b.index}`);
        if (!c || c.operator !== "segment") fail(`missing_source_carbon_bond:${prefix}`);
        origin = sub(peekPoint(c.inputs.start), laid.positions[b.a]!);
      }
      const anchors = laid.positions.map(p => add(p, origin));
      for (const atom of m.atoms) {
        const valence = m.bonds.filter(b => b.a === atom.index || b.b === atom.index).reduce((n, b) => n + b.order, 0);
        const hydrogens = (atom.element === "C" ? 4 : 2) - valence;
        if (hydrogens !== atom.hydrogens) fail(`source_hydrogen_conflict:${prefix}:${atom.index}`);
        if (atom.element === "C") virtualCarbonAnchors.push({ prefix, sourceAtom: atom.index, hydrogens, worldAnchor: anchors[atom.index]! });
        else {
          const text = hydrogens === 1 ? "OH" : "O", id = `${prefix}_a${atom.index}`, anchor = label(id, text);
          if (!close(anchor, anchors[atom.index]!)) fail(`oxygen_anchor_geometry:${id}`);
          symbolDraft.push({ entityId: id, sourceArgument: s.source, graphIdentity: s.graphIdentity, sourceAtom: atom.index, hydrogenSlot: hydrogens ? 0 : null, text, worldAnchor: anchor });
        }
      }
      function stroke(id: string, a: Point, b: Point, offset: number, trimA: "carbon" | "oxygen", trimB: "carbon" | "oxygen" | "hydrogen", sourceBond: number | null, hydrogenParentAtom: number | null): void {
        const c = take(id, "segment");
        if (c.inputs.start !== `${id}_s` || c.inputs.end !== `${id}_e`) fail(`unsupported_bond_endpoint_reference:${id}`);
        const start = point(c.inputs.start), end = point(c.inputs.end), direction = unit(sub(b, a)), normal = { x: -direction.y, y: direction.x };
        const from = sub(start, a), to = sub(end, b), ta = dot(from, direction), tb = -dot(to, direction);
        if (Math.abs(dot(from, normal) - offset) > 0.00018 || Math.abs(dot(to, normal) - offset) > 0.00018) fail(`bond_stroke_offset_or_attachment:${id}`);
        const validTrim = (n: number, kind: string): boolean => kind === "carbon" ? Math.abs(n) <= 0.00018 : kind === "hydrogen" ? Math.abs(n - 0.24) <= 0.00018 : n >= 0.1998 && n <= 0.7002;
        if (!validTrim(ta, trimA) || !validTrim(tb, trimB) || dot(sub(end, start), direction) < 0.15) fail(`bond_stroke_direction_or_trim:${id}`);
        expectedVisible.set(id, { kind: "line", points: [start, end] });
        bondStrokes.push({ entityId: id, primitiveId: `primitive_${id}`, prefix, sourceBond, hydrogenParentAtom, hydrogenSlot: hydrogenParentAtom === null ? null : 0, offset });
      }
      for (const bond of m.bonds) {
        const a = anchors[bond.a]!, b = anchors[bond.b]!;
        if (Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 1) > 0.00018) fail(`unsupported_canonical_bond_length:${prefix}:${bond.index}`);
        const offsets = bond.order === 1 ? [0] : [-0.065, 0.065];
        const trims: { start: number; end: number }[] = [];
        offsets.forEach((offset, index) => {
          const id = `${prefix}_b${bond.index}${bond.order === 1 ? "" : `_${index + 1}`}`;
          stroke(id, a, b, offset, m.atoms[bond.a]!.element === "C" ? "carbon" : "oxygen", m.atoms[bond.b]!.element === "C" ? "carbon" : "oxygen", bond.index, null);
          const visible = expectedVisible.get(id)!; const direction = unit(sub(b, a));
          trims.push({ start: dot(sub(visible.points[0]!, a), direction), end: dot(sub(b, visible.points[1]!), direction) });
        });
        if (trims.length === 2 && (Math.abs(trims[0]!.start - trims[1]!.start) > 0.00018 || Math.abs(trims[0]!.end - trims[1]!.end) > 0.00018)) fail(`inconsistent_multistroke_trim:${prefix}:${bond.index}`);
      }
      const extras: Point[] = [];
      let hIndex = 0;
      for (const atom of m.atoms) {
        const around = m.bonds.filter(b => b.a === atom.index || b.b === atom.index);
        if (atom.element !== "C" || atom.hydrogens !== 1 || around.length !== 2 || !around.some(b => b.order === 2 && m.atoms[b.a === atom.index ? b.b : b.a]!.element === "O")) continue;
        const at = anchors[atom.index]!, vectors = around.map(b => unit(sub(anchors[b.a === atom.index ? b.b : b.a]!, at)));
        const h = add(at, scale(unit(scale(add(vectors[0]!, vectors[1]!), -1)), 0.75));
        const id = `${prefix}_h${hIndex}`, anchor = label(id, "H");
        if (!close(h, anchor)) fail(`aldehyde_hydrogen_anchor:${id}`);
        stroke(`${prefix}_hb${hIndex}`, at, h, 0, "carbon", "hydrogen", null, atom.index);
        symbolDraft.push({ entityId: id, sourceArgument: s.source, graphIdentity: s.graphIdentity, sourceAtom: atom.index, hydrogenSlot: 0, text: "H", worldAnchor: anchor });
        extras.push(h); hIndex++;
      }
      const structuralPoints = [...anchors, ...extras];
      const minX = Math.min(...structuralPoints.map(p => p.x)), maxX = Math.max(...structuralPoints.map(p => p.x));
      const minY = Math.min(...structuralPoints.map(p => p.y)), maxY = Math.max(...structuralPoints.map(p => p.y));
      const frameId = `${prefix}_panel`, frame = take(frameId, "rectangle");
      if (frame.inputs.center !== `${frameId}_c` || typeof frame.inputs.width !== "number" || typeof frame.inputs.height !== "number" || !Number.isFinite(frame.inputs.width) || !Number.isFinite(frame.inputs.height) || frame.inputs.width <= 0 || frame.inputs.height <= 0) fail(`unsupported_frame_geometry:${frameId}`);
      const center = point(frame.inputs.center), half = { x: frame.inputs.width / 2, y: frame.inputs.height / 2 };
      const bounds = { left: center.x - half.x, right: center.x + half.x, bottom: center.y - half.y, top: center.y + half.y };
      if (Math.abs(center.x - (minX + maxX) / 2) > 0.00018 || bounds.left > minX - 0.1 || bounds.right < maxX + 0.1 || bounds.top < maxY + 0.1 || bounds.top > maxY + 1.5 || frame.inputs.width > maxX - minX + 4) fail(`frame_source_bounds:${frameId}`);
      expectedVisible.set(frameId, { kind: "rectangle", points: [{ x: bounds.left, y: bounds.bottom }, { x: bounds.right, y: bounds.bottom }, { x: bounds.right, y: bounds.top }, { x: bounds.left, y: bounds.top }] });
      const nameIds = [...entities.keys()].filter(id => id === `${prefix}_name` || new RegExp(`^${prefix}_name_\\d+$`).test(id));
      if (!nameIds.length || nameIds.length > 10) fail(`missing_complete_source_name:${prefix}`);
      if (canonicalProjection && nameIds.length !== 1) fail(`unsupported_existing_name_projection:${prefix}`);
      let sourceCursor = 0, previous: Point | null = null, lineSpacing: number | null = null;
      for (let index = 0; index < nameIds.length; index++) {
        const id = `${prefix}_name${index === 0 ? "" : `_${index}`}`, text = entities.get(id)?.label;
        if (typeof text !== "string" || !text.length || text !== completeName.slice(sourceCursor, sourceCursor + text.length)) fail(`incomplete_original_name_line:${id}`);
        const originalStart = canonicalProjection ? s.source.start : s.source.start + sourceCursor; sourceCursor += text.length;
        const originalEnd = canonicalProjection ? s.source.end : s.source.start + sourceCursor;
        while (completeName[sourceCursor] === " ") sourceCursor++;
        const anchor = label(id, text);
        if (Math.abs(anchor.x - center.x) > 0.00018 || anchor.y >= minY - 0.1 || anchor.y <= bounds.bottom + 0.1 || anchor.y < minY - 4) fail(`source_name_anchor_geometry:${id}`);
        if (previous) {
          const spacing = previous.y - anchor.y;
          if (spacing < 0.25 || spacing > 2 || lineSpacing !== null && Math.abs(spacing - lineSpacing) > 0.00018) fail(`source_name_line_order:${id}`);
          lineSpacing = spacing;
        }
        previous = anchor;
        nameDraft.push({ entityId: id, sourceArgument: s.source, lineIndex: index, originalStart, originalEnd, text, worldAnchor: anchor,
          ...(canonicalProjection ? { projection: "canonical_same_graph" as const } : {}) });
      }
      if (sourceCursor !== completeName.length) fail(`incomplete_original_name:${prefix}`);
      if (bounds.bottom < (previous?.y ?? minY) - 1.5) fail(`frame_name_bounds:${frameId}`);
      componentBounds.push(bounds);
    }
    if (owned.size !== entities.size) fail(`unbound_actual_entities:${[...entities.keys()].filter(id => !owned.has(id)).join(",")}`);
    for (let i = 0; i < componentBounds.length; i++) for (let j = i + 1; j < componentBounds.length; j++) {
      const a = componentBounds[i]!, b = componentBounds[j]!;
      if (!(a.right <= b.left || b.right <= a.left || a.top <= b.bottom || b.top <= a.bottom)) fail("overlapping_source_components");
    }
    if (!unique(document.requiredEntityIds) || document.requiredEntityIds.length !== drawable.size || document.requiredEntityIds.some(id => !drawable.has(id))) fail("incomplete_required_membership");
    const groupOf = new Map<string,string>();
    if (!existing) {
      if (document.revealGroups.length !== 1) fail("unsupported_reveal_groups");
      const group = document.revealGroups[0]!;
      if (group.id !== "molecule_panel" || group.dependsOn.length || !unique(group.entityIds) || group.entityIds.length !== drawable.size || group.entityIds.some(id => !drawable.has(id))) fail("incomplete_reveal_membership");
      if (document.teachingTimeline.length !== 1 || document.teachingTimeline[0]!.action !== "reveal" || document.teachingTimeline[0]!.targetId !== group.id || document.teachingTimeline[0]!.dependsOn.length) fail("incomplete_teaching_membership");
      for (const id of group.entityIds) groupOf.set(id,group.id);
    } else {
      if(document.revealGroups.length!==species.length||document.teachingTimeline.length!==species.length) fail("incomplete_existing_groups");
      const timelineIds=new Set(document.teachingTimeline.map(step=>step.id));
      if(timelineIds.size!==species.length)fail("duplicate_existing_timeline");
      for(let index=0;index<species.length;index++) {
        const prefix=`m${index}`, members=[...drawable].filter(id=>id.startsWith(prefix+"_"));
        const groups=document.revealGroups.filter(group=>members.some(id=>group.entityIds.includes(id)));
        if(groups.length!==1)fail("ambiguous_existing_structure_group");
        const group=groups[0]!;
        if(group.dependsOn.length||!unique(group.entityIds)||group.entityIds.length!==members.length||group.entityIds.some(id=>!members.includes(id)))fail("cross_component_existing_group");
        const steps=document.teachingTimeline.filter(step=>step.targetId===group.id);
        if(steps.length!==1||steps[0]!.action!=="reveal"||steps[0]!.dependsOn.some(id=>!timelineIds.has(id)||id===steps[0]!.id))fail("incomplete_existing_teaching_membership");
        for(const id of members)groupOf.set(id,group.id);
      }
    }
    const oxygenIds = symbolDraft.filter(v => v.text !== "H").map(v => v.entityId);
    if (document.assertions.length !== oxygenIds.length || !unique(document.assertions.map(a => a.id)) || document.assertions.some(a => a.predicate !== "label_attached" || a.expected !== true || a.severity !== "fatal" || a.entities.length !== 1 || !oxygenIds.includes(a.entities[0]!)) || !unique(document.assertions.map(a => a.entities[0]!))) fail("incomplete_source_assertions");
    // A supplied descriptor is a witness, never a replacement for raw compilation.
    const compiled = e.compileSceneDocument(document);
    if (!compiled.ok || !compiled.renderScene) fail("ordinary_compile_declined");
    const scene = compiled.renderScene;
    if (actualScene !== undefined) requireOrdinarySceneWitness(scene, actualScene);
    requireSceneContainment(scene);
    if ((!existing && scene.caption !== undefined) || !unique(scene.primitives.map(p => p.id)) || !unique(scene.primitives.map(p => p.entityId)) || scene.primitives.length !== drawable.size) fail("unbound_or_duplicate_compiled_primitive");
    const pairs: { world: Point; visible: Point }[] = [];
    for (const primitive of scene.primitives) {
      const expected = expectedVisible.get(primitive.entityId);
      if (!expected || primitive.id !== `primitive_${primitive.entityId}${expected.kind === "label" ? "_label" : ""}` || primitive.groupId !== groupOf.get(primitive.entityId) || primitive.kind !== expected.kind || primitive.text !== expected.text || primitive.points.length !== expected.points.length) fail(`compiled_membership_or_text:${primitive.id}`);
      const allowed = new Set(["id", "entityId", "groupId", "kind", "points", "text", "provenance", ...(expected.kind === "label" ? ["labelPlacement"] : [])]);
      if (Object.keys(primitive).some(key => !allowed.has(key)) || primitive.points.some(p => !keys(p as unknown as Record<string, unknown>, ["x", "y"]) || !Number.isFinite(p.x) || !Number.isFinite(p.y))) fail(`unsupported_compiled_inputs:${primitive.id}`);
      if (expected.kind === "label") {
        const provenance = primitive.provenance;
        if (primitive.labelPlacement !== "absolute" || !provenance || Object.keys(provenance).some(key => !["labelBounds", "labelCollisionBounds", "usesLeader"].includes(key)) || provenance.usesLeader !== false) fail(`unproved_compiled_label_provenance:${primitive.id}`);
        const bounds = provenance.labelBounds as { x: number; y: number; width: number; height: number } | undefined;
        if (!bounds || !keys(bounds as unknown as Record<string, unknown>, ["x", "y", "width", "height"]) || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || Math.abs(bounds.width - (Math.max(8, measureTextWidth(expected.text!, 24)) + 8)) > 0.00001 || bounds.height !== 32 || !close({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, primitive.points[0]!, 0.015)) fail(`unproved_compiled_label_bounds:${primitive.id}`);
        // The native em box and overflow collision ink are independently
        // measured from the proved text, never trusted as a solved-label flag.
        const ink = measureTextInkBounds(expected.text!, bounds.x + 4, bounds.y + 4, 24);
        const collision = provenance.labelCollisionBounds as typeof bounds;
        const overflows = ink && (ink.x < bounds.x || ink.y < bounds.y || ink.x + ink.width > bounds.x + bounds.width || ink.y + ink.height > bounds.y + bounds.height);
        if (overflows && ink) {
          const left = Math.min(bounds.x, ink.x), top = Math.min(bounds.y, ink.y);
          const checked = { x: left, y: top, width: Math.max(bounds.x + bounds.width, ink.x + ink.width) - left, height: Math.max(bounds.y + bounds.height, ink.y + ink.height) - top };
          if (!collision || !keys(collision as unknown as Record<string, unknown>, ["x", "y", "width", "height"]) || (Object.keys(checked) as (keyof typeof checked)[]).some(key => !Number.isFinite(collision[key]) || Math.abs(collision[key] - checked[key]) > 0.00001)) fail(`unproved_compiled_collision_bounds:${primitive.id}`);
        } else if (collision !== undefined) fail(`unproved_compiled_collision_bounds:${primitive.id}`);
      } else if (expected.kind === "rectangle") {
        if (!primitive.provenance || !keys(primitive.provenance as unknown as Record<string, unknown>, ["dashed", "strokeRole"]) || primitive.provenance.dashed !== true || primitive.provenance.strokeRole !== "construction") fail(`unproved_compiled_frame_style:${primitive.id}`);
      } else if (primitive.provenance !== undefined) fail(`unproved_compiled_stroke_style:${primitive.id}`);
      for (let i = 0; i < expected.points.length; i++) pairs.push({ world: expected.points[i]!, visible: primitive.points[i]! });
    }
    // Independently fit one isotropic world→canvas transform and check *every*
    // compiled point. Raw inputs above prohibit alternative compiler precedence.
    const mean = (key: "world" | "visible"): Point => scale(pairs.reduce((sum, p) => add(sum, p[key]), { x: 0, y: 0 }), 1 / pairs.length);
    const w = mean("world"), v = mean("visible");
    let numerator = 0, denominator = 0;
    for (const p of pairs) { const a = sub(p.world, w), b = sub(p.visible, v); numerator += a.x * b.x - a.y * b.y; denominator += dot(a, a); }
    const factor = numerator / denominator;
    if (!Number.isFinite(factor) || factor < 20 || factor > 200) fail("unsupported_compiled_transform");
    for (const p of pairs) if (!close(p.visible, { x: v.x + factor * (p.world.x - w.x), y: v.y - factor * (p.world.y - w.y) }, 0.015)) fail("compiled_geometry_transform_mismatch");
    if (JSON.stringify(scene.revealGroups) !== JSON.stringify(document.revealGroups) || JSON.stringify(scene.timeline) !== JSON.stringify(document.teachingTimeline)) fail("compiled_reveal_membership");
    const primitives = new Map(scene.primitives.map(p => [p.entityId, p]));
    return { ok: true, issues: [], renderScene: scene, proof: {
      version: "neutral-comparison-source-proof/v1", inert: true, originalQuestion: question,
      sourceBindings: species.map(s => ({ source: s.source, sourceIdentity: s.sourceIdentity, graphIdentity: s.graphIdentity })),
      virtualCarbonAnchors, bondStrokes,
      symbols: symbolDraft.map(s => ({ ...s, primitiveId: primitives.get(s.entityId)!.id, compiledAnchor: primitives.get(s.entityId)!.points[0]! })),
      nameLines: nameDraft.map(s => ({ ...s, primitiveId: primitives.get(s.entityId)!.id, compiledAnchor: primitives.get(s.entityId)!.points[0]! })),
      drawableEntityIds: [...drawable], limitations: ["inert; no admission/reveal/save consumer", "always ordinary raw compile; supplied scene only complete canonical-result witness; default native viewport and ink containment independently checked", "canonical source graph indexing/orientation/unit scale; per-component translation and array reorder supported", "neutral acyclic terminal C/O only; no physical/process/charged/aromatic authority"],
    } };
  } catch (error) { return { ok: false, issues: [error instanceof Error ? error.message : String(error)], proof: null }; }
}
