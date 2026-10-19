import { chemistryCountSourceClause } from "./structuralClauses";
import { vseprBondInkPlan, vseprGeometry } from "../vsepr";
import { registeredChemistryFormula } from "./registeredSpecies";
import { checkedVseprBondInk } from "./bondInk";
import type { RenderPrimitive, SceneDocument, SceneEntity, SceneIssue } from "../../types";
import { displayedSceneQuantityTexts, isMatrixExpressionLabel } from "../../contracts/contractsV3";
import { checkedChemistrySourceIdentity, chemistrySpeciesIdentity, chargeLabel, resolveChemistryStructure, sameOrganicGraph, type ResolvedChemistrySpecies } from "./species";
import { CHEMISTRY_REPRESENTATION_VERSION, type ChemistryRepresentation, type ChemistryStructuralQuantity, type ChemistryStructuralRule, type ChemistryStructuralText, type ChemistryStructureSymbolProvenance } from "./types";

export interface ChemistryRepresentationAudit {
  applicable: boolean;
  issues: SceneIssue[];
  representation: ChemistryRepresentation | null;
  species: Map<string, ResolvedChemistrySpecies>;
  structuralQuantityIds: Set<string>;
  structuralSymbolIds: Set<string>;
  /** Token-level projection: the physical remainder of a mixed label is preserved. */
  auditedTexts: string[];
  auditedTextOwners: Array<{ owner: "entity" | "annotation"; ownerId: string; text: string }>;
}

const RESOLVERS = new Set(["lewis", "vsepr", "organic", "coordination"]);
const RULES = new Set(["sigma_bonds", "pi_bonds", "lone_pairs", "valence_electrons", "electron_count", "charge", "formal_charge", "locant"]);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 512 && value.every((v) => typeof v === "string" && v.length > 0);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && new Set(a).size === a.length && a.every((id) => b.includes(id));

function bindingShape(value: unknown): boolean {
  if (!record(value) || !nonempty(value.speciesKey) || !nonempty(value.identityKey) || !RESOLVERS.has(String(value.resolver)) || !record(value.source)) return false;
  if (!integer(value.source.start) || !integer(value.source.end) || !nonempty(value.source.text) || !strings(value.entityIds)) return false;
  if (!Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > 64 || !value.nodes.every((node) => record(node) && nonempty(node.nodeKey) && nonempty(node.entityId) && (node.chargeEntityId === undefined || nonempty(node.chargeEntityId)) && strings(node.electronEntityIds))) return false;
  return Array.isArray(value.bonds) && value.bonds.length > 0 && value.bonds.length <= 128 && value.bonds.every((bond) => record(bond) && nonempty(bond.a) && nonempty(bond.b) && strings(bond.entityIds));
}

function ruleShape(value: unknown): value is ChemistryStructuralQuantity {
  return record(value) && nonempty(value.speciesKey) && RULES.has(String(value.rule)) && (value.nodeKey === undefined || nonempty(value.nodeKey)) && (value.locantIndex === undefined || integer(value.locantIndex));
}

export function readChemistryRepresentation(value: unknown): ChemistryRepresentation | null {
  if (!record(value) || value.version !== CHEMISTRY_REPRESENTATION_VERSION || !strings(value.structuralEntityIds)) return null;
  if (!Array.isArray(value.species) || value.species.length === 0 || value.species.length > 28 || !value.species.every(bindingShape)) return null;
  if (!Array.isArray(value.structuralQuantities) || value.structuralQuantities.length > 256 || !value.structuralQuantities.every((q) => ruleShape(q) && record(q) && nonempty(q.quantityId))) return null;
  if (!Array.isArray(value.structuralTexts) || value.structuralTexts.length > 512 || !value.structuralTexts.every((t) => record(t) && (ruleShape(t) || (t.rule === "species" && nonempty(t.speciesKey))) && ["entity", "annotation"].includes(String(t.owner)) && nonempty(t.ownerId) && integer(t.start) && integer(t.end))) return null;
  return value as unknown as ChemistryRepresentation;
}

