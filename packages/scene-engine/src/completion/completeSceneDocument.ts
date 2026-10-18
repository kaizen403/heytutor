import { sceneUnitSignature, validateTurnPlanV3, type TurnPlanQuantityV3, type TurnPlanV3 } from "../contracts/contractsV3";
import { compileSceneDocument } from "../compile/compiler";
import { isPointIdentifierText } from "../compile/pointLabelText";
import type { RenderScene, SceneConstruction, SceneDocument } from "../types";
import { angleUnit, isRecord, norm, perpendicular, PlanarGeometry, samePoint, subtract } from "./planarGeometry";

export interface SceneCompletionInput {
  enabled?: boolean;
  turnPlan: TurnPlanV3;
  baseRenderScene: RenderScene;
  solverAuthority?: unknown;
}

export interface SceneCompletionAddition {
  id: string;
  kind: "given_label" | "given_angle" | "unknown_label" | "right_angle";
  quantityIds: string[];
  targetIds: string[];
  text?: string;
}

export interface SceneCompletionSkip {
  code: string;
  quantityId?: string;
  entityIds?: string[];
}

export interface SceneCompletionResult {
  document: SceneDocument;
  addedEntityIds: string[];
  addedAnnotationIds: string[];
  additions: SceneCompletionAddition[];
  skipped: SceneCompletionSkip[];
}

const MAX_ADDITIONS = 32;
const MAX_REFERENCE_DEPTH = 32;
type Given = TurnPlanQuantityV3;
type Proposal = Omit<SceneCompletionAddition, "id">;

function stableId(kind: string, values: string[]): string {
  let hash = 2166136261;
  for (const character of JSON.stringify(values)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `completion_${kind}_${(hash >>> 0).toString(36)}`;
}
function sameIds(first: readonly string[], second: readonly string[]): boolean {
  if (first.length !== second.length) return false;
  const left = [...first].sort(), right = [...second].sort();
  return left.every((id, index) => id === right[index]);
}
function statement(quantity: { symbol: string; value?: number; unit?: string }): string {
  const unit = quantity.unit === undefined ? "" : angleUnit(quantity.unit) === "degree" ? "°" : ` ${boardUnit(quantity.unit)}`;
  return `${quantity.symbol} = ${quantity.value === undefined ? "?" : boardNumber(quantity.value)}${unit}`;
}
function compactText(value: string): string { return value.replace(/\s+/g, ""); }
function ownerSymbol(value: string): string {
  return value.normalize("NFKC").replace(/_\{([\p{L}\p{N}]+)\}/gu, "$1").replace(/_([\p{L}\p{N}]+)/gu, "$1").replace(/\s+/g, "");
}
function boardNumber(value: number): string {
  const [mantissa, exponent] = String(value).split("e");
  return exponent === undefined ? String(value) : `${mantissa} × 10${superscript(String(Number(exponent)))}`;
}
function superscript(value: string): string {
  return [...value].map(character => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(character)] ?? (character === "-" ? "⁻" : character)).join("");
}
function boardUnit(value: string): string { return value.replace(/\^([+-]?\d+)/g, (_match, exponent: string) => superscript(exponent)); }
/** Comparison only: native text is never rewritten or used to prove a value. */
function canonicalStatement(value: string): string {
  return value.normalize("NFKC").replace(/−/g, "-").replace(/[\s_{}]/g, "")
    .replace(/degrees?|deg/g, "°")
    .replace(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi, number => String(Number(number)));
}
function nativeLabelTarget(construction: SceneConstruction): unknown {
  if (construction.operator !== "label") return undefined;
  for (const key of ["target", "at", "point"]) {
    if (construction.inputs[key] !== undefined) return construction.inputs[key];
  }
  return undefined;
}

/** Exact structured joins only. Geometry proofs use the stock compiler and world inputs. */
class CompletionContext {
  readonly quantities = new Map<string, SceneDocument["quantities"][number]>();
  readonly givens = new Map<string, Given>();
  readonly producers = new Map<string, SceneConstruction>();
  readonly entities = new Map<string, SceneDocument["entities"][number]>();
  readonly geometry: PlanarGeometry;
  readonly skipped: SceneCompletionSkip[] = [];
  readonly additions: SceneCompletionAddition[] = [];
  readonly typedOwners = new Map<string, Set<string>>();
  private next: SceneDocument | null = null;

