import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const SET_OPERATORS = ["set_partition", "set_select"] as const;
export interface SetPartitionDefinition {
  names: string[]; inclusiveCounts: Array<number | null>; exclusiveCounts: Array<number | null>;
  universeCount: number | null; origin: RenderPoint; displayScale: number; rotationRadians: number;
  circles: Array<{ center: RenderPoint; radius: number }>; witnesses: RenderPoint[];
  nonmetric: true; representation: "membership_witness";
}
export interface SetAtomDefinition { mask: number; count: number; name: string; nonmetric: true; representation: "count_anchor" }
export interface SetSelectionDefinition { partitionId: string; masks: number[]; count: number; name: string; nonmetric: true; representation: "count_anchor" }
export interface SetEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
export type SetGeometry =
  | { kind: "circle"; center: RenderPoint; radius: number; setPartition: SetPartitionDefinition; setIndex: number }
  | { kind: "point"; point: RenderPoint; setPartition: SetPartitionDefinition; setAtom: SetAtomDefinition }
  | { kind: "point"; point: RenderPoint; setSelection: SetSelectionDefinition };
const MAX_VALUE = 1e12;
const MAX_COUNT = 1e9;
const MIN_DISPLAY = 1e-6;
const INPUT_KEYS: Readonly<Record<string, readonly string[]>> = { set_partition: ["sets", "intersections", "universeCount", "origin", "displayScale", "rotationRadians"], set_select: ["partition", "expression", "at"] };
class SetInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
class DeferredSetGeometry extends Error {}
function fail(key: string, message: string): never { throw new SetInputError(key, message); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fields(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void { if (Object.keys(value).some((name) => !allowed.includes(name))) fail(key, "set construction contains unsupported fields"); }
function finite(value: number, key: string): number { if (!Number.isFinite(value) || Math.abs(value) > MAX_VALUE) fail(key, `${key} must remain finite with magnitude no greater than ${MAX_VALUE}`); return value === 0 ? 0 : value; }
function preserveLiteral(value: unknown, key: string): void {
  if (typeof value !== "string") return;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:e[+-]?\d+)?$/i.exec(value.trim());
  if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) fail(key, "nonzero set values cannot underflow to certified zero");
}
function units(value: unknown, angle = false, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): void {
  if (depth > 32 || seen.has(value)) fail("units", "set quantity units are cyclic or exceed depth32");
  const source = typeof value === "string" ? document?.quantities.find((quantity) => quantity.id === value) : record(value) ? value : undefined;
  if (!source) return; seen.add(value);
  if (source.unit !== undefined && (typeof source.unit !== "string" || !["1", "unit", "units", "unitless", "dimensionless", "scalar", ...(angle ? ["rad", "radian", "radians"] : [])].includes(source.unit.trim().toLowerCase()))) fail("units", "set counts and display coordinates require dimensionless quantities; rotation uses radians");
  if ("value" in source) units(source.value, angle, document, seen, depth + 1);
}
function scalar(value: unknown, key: string, context: SetEvaluationContext, angle = false, depth = 0): number {
  if (depth > 32) fail(key, "set scalar wrappers exceed depth32");
  if (record(value)) { fields(value, ["value", "unit"], key); units(value, angle); return scalar(value.value, key, context, angle, depth + 1); }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) fail(key, "set values require finite literals or numeric quantity references");
  preserveLiteral(value, key);
  try { return finite(context.number(value), key); } catch (error) { if (error instanceof SetInputError) throw error; return fail(key, "set numeric value cannot be resolved"); }
}
function count(value: unknown, key: string, context: SetEvaluationContext): number {
  const result = scalar(value, key, context); if (!Number.isSafeInteger(result) || result < 0 || result > MAX_COUNT) fail(key, `set counts must be nonnegative integers no greater than ${MAX_COUNT}`); return result;
}
function origin(value: unknown, context: SetEvaluationContext): RenderPoint {
  if (value === undefined) return { x: 0, y: 0 };
  if (Array.isArray(value) && value.length === 2) return { x: scalar(value[0], "origin.x", context), y: scalar(value[1], "origin.y", context) };
  if (record(value) && "x" in value && "y" in value) { fields(value, ["x", "y"], "origin"); return { x: scalar(value.x, "origin.x", context), y: scalar(value.y, "origin.y", context) }; }
  if (typeof value !== "string" || !value.trim()) fail("origin", "set placement requires an inline or constructed ordinary planar point");
  const geometry = context.geometry(value);
  if (!record(geometry) || geometry.kind !== "point" || Object.keys(geometry).some((name) => !["kind", "point"].includes(name))) fail("origin", "set placement cannot reuse physical, world, or normalized count metadata");
  try { const point = context.point(value); return { x: finite(point.x, "origin"), y: finite(point.y, "origin") }; }
  catch (error) { if (error instanceof SetInputError || error instanceof DeferredSetGeometry) throw error; return fail("origin", "set origin must resolve to a finite ordinary planar point"); }
}
function namesInput(value: unknown, context: SetEvaluationContext): { names: string[]; counts: number[] } {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) fail("sets", "set_partition requires exactly two or three named finite sets");
  const names: string[] = []; const counts: number[] = [];
  value.forEach((entry) => {
    if (!record(entry)) fail("sets", "each finite set requires a name and inclusive count"); fields(entry, ["name", "count"], "sets");
    if (typeof entry.name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,3}$/.test(entry.name) || names.includes(entry.name)) fail("sets", "set names must be distinct identifiers with one to four characters");
    names.push(entry.name); counts.push(count(entry.count, "count", context));
  }); return { names, counts };
}
function atomName(mask: number, names: readonly string[]): string {
  const inside = names.filter((_, index) => mask & 1 << index); const outside = names.filter((_, index) => !(mask & 1 << index));
  const included = inside.join("∩"); const excluded = outside.length > 1 ? `(${outside.join("∪")})` : outside[0];
  return inside.length ? outside.length ? `${included}\\${excluded}` : included : `U\\(${names.join("∪")})`;
}
function membership(point: RenderPoint, circles: readonly { center: RenderPoint; radius: number }[]): number {
  let mask = 0;
  circles.forEach((circle, index) => { const distance = Math.hypot(point.x - circle.center.x, point.y - circle.center.y); if (!Number.isFinite(distance) || Math.abs(distance - circle.radius) <= circle.radius * 1e-8) fail("precision", "set region witness membership is numerically unresolved"); if (distance < circle.radius) mask |= 1 << index; }); return mask;
}
function partitionCounts(inputs: Record<string, unknown>, context: SetEvaluationContext): Pick<SetPartitionDefinition, "names" | "inclusiveCounts" | "exclusiveCounts" | "universeCount"> {
  const { names, counts } = namesInput(inputs.sets, context); const size = 1 << names.length;
  const inclusiveCounts: Array<number | null> = Array.from({ length: size }, () => null);
  const universeCount = inputs.universeCount === undefined ? null : count(inputs.universeCount, "universeCount", context); inclusiveCounts[0] = universeCount;
  counts.forEach((value, index) => { inclusiveCounts[1 << index] = value; });
  if (!Array.isArray(inputs.intersections) || inputs.intersections.length !== (names.length === 2 ? 1 : 4)) fail("intersections", "every inclusive intersection of two or more sets must be supplied exactly once");
  inputs.intersections.forEach((entry) => {
    if (!record(entry)) fail("intersections", "inclusive intersections require sets and count"); fields(entry, ["sets", "count"], "intersections");
    if (!Array.isArray(entry.sets) || entry.sets.length < 2 || entry.sets.length > names.length || new Set(entry.sets).size !== entry.sets.length) fail("intersections", "intersection set names must be distinct and explicit");
    let mask = 0; for (const name of entry.sets) { const index = names.indexOf(String(name)); if (typeof name !== "string" || index < 0) fail("intersections", "intersection references an unknown finite set"); mask |= 1 << index; }
    if (inclusiveCounts[mask] !== null) fail("intersections", "inclusive intersection counts cannot be duplicated"); inclusiveCounts[mask] = count(entry.count, "count", context);
  });
  const exclusiveCounts: Array<number | null> = Array.from({ length: size }, () => null);
  for (let mask = size - 1; mask >= 1; mask--) {
    if (inclusiveCounts[mask] === null) fail("intersections", "all inclusive intersection counts must be known");
    let exclusive = inclusiveCounts[mask]!; for (let superset = mask + 1; superset < size; superset++) if ((superset & mask) === mask) exclusive -= exclusiveCounts[superset]!;
    if (!Number.isSafeInteger(exclusive) || exclusive < 0) fail("counts", "inclusive set counts do not admit nonnegative exclusive regions"); exclusiveCounts[mask] = exclusive;
  }
  const union = exclusiveCounts.slice(1).reduce<number>((total, value) => total + value!, 0);
  if (universeCount !== null) { if (union > universeCount) fail("universeCount", "explicit universe cannot contain fewer elements than the set union"); exclusiveCounts[0] = universeCount - union; }
  return { names, inclusiveCounts, exclusiveCounts, universeCount };
}
function partition(inputs: Record<string, unknown>, context: SetEvaluationContext): SetGeometry[] {
  const { names, inclusiveCounts, exclusiveCounts, universeCount } = partitionCounts(inputs, context); const size = 1 << names.length;
  const at = origin(inputs.origin, context); const displayScale = scalar(inputs.displayScale, "displayScale", context); if (!(displayScale > MIN_DISPLAY) || displayScale > 1e9) fail("displayScale", "nonmetric set displayScale must be explicit, positive, visible, and no greater than1e9");
  const rotationRadians = inputs.rotationRadians === undefined ? 0 : scalar(inputs.rotationRadians, "rotationRadians", context, true);
  const sine = Math.sin(rotationRadians); const cosine = Math.cos(rotationRadians);
  const place = (point: RenderPoint): RenderPoint => {
    const dx = displayScale * (cosine * point.x - sine * point.y); const dy = displayScale * (sine * point.x + cosine * point.y);
    const result = { x: finite(at.x + dx, "display"), y: finite(at.y + dy, "display") };
    if (Math.hypot(result.x - at.x - dx, result.y - at.y - dy) > displayScale * 1e-8) fail("precision", "set placement cannot retain its normalized region arrangement"); return result;
  };
  const centers = names.length === 2 ? [{ x: -0.5, y: 0 }, { x: 0.5, y: 0 }] : [{ x: 0, y: 1 / Math.sqrt(3) }, { x: -0.5, y: -1 / (2 * Math.sqrt(3)) }, { x: 0.5, y: -1 / (2 * Math.sqrt(3)) }];
  const circles = centers.map((center) => ({ center: place(center), radius: displayScale }));
  const witnesses = Array.from({ length: size }, (_, mask) => {
    if (!mask) return place({ x: 0, y: 3 });
    if (mask === size - 1) return place({ x: 0, y: 0 });
    const selected = centers.filter((_, index) => mask & 1 << index);
    return place(selected.length === 1 ? { x: selected[0]!.x * 2, y: selected[0]!.y * 2 } : selected.reduce((point, center) => ({ x: point.x + center.x, y: point.y + center.y }), { x: 0, y: 0 }));
  });
  witnesses.forEach((point, mask) => { if (membership(point, circles) !== mask) fail("precision", "normalized set arrangement does not certify every Boolean region witness"); });
  const definition: SetPartitionDefinition = { names, inclusiveCounts, exclusiveCounts, universeCount, origin: at, displayScale, rotationRadians, circles, witnesses, nonmetric: true, representation: "membership_witness" };
  const result: SetGeometry[] = circles.map((circle, setIndex) => ({ kind: "circle", ...circle, setPartition: definition, setIndex }));
  for (const mask of [...Array.from({ length: size - 1 }, (_, index) => index + 1), ...(universeCount !== null ? [0] : [])]) result.push({ kind: "point", point: witnesses[mask]!, setPartition: definition, setAtom: { mask, count: exclusiveCounts[mask]!, name: atomName(mask, names), nonmetric: true, representation: "count_anchor" } });
  return result;
}
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((value, index) => same(a[index], value));
  if (record(b)) return record(a) && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([key, value]) => same(a[key], value));
  return a === b;
}
function partitionSource(value: unknown, context: SetEvaluationContext): SetPartitionDefinition {
  if (typeof value !== "string" || !value.trim()) fail("partition", "set_select requires one computed partition output reference");
  const geometry = context.geometry(value);
  if (!record(geometry) || !record(geometry.setPartition)) fail("partition", "selection source must retain finite-set partition authority");
  const raw = geometry.setPartition;
  fields(raw, ["names", "inclusiveCounts", "exclusiveCounts", "universeCount", "origin", "displayScale", "rotationRadians", "circles", "witnesses", "nonmetric", "representation"], "partition");
  if (!Array.isArray(raw.names) || raw.names.length < 2 || raw.names.length > 3 || !Array.isArray(raw.inclusiveCounts) || raw.inclusiveCounts.length !== 1 << raw.names.length || !Array.isArray(raw.exclusiveCounts) || raw.exclusiveCounts.length !== raw.inclusiveCounts.length || !Array.isArray(raw.circles) || raw.circles.length !== raw.names.length || !Array.isArray(raw.witnesses) || raw.witnesses.length !== raw.inclusiveCounts.length || raw.nonmetric !== true || raw.representation !== "membership_witness") fail("partition", "partition source metadata must retain bounded counts and nonmetric topology");
  const names = raw.names; const inclusive = raw.inclusiveCounts;
  const inputs: Record<string, unknown> = { sets: names.map((name, index) => ({ name, count: inclusive[1 << index] })), intersections: [], origin: raw.origin, displayScale: raw.displayScale, rotationRadians: raw.rotationRadians };
  const intersections: Array<{ sets: unknown[]; count: unknown }> = [];
  for (let mask = 1; mask < inclusive.length; mask++) if ((mask & mask - 1) !== 0) intersections.push({ sets: names.filter((_, index) => mask & 1 << index), count: inclusive[mask] }); inputs.intersections = intersections;
  if (raw.universeCount !== null) inputs.universeCount = raw.universeCount;
  const outputs = partition(inputs, context);
  const atomMask = record(geometry.setAtom) && typeof geometry.setAtom.mask === "number" ? geometry.setAtom.mask : null;
  const candidate = geometry.kind === "circle" && typeof geometry.setIndex === "number" ? outputs[geometry.setIndex] : geometry.kind === "point" && atomMask !== null ? outputs.find((output) => "setAtom" in output && output.setAtom.mask === atomMask) : undefined;
  if (!candidate || !("setPartition" in candidate) || !same(geometry, candidate)) fail("partition", "partition geometry or counts contradict the verified source model");
  return candidate.setPartition;
}
function expression(value: unknown, partition: Pick<SetPartitionDefinition, "names" | "universeCount">): { masks: number[]; name: string } {
  const ancestors = new Set<unknown>(); let nodes = 0; const size = 1 << partition.names.length; const all = (1 << size) - 1;
  const read = (value: unknown, depth: number): { bits: number; name: string } => {
    if (depth > 16 || ++nodes > 128 || ancestors.has(value)) fail("expression", "set Boolean expression is cyclic or exceeds depth16/node128 caps");
    if (!record(value) || Object.keys(value).length !== 1) fail("expression", "set expression requires one structured set algebra operation");
    ancestors.add(value);
    try {
      if ("set" in value) {
        const index = typeof value.set === "string" ? partition.names.indexOf(value.set) : -1; if (index < 0) fail("expression", "set expression references an unknown source set");
        let bits = 0; for (let mask = 0; mask < size; mask++) if (mask & 1 << index) bits |= 1 << mask; return { bits, name: partition.names[index]! };
      }
      if ("complement" in value) {
        if (partition.universeCount === null) fail("expression", "complement requires an explicit known source universe, including the outside count");
        const child = read(value.complement, depth + 1); return { bits: all ^ child.bits, name: `(U\\${child.name})` };
      }
      const operation = Object.keys(value)[0]!;
      if (!["union", "intersection", "difference"].includes(operation)) fail("expression", "set expression supports set, union, intersection, difference, and complement only");
      const children = value[operation];
      if (!Array.isArray(children) || children.length < 2 || children.length > 8 || operation === "difference" && children.length !== 2) fail("expression", "Boolean operations require two to eight operands; difference requires exactly two");
      const terms = children.map((child) => read(child, depth + 1));
      const bits = operation === "union" ? terms.reduce((value, child) => value | child.bits, 0) : operation === "intersection" ? terms.reduce((value, child) => value & child.bits, all) : terms[0]!.bits & (all ^ terms[1]!.bits);
      const symbol = operation === "union" ? "∪" : operation === "intersection" ? "∩" : "\\";
      return { bits, name: `(${terms.map((term) => term.name).join(symbol)})` };
    } finally { ancestors.delete(value); }
  };
  const result = read(value, 0); const name = result.name.startsWith("(") && result.name.endsWith(")") ? result.name.slice(1, -1) : result.name;
  return { masks: Array.from({ length: size }, (_, mask) => mask).filter((mask) => result.bits & 1 << mask), name };
}
export function evaluateSetConstruction(operator: string, inputs: Record<string, unknown>, context: SetEvaluationContext): SetGeometry[] {
  const allowed = INPUT_KEYS[operator]; if (!allowed) fail("operator", `unsupported set operator ${operator}`); fields(inputs, allowed);
  if (operator === "set_partition") return partition(inputs, context);
  const definition = partitionSource(inputs.partition, context); const selected = expression(inputs.expression, definition);
  const count = selected.masks.reduce((sum, mask) => { const value = definition.exclusiveCounts[mask]; if (value === null) fail("expression", "selected outside count is unknown without a source universe"); return sum + value!; }, 0);
  const point = inputs.at === undefined ? { x: finite(definition.origin.x + 3 * definition.displayScale * Math.sin(definition.rotationRadians), "at"), y: finite(definition.origin.y - 3 * definition.displayScale * Math.cos(definition.rotationRadians), "at") } : origin(inputs.at, context);
  return [{ kind: "point", point, setSelection: { partitionId: inputs.partition as string, masks: selected.masks, count, name: selected.name, nonmetric: true, representation: "count_anchor" } }];
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) fail("scalar", "set numeric sources are cyclic or exceed depth32");
  if (typeof value === "number") return finite(value, "scalar");
  if (record(value)) { fields(value, ["value", "unit"], "scalar"); seen.add(value); return validationNumber(value.value, document, seen, depth + 1); }
  if (typeof value !== "string" || !value.trim()) fail("scalar", "set scalar requires a finite numeric source");
  const quantities = document.quantities.filter((quantity) => quantity.id === value); if (quantities.length > 1) fail("scalar", "set numeric source reference is ambiguous");
  if (quantities.length === 1) { seen.add(value); return validationNumber(quantities[0]!.value, document, seen, depth + 1); }
  preserveLiteral(value, "scalar"); return finite(Number(value), "scalar");
}
function sourceProducer(value: unknown, document: SceneDocument, byOutput: Map<string, SceneConstruction>, allowedKinds: readonly string[], key: string): SceneConstruction {
  if (typeof value !== "string" || !value.trim()) fail(key, "set references require one constructed entity id");
  const entities = document.entities.filter((entity) => entity.id === value); const producers = document.constructions.filter((construction) => construction.outputs.includes(value)); const producer = byOutput.get(value);
  if (entities.length !== 1 || !allowedKinds.includes(entities[0]!.kind) || producers.length !== 1 || !producer || producer !== producers[0]) fail(key, "set reference must name an unambiguous constructed entity of the required kind"); return producer;
}
function placementSchema(value: unknown, document: SceneDocument, byOutput: Map<string, SceneConstruction>, context: SetEvaluationContext): void {
  if (value === undefined) return;
  if (typeof value === "string") { sourceProducer(value, document, byOutput, ["point"], "origin"); return; }
  const coordinates = Array.isArray(value) && value.length === 2 ? value : record(value) && "x" in value && "y" in value ? [value.x, value.y] : null;
  if (!coordinates) fail("origin", "set placement requires two planar display coordinates or a point reference");
  coordinates.forEach((coordinate) => units(coordinate, false, document)); origin(value, context);
}
function constructionSchema(construction: SceneConstruction, document: SceneDocument, byOutput: Map<string, SceneConstruction>, context: SetEvaluationContext): void {
  if (!record(construction.inputs)) fail("inputs", "set inputs must be an object"); const { inputs, operator } = construction;
  const allowed = INPUT_KEYS[operator]; if (!allowed) fail("operator", "requires a computed set operator"); fields(inputs, allowed);
  let circleCount = 0; let arity = 1;
  if (operator === "set_partition") {
    for (const entry of [...(Array.isArray(inputs.sets) ? inputs.sets : []), ...(Array.isArray(inputs.intersections) ? inputs.intersections : [])]) if (record(entry)) units(entry.count, false, document);
    for (const key of ["universeCount", "displayScale"]) if (inputs[key] !== undefined) units(inputs[key], false, document); if (inputs.rotationRadians !== undefined) units(inputs.rotationRadians, true, document);
    const counts = partitionCounts(inputs, context); circleCount = counts.names.length; arity = circleCount + (1 << circleCount) - 1 + (counts.universeCount !== null ? 1 : 0);
    const scale = scalar(inputs.displayScale, "displayScale", context); if (!(scale > MIN_DISPLAY) || scale > 1e9) fail("displayScale", "set displayScale must be visible, positive, and no greater than1e9");
    if (inputs.rotationRadians !== undefined) scalar(inputs.rotationRadians, "rotationRadians", context, true); placementSchema(inputs.origin, document, byOutput, context);
  } else {
    const source = sourceProducer(inputs.partition, document, byOutput, ["circle", "label"], "partition"); if (source.operator !== "set_partition") fail("partition", "set_select requires a computed partition circle or count anchor");
    const counts = partitionCounts(source.inputs, context);
    expression(inputs.expression, counts);
    placementSchema(inputs.at, document, byOutput, context);
  }
  if (!Array.isArray(construction.outputs) || construction.outputs.length !== arity || construction.outputs.some((id) => typeof id !== "string" || !id.trim()) || new Set(construction.outputs).size !== arity) fail("outputs", `${operator} requires exactly ${arity} distinct output ids`);
  construction.outputs.forEach((id, outputIndex) => sourceProducer(id, document, byOutput, [outputIndex < circleCount ? "circle" : "label"], "outputs"));
}
/** Unknown derived origins retain their references until the atomic compiler evaluates them. */
export function validateSetConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  if (!(SET_OPERATORS as readonly string[]).includes(construction.operator)) return;
  const resolving = new Set<string>(); const cache = new Map<string, unknown>(); let resolvedCount = 0;
  const context: SetEvaluationContext = {
    number: (value) => validationNumber(value, document),
    point(value) { const geometry = context.geometry(value); if (!record(geometry) || geometry.kind !== "point" || !record(geometry.point) || typeof geometry.point.x !== "number" || typeof geometry.point.y !== "number") fail("origin", "set origin must be a planar point"); return { x: geometry.point.x, y: geometry.point.y }; },
    geometry(value) {
      const producer = sourceProducer(value, document, constructionByOutput, ["point", "circle", "label"], "reference"); const id = value as string;
      if (cache.has(id)) return cache.get(id); if (resolving.has(id) || resolving.size >= 32 || ++resolvedCount > 4096) fail("reference", "set dependency is cyclic or exceeds bounded capacity"); resolving.add(id);
      try {
        if (producer.operator === "point") {
          units(producer.inputs.x, false, document); units(producer.inputs.y, false, document);
          const geometry = { kind: "point", point: { x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) } }; cache.set(id, geometry); return geometry;
        }
        if (!(SET_OPERATORS as readonly string[]).includes(producer.operator)) throw new DeferredSetGeometry();
        constructionSchema(producer, document, constructionByOutput, context); const outputs = evaluateSetConstruction(producer.operator, producer.inputs, context);
        producer.outputs.forEach((outputId, outputIndex) => cache.set(outputId, outputs[outputIndex])); return cache.get(id);
      } finally { resolving.delete(id); }
    },
  };
  try { constructionSchema(construction, document, constructionByOutput, context); const outputs = evaluateSetConstruction(construction.operator, construction.inputs, context); validateEvaluatedSetLabels(construction, index, document, outputs, issues); }
  catch (error) {
    if (error instanceof DeferredSetGeometry) return; const key = error instanceof SetInputError ? error.key : "inputs";
    issues.push({ code: `invalid_${construction.operator}_${key}`, severity: "fatal", message: error instanceof Error ? error.message : "invalid finite-set construction", path: `constructions[${index}].${key === "outputs" ? key : `inputs.${key}`}`, entityIds: construction.outputs });
  }
}
function labelValue(geometry: unknown): { count: number; symbols: string[]; defaultLabel: string } | null {
  if (!record(geometry)) return null;
  if (record(geometry.setSelection) && geometry.setSelection.nonmetric === true && geometry.setSelection.representation === "count_anchor" && typeof geometry.setSelection.count === "number" && Number.isSafeInteger(geometry.setSelection.count) && geometry.setSelection.count >= 0 && typeof geometry.setSelection.name === "string") return { count: geometry.setSelection.count, symbols: ["n", "count", "n(expr)", `n(${geometry.setSelection.name})`, `|${geometry.setSelection.name}|`, geometry.setSelection.name], defaultLabel: "n(expr)" };
  if (!record(geometry.setPartition) || !Array.isArray(geometry.setPartition.names) || !Array.isArray(geometry.setPartition.inclusiveCounts)) return null;
  if (geometry.kind === "circle" && typeof geometry.setIndex === "number" && Number.isInteger(geometry.setIndex)) {
    const name = geometry.setPartition.names[geometry.setIndex]; const count = geometry.setPartition.inclusiveCounts[1 << geometry.setIndex];
    if (typeof name !== "string" || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
    return { count, symbols: ["n", "count", name, `n(${name})`, `|${name}|`, `n${name}`], defaultLabel: name };
  }
  if (geometry.kind === "point" && record(geometry.setAtom) && geometry.setAtom.nonmetric === true && geometry.setAtom.representation === "count_anchor" && typeof geometry.setAtom.count === "number" && Number.isSafeInteger(geometry.setAtom.count) && geometry.setAtom.count >= 0 && typeof geometry.setAtom.name === "string" && typeof geometry.setAtom.mask === "number") {
    const { name, mask, count } = geometry.setAtom;
    return { count, symbols: ["n", "count", name, `n(${name})`, `|${name}|`, `R${mask}`, `n(R${mask})`], defaultLabel: name.length <= 16 ? name : `R${mask}` };
  }
  return null;
}
export function setGeometryLabel(geometry: unknown, requestedText?: string): string | null {
  const value = labelValue(geometry); if (!value) return null;
  return typeof requestedText === "string" && requestedText.trim() && requestedText.length <= 16 ? requestedText : value.defaultLabel;
}
function checkText(text: unknown, value: { count: number; symbols: string[] }): void {
  if (text === undefined) return;
  if (typeof text !== "string" || !text.trim()) fail("label", "set labels require nonempty symbolic text or an exact count claim");
  const normalized = text.trim().replaceAll("−", "-");
  if (/^(?:[+-]?infinity|nan)$/i.test(normalized)) fail("label", "set labels cannot claim nonfinite counts");
  if (value.symbols.includes(normalized) || !/\d/.test(normalized) && !/[=≈]/.test(normalized) || /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) return;
  const equation = normalized.match(/^(.+?)\s*[=≈]\s*(.+)$/); const symbol = equation?.[1]?.trim(); const body = equation?.[2]?.trim() ?? normalized;
  if (symbol !== undefined && !value.symbols.includes(symbol)) fail("label", "numeric set labels must name their own inclusive, exclusive, or selected cardinality");
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(.*)$/i.exec(body);
  if (!match) fail("label", "set numeric labels require one exact nonnegative integer count"); preserveLiteral(match[1], "label");
  if (match[2] && !["1", "unit", "units", "unitless", "dimensionless", "scalar"].includes(match[2]!.toLowerCase())) fail("label", "set cardinality labels cannot claim metric measurements, areas, or probabilities");
  const count = Number(match[1]); if (!Number.isSafeInteger(count) || count < 0 || count !== value.count) fail("label", "set numeric label contradicts its evaluated finite cardinality");
}
/** All text/quantity-bearing overlays remain count claims, never area measurements. */
export function validateEvaluatedSetLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  if (!(SET_OPERATORS as readonly string[]).includes(construction.operator)) return;
  construction.outputs.forEach((id, outputIndex) => {
    const value = labelValue(outputs[outputIndex]);
    try {
      if (!value) fail("label", "set output has no computed cardinality authority"); checkText(document.entities.find((entity) => entity.id === id)?.label, value);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(id)) continue; checkText(annotation.text, value);
        if (annotation.quantityId !== undefined) {
          const quantities = document.quantities.filter((quantity) => quantity.id === annotation.quantityId); if (quantities.length !== 1 || typeof quantities[0]!.symbol !== "string" || !value.symbols.includes(quantities[0]!.symbol as string)) fail("label", "set quantity annotations must explicitly name their own finite cardinality");
          units(annotation.quantityId, false, document); const count = validationNumber(annotation.quantityId, document); if (!Number.isSafeInteger(count) || count < 0 || count !== value.count) fail("label", "set quantity annotation contradicts the evaluated cardinality");
        }
      }
      for (const label of document.constructions) if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === id) checkText(label.inputs.text, value);
    } catch (error) { issues.push({ code: "invalid_set_label", severity: "fatal", message: error instanceof Error ? error.message : "invalid set cardinality label", path: `constructions[${index}].outputs[${outputIndex}]`, entityIds: [id] }); }
  });
}