/** Recomputed structural facts, not metadata flags, authorize each exception. */
export function auditChemistryRepresentation(document: SceneDocument, question: string): ChemistryRepresentationAudit {
  const audit: ChemistryRepresentationAudit = {
    applicable: document.source.chemistryRepresentation !== undefined, issues: [], representation: null,
    species: new Map(), structuralQuantityIds: new Set(), structuralSymbolIds: new Set(),
    auditedTexts: displayedSceneQuantityTexts(document), auditedTextOwners: [],
  };
  const issue = (code: string, message: string, entityIds: string[] = []): void => {
    audit.issues.push({ code, message, severity: "fatal", entityIds, path: "source.chemistryRepresentation" });
  };
  if (!audit.applicable) {
    if (document.entities.some((entity) => entity.provenance?.chemistryRepresentation !== undefined)) issue("chemistry_structure_unbound", "a structural role has no source species binding");
    return audit;
  }
  const metadata = readChemistryRepresentation(document.source.chemistryRepresentation);
  if (!metadata) { issue("chemistry_representation_invalid", "invalid chemistry-representation/v1 metadata"); return audit; }
  audit.representation = metadata;
  if (document.source.question !== question) issue("chemistry_source_mismatch", "chemistry source question does not match the original question");
  const entities = new Map(document.entities.map((entity) => [entity.id, entity]));
  const representedIds: string[] = [];
  const symbolIds = new Set<string>();
  for (const binding of metadata.species) {
    if (audit.species.has(binding.speciesKey)) { issue("chemistry_duplicate_species", `duplicate species key ${binding.speciesKey}`); continue; }
    if (document.source.chemistryFamily !== `chem_${binding.resolver}`) {
      issue("chemistry_family_mismatch", `resolver ${binding.resolver} is not the document's engine chemistry family`); continue;
    }
    const { text } = binding.source;
    if (!checkedChemistrySourceIdentity(question, binding.source, binding.identityKey)) {
      issue("chemistry_source_span", `species ${binding.speciesKey} has no matching complete original source span`); continue;
    }
    const resolved = resolveChemistryStructure(text, binding.resolver);
    if (!resolved || resolved.identityKey !== binding.identityKey) {
      issue("chemistry_species_identity", `species ${text} has unsupported or conflicting source identity`); continue;
    }
    audit.species.set(binding.speciesKey, resolved);
    if (!sameSet(binding.nodes.map((node) => node.nodeKey), resolved.nodes.map((node) => node.key))) issue("chemistry_incomplete_nodes", `species ${text} is missing or repeats a source node`);
    const nodeEntities = new Map(binding.nodes.map((node) => [node.nodeKey, node.entityId]));
    const owned: string[] = [];
    for (const node of binding.nodes) {
      const expected = resolved.nodes.find((n) => n.key === node.nodeKey);
      const entity = entities.get(node.entityId);
      owned.push(node.entityId, ...node.electronEntityIds, ...(node.chargeEntityId ? [node.chargeEntityId] : []));
      if (!expected || !entity) { issue("chemistry_missing_node", `missing source node ${node.nodeKey}`, [node.entityId]); continue; }
      if (expected.label === null) {
        if (entity.kind !== "point" || entity.label !== undefined) issue("chemistry_node_symbol", `skeletal node ${node.nodeKey} is not an unlabelled vertex`, [entity.id]);
      } else {
        if (entity.kind !== "label" || entity.label !== expected.label) issue("chemistry_node_symbol", `node ${node.nodeKey} has a conflicting structural symbol`, [entity.id]);
        symbolIds.add(entity.id);
      }
      if (node.electronEntityIds.length !== expected.nonbondedElectrons || node.electronEntityIds.some((id) => entities.get(id)?.kind !== "point")) issue("chemistry_electron_count", `node ${node.nodeKey} has the wrong source-derived nonbonded electron count`, node.electronEntityIds);
      if (node.chargeEntityId) {
        const charge = entities.get(node.chargeEntityId);
        if (expected.charge === 0 || charge?.kind !== "label" || charge.label !== chargeLabel(expected.charge)) issue("chemistry_formal_charge", `node ${node.nodeKey} has the wrong formal charge`, [node.chargeEntityId]);
        symbolIds.add(node.chargeEntityId);
      } else if (expected.charge !== 0 && binding.resolver === "lewis") issue("chemistry_formal_charge", `node ${node.nodeKey} is missing its formal charge`);
    }
    const edgeKey = (a: string, b: string): string => [a, b].sort().join("|");
    if (!sameSet(binding.bonds.map((bond) => edgeKey(bond.a, bond.b)), resolved.bonds.map((bond) => edgeKey(bond.a, bond.b)))) issue("chemistry_incomplete_bonds", `species ${text} is missing or repeats a source bond`);
    const inkPlan = binding.resolver === "vsepr" ? (() => {
      const result = vseprGeometry(registeredChemistryFormula(text) ?? text);
      return result ? vseprBondInkPlan(result) : null;
    })() : null;
    if (binding.resolver === "vsepr" && (!inkPlan || inkPlan.length !== binding.bonds.length)) issue("chemistry_bond_topology", `species ${text} has no complete source-derived bond ink plan`);
    for (const [bondIndex, bond] of binding.bonds.entries()) {
      owned.push(...bond.entityIds);
      const expected = resolved.bonds.find((candidate) => edgeKey(candidate.a, candidate.b) === edgeKey(bond.a, bond.b));
      const operator = inkPlan?.[bondIndex];
      const inkHolds = binding.resolver === "vsepr"
        ? operator !== undefined && resolved.nodes.find((node) => node.key === bond.b)?.label === operator.ligandLabel && checkedVseprBondInk(document, bond.entityIds, nodeEntities.get(bond.a), nodeEntities.get(bond.b), operator)
        : bond.entityIds.length === expected?.order && bond.entityIds.every((id) => bondAttached(document, id, nodeEntities.get(bond.a), nodeEntities.get(bond.b)))
          && separateBondStrokes(document, bond.entityIds, nodeEntities.get(bond.a), nodeEntities.get(bond.b));
      if (!expected || !inkHolds) issue("chemistry_bond_topology", `species ${text} has an incomplete or detached bond ${bond.a}-${bond.b}`, bond.entityIds);
    }
    if (!sameSet(binding.entityIds, owned)) issue("chemistry_membership", `species ${text} structural membership differs from its source topology`);
    representedIds.push(...owned);
    for (const id of owned) {
      const entity = entities.get(id);
      if (!entity) continue;
      if (!document.requiredEntityIds.includes(id) || !document.revealGroups.some((group) => group.entityIds.includes(id))) issue("chemistry_structure_uncovered", `structural entity ${id} is not required and revealed`, [id]);
    }
  }
  if (document.source.chemistryFamily === "chem_vsepr") {
    const unbound = document.entities.filter((entity) => (entity.kind === "segment" || entity.kind === "polygon") && document.requiredEntityIds.includes(entity.id) && !representedIds.includes(entity.id));
    if (unbound.length) issue("chemistry_bond_topology", "VSEPR contains required strokes outside its complete source-derived ink plan", unbound.map((entity) => entity.id));
  }
  if (!sameSet(metadata.structuralEntityIds, representedIds)) issue("chemistry_membership", "structuralEntityIds is not the complete independently checked structure set");
  for (const entity of document.entities) {
    if (entity.provenance?.chemistryRepresentation === undefined) continue;
    const role = entity.provenance.chemistryRepresentation;
    if (!symbolIds.has(entity.id) || !record(role) || role.version !== CHEMISTRY_REPRESENTATION_VERSION || role.role !== "structure_symbol") issue("chemistry_forged_symbol", `entity ${entity.id} claims an unbound structural-symbol role`, [entity.id]);
  }
  for (const record of metadata.structuralQuantities) {
    const value = structuralValue(record, audit.species);
    const quantity = document.quantities.find((q) => q.id === record.quantityId);
    if (audit.structuralQuantityIds.has(record.quantityId) || value === null || !quantity || quantity.value !== value || ![undefined, "", "1", "dimensionless"].includes(quantity.unit as string | undefined)) issue("chemistry_structural_quantity", `quantity ${record.quantityId} is not the recomputed structural fact ${record.rule}`);
    else audit.structuralQuantityIds.add(record.quantityId);
  }
  const masked = new Map<string, string>();
  const spans = new Map<string, Array<[number, number]>>();
  for (const token of metadata.structuralTexts) {
    const key = `${token.owner}:${token.ownerId}`;
    const text = token.owner === "entity" ? entities.get(token.ownerId)?.label : document.annotations.find((a) => a.id === token.ownerId)?.text;
    const resolved = audit.species.get(token.speciesKey);
    const binding = metadata.species.find((s) => s.speciesKey === token.speciesKey);
    if (typeof text !== "string" || !resolved || !binding || token.end <= token.start || token.end > text.length || !textTokenHolds(text, token, resolved, metadata.species.length > 1)) {
      issue("chemistry_structural_text", `text token ${key} is not the recomputed source fact ${token.rule}`); continue;
    }
    const occupied = spans.get(key) ?? [];
    if (occupied.some(([a, b]) => token.start < b && token.end > a)) { issue("chemistry_structural_text", `overlapping structural tokens in ${key}`); continue; }
    occupied.push([token.start, token.end]); spans.set(key, occupied);
    const projected = masked.get(key) ?? text;
    masked.set(key, projected.slice(0, token.start) + " ".repeat(token.end - token.start) + projected.slice(token.end));
  }
  // Invalid metadata grants no admission or reveal exceptions, even if some records were valid.
  if (audit.issues.length === 0) {
    audit.structuralSymbolIds = symbolIds;
    audit.auditedTextOwners = [
      ...document.entities.filter((e) => !isMatrixExpressionLabel(document, e)).flatMap((e) => typeof e.label === "string" ? [{ owner: "entity" as const, ownerId: e.id, text: symbolIds.has(e.id) ? " ".repeat(e.label.length) : masked.get(`entity:${e.id}`) ?? e.label }] : []),
      ...document.annotations.flatMap((a) => typeof a.text === "string" ? [{ owner: "annotation" as const, ownerId: a.id, text: masked.get(`annotation:${a.id}`) ?? a.text }] : []),
    ];
    audit.auditedTexts = audit.auditedTextOwners.map((owner) => owner.text);
  } else audit.structuralQuantityIds.clear();
  return audit;
}