  constructor(readonly document: SceneDocument, readonly input: SceneCompletionInput) {
    for (const quantity of document.quantities) this.quantities.set(quantity.id, quantity);
    for (const quantity of input.turnPlan.givens) this.givens.set(quantity.id, quantity);
    for (const entity of document.entities) this.entities.set(entity.id, entity);
    for (const construction of document.constructions) {
      for (const output of construction.outputs) this.producers.set(output, construction);
    }
    this.geometry = new PlanarGeometry(document);
  }
  skip(code: string, quantityId?: string, entityIds?: string[]): void {
    if (this.skipped.length < 256) this.skipped.push({ code, ...(quantityId ? { quantityId } : {}), ...(entityIds ? { entityIds } : {}) });
  }
  number(value: unknown, seen = new Set<unknown>(), depth = 0): number | null {
    if (depth > MAX_REFERENCE_DEPTH || seen.has(value)) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (isRecord(value) && "value" in value) {
      seen.add(value); return this.number(value.value, seen, depth + 1);
    }
    if (typeof value !== "string" || !value.trim()) return null;
    const quantity = this.quantities.get(value);
    if (quantity) { seen.add(value); return this.number(quantity.value, seen, depth + 1); }
    const number = Number(value);
    const decimal = /^[+-]?((?:\d+(?:\.\d*)?|\.\d+))(?:[eE][+-]?\d+)?$/.exec(value.trim());
    if (number === 0 && decimal && /[1-9]/.test(decimal[1]!)) return null;
    return Number.isFinite(number) ? number : null;
  }
  /** Wrappers and quantity chains are references, never a join by equal number. */
  given(value: unknown): Given | null {
    const seen = new Set<unknown>();
    const referenced: Given[] = [];
    const wrapperUnits: unknown[] = [];
    let current = value;
    for (let depth = 0; depth <= MAX_REFERENCE_DEPTH; depth += 1) {
      if (seen.has(current)) return null;
      if (isRecord(current) && "value" in current) {
        seen.add(current);
        if (current.unit !== undefined) wrapperUnits.push(current.unit);
        current = current.value;
      } else if (typeof current === "string" && this.quantities.has(current)) {
        seen.add(current);
        const quantity = this.quantities.get(current)!;
        const given = this.givens.get(current);
        if (given) {
          if (quantity.symbol !== given.symbol || quantity.unit !== given.unit ||
              (quantity.provenance !== undefined && quantity.provenance !== "given") ||
              this.number(quantity.value) !== given.value) {
            this.skip("given_scene_mismatch", given.id);
            return null;
          }
          referenced.push(given);
        }
        if (quantity.unit !== undefined) wrapperUnits.push(quantity.unit);
        current = quantity.value;
      } else {
        const unique = [...new Map(referenced.map(given => [given.id, given])).values()];
        if (unique.length !== 1) return null;
        const given = unique[0]!;
        if (this.number(current) !== given.value || wrapperUnits.some(unit => unit !== given.unit)) return null;
        return given;
      }
    }
    return null;
  }
  rendered(id: string): boolean {
    const entity = this.entities.get(id);
    const producer = this.producers.get(id);
    return this.input.baseRenderScene.primitives.some(primitive => primitive.entityId === id && primitive.provenance?.labelLeader !== true &&
      (primitive.kind !== "label" || (entity?.kind === "point" && ["point", "space_point"].includes(producer?.operator ?? "") &&
        entity.label !== undefined && primitive.text === entity.label)));
  }
  /** A new mark stays in the one existing scope that actually reveals its owner. */
  ownerGroup(id: string): number | null {
    const declared = this.document.revealGroups.flatMap((group, index) => group.entityIds.flatMap(member => member === id ? [index] : []));
    if (declared.length === 1) return declared[0]!;
    if (declared.length > 1) return null;
    const rendered = new Set(this.input.baseRenderScene.primitives.filter(primitive => primitive.entityId === id && primitive.kind !== "label" &&
      primitive.provenance?.labelLeader !== true).map(primitive => primitive.groupId));
    if (rendered.size !== 1) return null;
    const group = this.document.revealGroups.findIndex(candidate => candidate.id === [...rendered][0]);
    return group < 0 ? null : group;
  }
  own(givens: Given[], target: string): void {
    for (const given of givens) {
      const owners = this.typedOwners.get(given.id) ?? new Set<string>();
      owners.add(target); this.typedOwners.set(given.id, owners);
    }
  }
  existingQuantityStatement(quantityIds: string[], target: string): string | null {
    const symbols = new Set(quantityIds.map(id => this.quantities.get(id)?.symbol).filter((symbol): symbol is string => typeof symbol === "string"));
    const nativeOwners = new Set([target, ...this.document.constructions.filter(construction =>
      nativeLabelTarget(construction) === target).flatMap(construction => construction.outputs)]);
    // An existing native statement belongs to this exact drawn owner. Its
    // complete source symbol and assignment are enough to abstain; its numeric
    // spelling never supplies authority or needs to be rewritten (7.50 / 7.5).
    if (this.input.baseRenderScene.primitives.some(primitive => primitive.kind === "label" && nativeOwners.has(primitive.entityId) &&
        typeof primitive.text === "string" && [...symbols].some(symbol => {
          const prefix = canonicalStatement(symbol), text = canonicalStatement(primitive.text!);
          const quantity = quantityIds.map(id => this.quantities.get(id)).find(quantity => quantity?.symbol === symbol);
          return (text.startsWith(`${prefix}=`) && text.length > prefix.length + 1) ||
            (quantity?.value !== undefined && text === canonicalStatement(`${symbol}${quantity.value}${quantity.unit ?? ""}`));
        }))) return "existing_quantity_native_statement";
    for (const annotation of this.document.annotations) {
      if (!annotation.quantityId || !["label", "callout"].includes(annotation.kind) ||
          annotation.targetIds.length !== 1 || annotation.targetIds[0] !== target) continue;
      const sameId = quantityIds.includes(annotation.quantityId);
      const symbol = this.quantities.get(annotation.quantityId)?.symbol;
      if (!sameId && (typeof symbol !== "string" || !symbols.has(symbol))) continue;
      // Existing native annotation ink is preserved, not parsed or repaired.
      // A same-symbol alias is only a reason to abstain, never an owner join.
      if (this.input.baseRenderScene.primitives.some(primitive => primitive.kind === "label" && primitive.id === annotation.id &&
          primitive.entityId === target && typeof primitive.text === "string" && primitive.text.trim() &&
          !isPointIdentifierText(primitive.text))) {
        return sameId ? "existing_quantity_annotation_statement" : "ambiguous_same_symbol_annotation_statement";
      }
    }
    return null;
  }
  label(proposal: Proposal): void {
    const target = proposal.targetIds[0];
    if (!target || proposal.targetIds.length !== 1 || !proposal.text || !this.rendered(target)) {
      this.skip("target_not_rendered", proposal.quantityIds[0], proposal.targetIds); return;
    }
    const group = this.ownerGroup(target);
    if (group === null) { this.skip("ambiguous_reveal_scope", proposal.quantityIds[0], [target]); return; }
    const existingStatement = this.existingQuantityStatement(proposal.quantityIds, target);
    if (existingStatement) { this.skip(existingStatement, proposal.quantityIds[0], [target]); return; }
    const id = stableId(proposal.kind, [target, ...proposal.quantityIds, proposal.text]);
    const existingOwners = new Set([target, ...this.document.constructions.filter(construction =>
      nativeLabelTarget(construction) === target).flatMap(construction => construction.outputs)]);
    if (this.input.baseRenderScene.primitives.some(primitive => primitive.kind === "label" && existingOwners.has(primitive.entityId) &&
        typeof primitive.text === "string" && canonicalStatement(primitive.text) === canonicalStatement(proposal.text!))) {
      this.skip("already_labelled", proposal.quantityIds[0], [target]); return;
    }
    if (this.additions.some(addition => addition.id === id)) return;
    if (this.entities.has(id) || this.document.annotations.some(annotation => annotation.id === id) || this.document.constructions.some(construction => construction.id === `construct_${id}`) ||
        this.document.assertions.some(assertion => assertion.id === `assert_${id}`)) {
      this.skip("completion_id_collision", proposal.quantityIds[0], [target]); return;
    }
    if (this.additions.length >= MAX_ADDITIONS) { this.skip("addition_budget", proposal.quantityIds[0], [target]); return; }
    const next = this.next ??= structuredClone(this.document);
    const producer = this.producers.get(target);
    if (producer && ["angle_mark", "space_point", "space_vector"].includes(producer.operator)) {
      // The native annotation path owns the arc/world projection. A quantityId
      // would instead route labelled owners into a view-summary block.
      next.annotations.push({ id, kind: "label", targetIds: [target], text: proposal.text, labelMode: "append" });
    } else {
      next.entities.push({ id, kind: "label", role: "restated structured source quantity", label: proposal.text });
      next.constructions.push({ id: `construct_${id}`, operator: "label", inputs: { target, text: proposal.text }, outputs: [id] });
      next.assertions.push({ id: `assert_${id}`, predicate: "exists", entities: [id], expected: true, severity: "fatal" });
      next.requiredEntityIds.push(id);
      next.revealGroups[group]!.entityIds.push(id);
    }
    this.additions.push({ id, ...proposal });
  }
  result(): SceneCompletionResult {
    return { document: this.next ?? this.document,
      addedEntityIds: this.additions.filter(addition => this.next?.entities.some(entity => entity.id === addition.id)).map(addition => addition.id),
      addedAnnotationIds: this.additions.filter(addition => this.next?.annotations.some(annotation => annotation.id === addition.id)).map(addition => addition.id),
      additions: this.additions, skipped: this.skipped };
  }
  /** An attachment edge cannot create a scalar owner. Only an existing unique
   * source symbol on the actual drawn entity supplies this conservative join. */
  scalarOwner(target: string, symbol: string, quantityId: string): boolean {
    const entity = this.entities.get(target);
    const producer = this.producers.get(target);
    const bodyCarrier = (producer?.operator === "rectangle" && entity?.kind === "rectangle") ||
      (producer?.operator === "circle" && entity?.kind === "circle") || (producer?.operator === "symbol" && entity?.kind === "component");
    const signature = sceneUnitSignature(this.quantities.get(quantityId)?.unit);
    // An identity join proves an external body attribute, never its native
    // radius/extent/area or an arbitrary curve/vector's numeric magnitude.
    // Volume/dioptre atoms are left unjudged by the existing unit algebra.
    if (!bodyCarrier || !entity || typeof entity.label !== "string" || !entity.label || !signature || /^m\^-?\d+$/.test(signature) ||
        signature.split("·").some(term => /^(?:L|D)\^/.test(term))) return false;
    const normalized = ownerSymbol(symbol);
    const quantities = [...this.quantities.values()].filter(quantity => quantity.symbol && ownerSymbol(quantity.symbol) === normalized);
    return quantities.length === 1 && quantities[0]!.id === quantityId && ownerSymbol(entity.label) === normalized &&
      [...this.entities.values()].filter(candidate => typeof candidate.label === "string" && ownerSymbol(candidate.label) === normalized).length === 1;
  }
  unknownTextCompatible(target: string, unknown: { symbol: string; unit?: string }): boolean {
    const labels = this.document.constructions.filter(construction => nativeLabelTarget(construction) === target);
    const ownerIds = new Set([target, ...labels.flatMap(construction => construction.outputs)]);
    const texts: unknown[] = [
      ...[...ownerIds].map(id => this.entities.get(id)?.label),
      ...labels.map(construction => construction.inputs.text),
      ...this.input.baseRenderScene.primitives.filter(primitive => primitive.kind === "label" && ownerIds.has(primitive.entityId)).map(primitive => primitive.text),
    ];
    const expected = statement(unknown);
    return texts.every(text => text === undefined || (typeof text === "string" &&
      (!text.trim() || isPointIdentifierText(text) || text === unknown.symbol || text === expected)));
  }
  rightAngle(vertex: string, firstArm: string, secondArm: string, owners: string[]): void {
    if (!owners.every(owner => this.rendered(owner))) return;
    const group = this.ownerGroup(owners[0]!);
    if (group === null || owners.some(owner => this.ownerGroup(owner) !== group)) {
      this.skip("ambiguous_right_angle_scope", undefined, owners); return;
    }
    if (this.document.constructions.some(construction => ["right_angle_mark", "space_right_angle_mark"].includes(construction.operator) && construction.inputs.vertex === vertex)) {
      this.skip("right_angle_already_present", undefined, owners); return;
    }
    const id = stableId("right_angle", [vertex, ...owners]);
    if (this.entities.has(id) || this.additions.some(addition => addition.id === id)) return;
    if (this.additions.length >= MAX_ADDITIONS) { this.skip("addition_budget", undefined, owners); return; }
    const entity = { id, kind: "right_angle_mark", role: "native perpendicular incidence mark" };
    const construction = { id: `construct_${id}`, operator: "right_angle_mark", inputs: { vertex, a: firstArm, b: secondArm }, outputs: [id] };
    const assertions: SceneDocument["assertions"] = [
      { id: `assert_${id}_perpendicular`, predicate: "perpendicular", entities: owners, expected: true, severity: "fatal" },
      ...owners.map((owner, index) => ({ id: `assert_${id}_incident_${index}`, predicate: "on", entities: [vertex, owner], expected: true, severity: "fatal" as const })),
    ];
    // These are the unchanged native world proofs, including the mark's
    // normalised dot product. No rendered point is used as metric authority.
    const proof = { ...this.document, entities: [...this.document.entities, entity], constructions: [...this.document.constructions, construction],
      assertions: [...this.document.assertions, ...assertions], requiredEntityIds: [...this.document.requiredEntityIds, id],
      revealGroups: this.document.revealGroups.map((reveal, index) => index === group
        ? { ...reveal, entityIds: [...reveal.entityIds, id] } : reveal) };
    const compiledProof = compileSceneDocument(proof);
    if (!compiledProof.ok || !compiledProof.renderScene) { this.skip("right_angle_native_proof_failed", undefined, owners); return; }
    if (this.input.baseRenderScene.primitives.some(prior => prior.kind !== "label" && prior.provenance?.labelLeader !== true &&
        !compiledProof.renderScene!.primitives.some(next => next.id === prior.id && JSON.stringify(next) === JSON.stringify(prior)))) {
      this.skip("right_angle_changes_existing_geometry", undefined, owners); return;
    }
    const next = this.next ??= structuredClone(this.document);
    next.entities.push(entity); next.constructions.push(construction); next.assertions.push(...assertions);
    next.requiredEntityIds.push(id); next.revealGroups[group]!.entityIds.push(id);
    this.additions.push({ id, kind: "right_angle", quantityIds: [], targetIds: owners });
  }
}

function validFrame(context: CompletionContext, frame: unknown): frame is string {
  return typeof frame === "string" && context.producers.get(frame)?.operator === "space_frame" && context.rendered(frame);
}
function tupleLabels(context: CompletionContext): void {
  const source = context.document.source;
  // Source coordinates cannot be recovered from schematic/display placement.
  const metric = source.nonMetric !== true && source.representationTier !== "question_representation";
  for (const construction of context.document.constructions) {
    if (!["point", "space_point", "space_vector", "curve_anchor"].includes(construction.operator) || construction.outputs.length !== 1) continue;
    const target = construction.outputs[0]!;
    const entity = context.entities.get(target);
    if (!context.rendered(target)) continue;
    const inputs = construction.inputs;
    if (construction.operator === "curve_anchor") {
      if (!metric) continue;
      const given = context.given(inputs.at);
      const curve = typeof inputs.curve === "string" ? context.producers.get(inputs.curve) : undefined;
      if (!given || curve?.operator !== "function_curve" || !context.rendered(String(inputs.curve))) continue;
      context.own([given], target);
      context.label({ kind: "given_label", quantityIds: [given.id], targetIds: [target], text: statement(given) });
      continue;
    }
    if (!metric || !entity?.label || !isPointIdentifierText(entity.label)) continue;
    if (construction.operator === "space_vector") {
      if (!validFrame(context, inputs.frame)) continue;
      const start = typeof inputs.start === "string" ? context.producers.get(inputs.start) : undefined;
      const end = typeof inputs.end === "string" ? context.producers.get(inputs.end) : undefined;
      if (start?.operator !== "space_point" || end?.operator !== "space_point" || start.inputs.frame !== inputs.frame ||
          end.inputs.frame !== inputs.frame || !["x", "y", "z"].every(axis => context.number(start.inputs[axis]) === 0)) continue;
      const components = ["x", "y", "z"].map(axis => context.given(end.inputs[axis]));
      if (components.some(component => component === null)) { context.skip("vector_components_not_all_given", undefined, [target]); continue; }
      const givens = components.filter((component): component is Given => component !== null);
      context.own(givens, target);
      context.label({ kind: "given_label", quantityIds: [...new Set(givens.map(given => given.id))], targetIds: [target],
        text: `${entity.label} = (${givens.map(given => `${boardNumber(given.value)}${given.unit === undefined ? "" : ` ${boardUnit(given.unit)}`}`).join(", ")})` });
      continue;
    }
    const axes = construction.operator === "point" ? ["x", "y"] : ["x", "y", "z"];
    if (construction.operator === "point" ? inputs.coordinateSpace !== undefined && inputs.coordinateSpace !== "world" : !validFrame(context, inputs.frame)) continue;
    const components = axes.map(axis => context.given(inputs[axis]));
    const givens = components.filter((component): component is Given => component !== null);
    if (!givens.length) continue;
    context.own(givens, target);
    const tuple = `(${givens.map(given => `${boardNumber(given.value)}${given.unit === undefined ? "" : ` ${boardUnit(given.unit)}`}`).join(", ")})`;
    if (givens.length === axes.length && canonicalStatement(entity.label).endsWith(canonicalStatement(tuple))) {
      context.skip("already_labelled", givens[0]!.id, [target]); continue;
    }
    const text = givens.length === axes.length
      ? `${entity.label}${tuple}`
      : `${entity.label}: ${givens.map(statement).join(", ")}`;
    context.label({ kind: "given_label", quantityIds: [...new Set(givens.map(given => given.id))], targetIds: [target], text });
  }
}