function structuralValue(record: Pick<ChemistryStructuralQuantity, "speciesKey" | "rule" | "nodeKey" | "locantIndex">, species: Map<string, ResolvedChemistrySpecies>): number | null {
  const resolved = species.get(record.speciesKey);
  if (!resolved) return null;
  if (record.rule === "formal_charge") return resolved.nodes.find((n) => n.key === record.nodeKey)?.charge ?? null;
  if (record.rule === "locant") return resolved.locants[record.locantIndex ?? -1] ?? null;
  return resolved.facts[record.rule] ?? null;
}

const COUNT_PREFIX: Partial<Record<ChemistryStructuralRule, RegExp>> = {
  sigma_bonds: /(?:σ|sigma(?: bonds?)?)\s*=\s*$/iu,
  pi_bonds: /(?:π|pi(?: bonds?)?)\s*=\s*$/iu,
  lone_pairs: /lone\s+pairs?\s*=\s*$/iu,
  valence_electrons: /valence\s+electrons?\s*=\s*$/iu,
  electron_count: /(?:total\s+)?electrons?\s*=\s*$/iu,
  charge: /(?:net\s+)?charge\s*=\s*$/iu,
  formal_charge: /formal\s+charge\s*=\s*$/iu,
};

function textTokenHolds(text: string, token: ChemistryStructuralText, resolved: ResolvedChemistrySpecies, requireSpeciesClause: boolean): boolean {
  const literal = text.slice(token.start, token.end);
  if (token.rule === "species") {
    const identity = chemistrySpeciesIdentity(literal);
    return identity !== null && checkedChemistrySourceIdentity(text, { start: token.start, end: token.end, text: literal }, identity.key) !== null &&
      (identity.key === resolved.identityKey || (identity.kind === "formula" && identity.key === `formula:${resolved.formulaKey}`) || (identity.molecule !== undefined && resolved.molecule !== undefined && sameOrganicGraph(identity.molecule, resolved.molecule)));
  }
  const value = structuralValue({ ...token, rule: token.rule }, new Map([[token.speciesKey, resolved]]));
  if (value === null || !/^[+-]?\d+$/.test(literal) || Number(literal) !== value) return false;
  if (token.rule === "locant") {
    const identity = chemistrySpeciesIdentity(text);
    return identity?.molecule !== undefined && resolved.molecule !== undefined && sameOrganicGraph(identity.molecule, resolved.molecule) && /(?:^|[^A-Za-z\d])$/.test(text.slice(0, token.start)) && /^[,-]/.test(text.slice(token.end));
  }
  if (requireSpeciesClause) {
    const clause = chemistryCountSourceClause(text, token.start);
    if (!clause || !checkedChemistrySourceIdentity(text, clause, resolved.identityKey)) return false;
  }
  return Boolean(COUNT_PREFIX[token.rule]?.test(text.slice(0, token.start)) && /^\s*(?:[,;]|$)/.test(text.slice(token.end)));
}