function radians(value: number, unit: unknown): number | null {
  const normalized = angleUnit(unit);
  return normalized === "degree" ? value * Math.PI / 180 : normalized === "rad" ? value : null;
}
/** A two-line native angle proof is acute; an obtuse drawn arc cannot borrow it. */
function provenAngle(context: CompletionContext, target: string, given: Given): boolean {
  const mark = context.producers.get(target);
  if (mark?.operator !== "angle_mark") return false;
  const vertex = context.geometry.point(mark.inputs.vertex);
  const a = vertex ? context.geometry.arm(mark.inputs.a ?? mark.inputs.first, vertex) : null;
  const b = vertex ? context.geometry.arm(mark.inputs.b ?? mark.inputs.second, vertex) : null;
  const expected = radians(given.value, given.unit);
  if (!vertex || !a || !b || expected === null || !(expected > 0 && expected <= Math.PI / 2)) return false;
  const u = subtract(a, vertex), v = subtract(b, vertex);
  const actual = Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / norm(u) / norm(v))));
  if (Math.abs(actual - expected) > 1e-8) return false;
  const arms = [mark.inputs.a ?? mark.inputs.first, mark.inputs.b ?? mark.inputs.second];
  return arms.every(arm => typeof arm === "string" && context.rendered(arm)) && context.document.assertions.some(assertion => {
    if (assertion.severity !== "fatal" || assertion.predicate !== "angle_between" || !sameIds(assertion.entities, arms as string[]) || !isRecord(assertion.expected)) return false;
    return typeof assertion.expected.value === "number" &&
      Math.abs((radians(assertion.expected.value, assertion.expected.unit) ?? Infinity) - expected) <= 1e-8;
  });
}