function anchor(document: SceneDocument, id: string | undefined, seen = new Set<string>()): { x: number; y: number } | null {
  if (!id || seen.has(id)) return null;
  seen.add(id);
  const construction = document.constructions.find((c) => c.outputs.includes(id));
  if (!construction) return null;
  const input = construction.inputs;
  if (construction.operator === "point" && typeof input.x === "number" && typeof input.y === "number" && Number.isFinite(input.x) && Number.isFinite(input.y)) return { x: input.x, y: input.y };
  if (construction.operator === "label") return anchor(document, typeof input.target === "string" ? input.target : undefined, seen);
  return null;
}

function bondAttached(document: SceneDocument, id: string, first: string | undefined, second: string | undefined): boolean {
  const a = anchor(document, first), b = anchor(document, second);
  const construction = document.constructions.find((c) => c.outputs.includes(id));
  if (!a || !b || !construction) return false;
  let start: { x: number; y: number } | null = null, end: { x: number; y: number } | null = null;
  if (construction.operator === "segment") {
    start = anchor(document, typeof construction.inputs.start === "string" ? construction.inputs.start : undefined);
    end = anchor(document, typeof construction.inputs.end === "string" ? construction.inputs.end : undefined);
  } else if (construction.operator === "polygon" && Array.isArray(construction.inputs.points) && construction.inputs.points.length === 3) {
    const points = construction.inputs.points.map((p) => anchor(document, typeof p === "string" ? p : undefined));
    if (points.some((p) => p === null)) return false;
    start = points[0]!; end = { x: (points[1]!.x + points[2]!.x) / 2, y: (points[1]!.y + points[2]!.y) / 2 };
  }
  if (!start || !end) return false;
  const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-16) return false;
  const fraction = (p: { x: number; y: number }): number => ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  const offset = (p: { x: number; y: number }): number => ((p.x - a.x) * dy - (p.y - a.y) * dx) / lengthSquared;
  const low = Math.min(fraction(start), fraction(end)), high = Math.max(fraction(start), fraction(end));
  // SceneBuilder rounds world point coordinates to four decimal places.
  const roundingTolerance = 4e-4 / Math.sqrt(lengthSquared);
  return low >= -roundingTolerance && low < 0.45 && high > 0.55 && high <= 1 + roundingTolerance && Math.abs(offset(start)) < 0.15 && Math.abs(offset(end)) < 0.15 && Math.abs(offset(start) - offset(end)) <= roundingTolerance;
}