function incidenceLabels(context: CompletionContext): void {
  for (const construction of context.document.constructions) {
    if (!["refract_at", "reflect_at"].includes(construction.operator) || construction.outputs.length !== 3) continue;
    const given = context.given(construction.inputs.incidentAngleDeg);
    if (!given || angleUnit(given.unit) !== "degree" || !(given.value > 0 && given.value < 90)) continue;
    const [incident, normal] = construction.outputs;
    const contact = construction.inputs.point ?? construction.inputs.contact;
    if (![incident, normal, contact].every(id => typeof id === "string" && context.rendered(id))) continue;
    const marks = context.document.constructions.filter(mark => {
      const a = mark.inputs.a ?? mark.inputs.first, b = mark.inputs.b ?? mark.inputs.second;
      return mark.operator === "angle_mark" && mark.outputs.length === 1 && mark.inputs.vertex === contact &&
        typeof a === "string" && typeof b === "string" && sameIds([a, b], [incident!, normal!]);
    });
    if (marks.length !== 1) { context.skip("incidence_mark_ambiguous", given.id); continue; }
    const target = marks[0]!.outputs[0]!;
    // The native ray bundle and angle_mark own the contact/normal orientation;
    // recompile a fatal same-arm proof rather than measuring projected pixels.
    const proof: SceneDocument = { ...context.document, assertions: [...context.document.assertions, {
      id: stableId("incidence_proof", [given.id, target]), predicate: "angle_between", entities: [incident!, normal!],
      expected: { value: given.value, unit: "degree" }, severity: "fatal",
    }] };
    if (!compileSceneDocument(proof).ok) { context.skip("incidence_geometry_not_proved", given.id, [target]); continue; }
    context.own([given], target);
    context.label({ kind: "given_angle", quantityIds: [given.id], targetIds: [target], text: statement(given) });
  }
}