/** Multiplicity needs separate parallel ink, not several names for one axis. */
function separateBondStrokes(document: SceneDocument, ids: readonly string[], first: string | undefined, second: string | undefined): boolean {
  if (ids.length < 2) return true;
  if (new Set(ids).size !== ids.length) return false;
  const a = anchor(document, first), b = anchor(document, second);
  if (!a || !b) return false;
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
  if (squared <= 1e-16) return false;
  const tolerance = 4e-4 / Math.sqrt(squared);
  const project = (point: { x: number; y: number }) => ({ t: ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared,
    n: ((point.x - a.x) * dy - (point.y - a.y) * dx) / squared });
  const strokes: Array<{ low: number; high: number; first: number; last: number }> = [];
  for (const id of ids) {
    const construction = document.constructions.find(value => value.outputs.includes(id));
    if (construction?.operator !== "segment") return false;
    const start = anchor(document, typeof construction.inputs.start === "string" ? construction.inputs.start : undefined);
    const end = anchor(document, typeof construction.inputs.end === "string" ? construction.inputs.end : undefined);
    if (!start || !end) return false;
    const points = [project(start), project(end)].sort((left, right) => left.t - right.t);
    if (points[1]!.t <= points[0]!.t || Math.abs(points[0]!.n - points[1]!.n) > tolerance) return false;
    strokes.push({ low: points[0]!.t, high: points[1]!.t, first: points[0]!.n, last: points[1]!.n });
  }
  const offset = (stroke: typeof strokes[number], t: number) => stroke.first + (stroke.last - stroke.first) * (t - stroke.low) / (stroke.high - stroke.low);
  for (let i = 0; i < strokes.length; i += 1) for (let j = i + 1; j < strokes.length; j += 1) {
    const left = strokes[i]!, right = strokes[j]!, low = Math.max(left.low, right.low), high = Math.min(left.high, right.high);
    if (high - low + tolerance < .5 * Math.max(left.high - left.low, right.high - right.low)) return false;
    const firstGap = offset(right, low) - offset(left, low), lastGap = offset(right, high) - offset(left, high);
    if (firstGap * lastGap <= 0 || Math.min(Math.abs(firstGap), Math.abs(lastGap)) <= tolerance) return false;
  }
  return true;
}

/** Internal compiler guard: mathematically separate lines must remain separate
 * native ink. World-coordinate tolerances alone cannot prove a visible bond. */