function annotationLabels(context: CompletionContext): void {
  const byQuantity = new Map<string, SceneDocument["annotations"]>();
  for (const annotation of context.document.annotations) {
    if (!annotation.quantityId) continue;
    const annotations = byQuantity.get(annotation.quantityId) ?? [];
    annotations.push(annotation); byQuantity.set(annotation.quantityId, annotations);
  }
  for (const [quantityId, annotations] of byQuantity) {
    const targets = new Set(annotations.flatMap(annotation => annotation.targetIds));
    if (annotations.some(annotation => annotation.targetIds.length !== 1) || targets.size !== 1) {
      context.skip("ambiguous_quantity_attachment", quantityId, [...targets]); continue;
    }
    const target = [...targets][0]!;
    const typedOwners = context.typedOwners.get(quantityId);
    if (typedOwners && [...typedOwners].some(owner => owner !== target)) {
      context.skip("quantity_owner_conflict", quantityId, [...typedOwners, target]); continue;
    }
    const angle = ["angle_mark", "space_angle_mark", "right_angle_mark", "space_right_angle_mark"].includes(context.producers.get(target)?.operator ?? "");
    // Both a value and an unknown scalar need a proved region/side owner.
    // Finite segments may also render as lines; keep them eligible.
    if (!angle && ["line", "ray"].includes(context.entities.get(target)?.kind ?? "") &&
        context.input.baseRenderScene.primitives.some(primitive => primitive.entityId === target &&
          ["line", "ray"].includes(primitive.kind) && primitive.provenance?.labelLeader !== true)) {
      context.skip("annotation_scalar_carrier_has_no_region_owner", quantityId, [target]); continue;
    }
    const given = context.given(quantityId);
    if (given) {
      if (angleUnit(given.unit) !== null || angle) {
        if (!provenAngle(context, target, given)) { context.skip("angle_attachment_not_proved", quantityId, [target]); continue; }
      } else if (!typedOwners?.has(target) && !context.scalarOwner(target, given.symbol, given.id)) {
        context.skip("scalar_owner_or_absolute_value_not_proved", quantityId, [target]); continue;
      }
      context.label({ kind: angle ? "given_angle" : "given_label", quantityIds: [quantityId], targetIds: [target], text: statement(given) });
      continue;
    }
    const unknown = context.input.turnPlan.unknowns.find(candidate => candidate.id === quantityId);
    const quantity = context.quantities.get(quantityId);
    if (!unknown || !quantity || quantity.symbol !== unknown.symbol || quantity.unit !== unknown.unit || quantity.value !== undefined ||
        context.input.turnPlan.givens.some(candidate => candidate.id === quantityId || candidate.symbol === unknown.symbol) ||
        context.input.turnPlan.derived.some(candidate => candidate.id === quantityId || candidate.symbol === unknown.symbol) ||
        annotations.some(annotation => annotation.text !== undefined && compactText(annotation.text) !== compactText(statement(unknown)))) {
      context.skip("unavailable_given_or_unresolved_unknown", quantityId, [target]); continue;
    }
    if (!context.scalarOwner(target, unknown.symbol, unknown.id) || !context.unknownTextCompatible(target, unknown)) {
      context.skip("unknown_target_has_existing_statement", quantityId, [target]); continue;
    }
    context.label({ kind: "unknown_label", quantityIds: [quantityId], targetIds: [target], text: statement(unknown) });
  }
}

function rightAngleMarks(context: CompletionContext): void {
  for (const construction of context.document.constructions) {
    if (construction.operator !== "perpendicular_through" || construction.outputs.length !== 1) continue;
    const vertex = construction.inputs.through ?? construction.inputs.point;
    const reference = construction.inputs.line ?? construction.inputs.reference;
    const target = construction.outputs[0]!;
    if (typeof vertex !== "string" || typeof reference !== "string") continue;
    const point = context.geometry.point(vertex), first = context.geometry.line(reference), second = context.geometry.line(target);
    if (!point || !first || !second || !perpendicular(first, second)) continue;
    const arm = [[first.startId, first.a], [first.endId, first.b]] as const;
    const endpoint = arm.find(([id, at]) => id !== undefined && !samePoint(at, point))?.[0];
    if (!endpoint) { context.skip("right_angle_arm_reference_unavailable", undefined, [reference, target]); continue; }
    context.rightAngle(vertex, endpoint, target, [reference, target]);
  }
}

/**
 * Propose append-only marks for the actual admitted document and render.
 * The caller remains responsible for normal admission and save checks.
 */
export function completeSceneDocument(
  document: SceneDocument,
  input: SceneCompletionInput,
): SceneCompletionResult {
  const empty = (skipped: SceneCompletionSkip[] = []): SceneCompletionResult => ({ document, addedEntityIds: [], addedAnnotationIds: [], additions: [], skipped });
  if (input.enabled !== true) return empty();
  if (typeof document.source.question !== "string" || input.turnPlan.question !== document.source.question) return empty([{ code: "question_identity_mismatch" }]);
  if (!validateTurnPlanV3(input.turnPlan, document.source.question).valid) return empty([{ code: "invalid_turn_plan" }]);
  const ids = [document.entities.map(entity => entity.id), document.quantities.map(quantity => quantity.id),
    document.constructions.flatMap(construction => construction.outputs)];
  if (ids.some(list => new Set(list).size !== list.length)) return empty([{ code: "duplicate_structured_id" }]);
  const baseline = compileSceneDocument(document);
  if (!baseline.ok || !baseline.renderScene || !input.baseRenderScene ||
      JSON.stringify(baseline.renderScene) !== JSON.stringify(input.baseRenderScene)) return empty([{ code: "base_render_mismatch_or_invalid" }]);
  if (document.visualDecision.mode !== "scene") return empty([{ code: "baseline_has_no_scene" }]);
  const context = new CompletionContext(document, input);
  tupleLabels(context);
  incidenceLabels(context);
  annotationLabels(context);
  rightAngleMarks(context);
  for (const given of input.turnPlan.givens) {
    if (!context.additions.some(addition => addition.quantityIds.includes(given.id)) &&
        !context.skipped.some(skip => skip.quantityId === given.id)) context.skip("no_eligible_structured_attachment", given.id);
  }
  // No derived answers or force inventory is authorized by an untyped solver projection.
  if (input.turnPlan.derived.length || input.solverAuthority !== undefined) context.skip("derived_and_force_authority_unavailable");
  return context.result();
}