export function chemistryNativeBondInkIssues(audit: ChemistryRepresentationAudit, primitives: readonly RenderPrimitive[]): SceneIssue[] {
  if (!audit.applicable || audit.issues.length || !audit.representation) return [];
  // Whiteboard SHAPE_STROKE_WIDTH and INK_THICKNESS_MAX. Use the widest
  // supported instrument, including pen, rather than only the thinner pencil.
  const defaultWidth = 1.15, maximumThickness = 1.6;
  // Compiler endpoints are rounded to .01px; two endpoint differences can
  // accumulate this bound when testing parallel projected strokes.
  const rounding = 2 * Math.SQRT2 * .01;
  const issues: SceneIssue[] = [];
  for (const binding of audit.representation.species) {
    if (binding.resolver === "vsepr") continue; // Its separate wedge/dash plan is independently checked.
    for (const bond of binding.bonds) {
      if (bond.entityIds.length < 2) continue;
      const marks = bond.entityIds.map(id => primitives.filter(mark => mark.entityId === id));
      const fail = (): void => { issues.push({ code: "chemistry_bond_native_ink", severity: "fatal", failureKind: "truth",
        path: "source.chemistryRepresentation", entityIds: [...bond.entityIds], message: "Source multiple-bond strokes are not distinct overlapping parallel native ink" }); };
      if (marks.some(owned => owned.length !== 1 || owned[0]!.kind !== "line" || owned[0]!.points.length !== 2)) { fail(); continue; }
      const strokes = marks.map(owned => owned[0]!);
      const widths = strokes.map(stroke => {
        const provenance = stroke.provenance ?? {};
        // Dashed/fill/annotation/alternate paint semantics cannot certify this
        // ordinary molecular stroke. A supplied width must be real visible ink.
        if (Object.keys(provenance).some(key => key !== "strokeWidth")) return null;
        const width = provenance.strokeWidth ?? defaultWidth;
        return typeof width === "number" && Number.isFinite(width) && width > 0 ? width * maximumThickness : null;
      });
      if (widths.some(width => width === null)) { fail(); continue; }
      let valid = true;
      for (let i = 0; valid && i < strokes.length; i += 1) for (let j = i + 1; valid && j < strokes.length; j += 1) {
        const [a, b] = strokes[i]!.points, dx = b!.x - a!.x, dy = b!.y - a!.y, length = Math.hypot(dx, dy);
        if (!(length > 0) || !Number.isFinite(length)) { valid = false; break; }
        const projected = strokes[j]!.points.map(point => ({ t: ((point.x - a!.x) * dx + (point.y - a!.y) * dy) / length,
          n: ((point.x - a!.x) * dy - (point.y - a!.y) * dx) / length })).sort((left, right) => left.t - right.t);
        const [start, end] = projected;
        if (!start || !end || ![start.t, start.n, end.t, end.n].every(Number.isFinite) || end.t <= start.t || Math.abs(end.n - start.n) > rounding) { valid = false; break; }
        const low = Math.max(0, start.t), high = Math.min(length, end.t);
        if (high - low + rounding < .5 * Math.max(length, end.t - start.t)) { valid = false; break; }
        const offset = (t: number) => start.n + (end.n - start.n) * (t - start.t) / (end.t - start.t);
        const firstGap = offset(low), lastGap = offset(high);
        const inkRadius = (widths[i]! + widths[j]!) / 2;
        if (firstGap * lastGap <= 0 || Math.min(Math.abs(firstGap), Math.abs(lastGap)) <= inkRadius) valid = false;
      }
      if (!valid) fail();
    }
  }
  return issues;
}

/** Compiler calls this only with the result of a complete source audit. */
export function chemistryStructureSymbolProvenance(audit: ChemistryRepresentationAudit, entity: SceneEntity | undefined): ChemistryStructureSymbolProvenance | undefined {
  if (!entity || audit.issues.length > 0 || !audit.structuralSymbolIds.has(entity.id)) return undefined;
  return { version: CHEMISTRY_REPRESENTATION_VERSION, role: "structure_symbol" };
}

/** Solved primitive provenance plus independently checked document membership, not role text/pinLabel. */
export function isChemistryStructureSymbolPrimitive(primitive: RenderPrimitive, audit: ChemistryRepresentationAudit): boolean {
  const role = primitive.provenance?.chemistryRepresentation;
  return audit.issues.length === 0 && audit.structuralSymbolIds.has(primitive.entityId) && primitive.kind === "label" && primitive.provenance?.annotationId === undefined && record(role) && role.version === CHEMISTRY_REPRESENTATION_VERSION && role.role === "structure_symbol";
}
