import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import {
  MECHANICS_OPERATORS, evaluateMechanicsConstruction, validateMechanicsInputUnits,
  mechanicsBoundaryProjection, mechanicsSourceGeometry,
  withMechanicsPositionAuthority, validateEvaluatedMechanicsLabels, mechanicsPhysicalClaims,
  type MechanicsBoundarySelector, type MechanicsEvaluationContext, type MechanicsGeometry,
} from "../compile/mechanicsGeometry";
import { parseMathExpression } from "../math/expression";
import { validateProblemIR } from "../ir/problemIR";
import { mechanicsSourceOwnerForPath, replayMechanicsProgram, type MechanicsProgramStepSnapshot } from "../ir/mechanicsProgram";
import { evaluateAffineConstruction } from "../compile/affineGeometry";
import { add2, scale2 } from "../compile/sourceScalars";
import { validateMechanicsPlotSourceBinding, type MechanicsPlotModel } from "./mechanicsPlotAuthority";
import { independentlyReplayedSourceDocument } from "./independentSourceScene";
import { sourcePointBodyGivenIssues, sourcePointBodySceneScopeIssues } from "../ir/sourcePhysicalPointDeclarations";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import { unwrapMathMarkup } from "@heytutor/drawing";
import { implicitSolverEntityIds } from "../document/validation";
import { validateRequestedPointSourceAuthority } from "./requestedPointSourceAuthority";
import { deriveMechanicsPositionAuthority, mechanicsPositionCaptionIssue } from "./mechanicsPositionAuthority";

export interface MechanicsSceneBinding {
  outputId: string;
  requestId: string;
  stepId: string;
  ownerId: string;
  axisId?: string;
  sourceOwners?: Record<string, string>;
}
export interface MechanicsBoundaryBinding {
  outputId: string;
  modelOutputId: string;
  requestId: string;
  stepId: string;
  ownerId: string;
  axisId?: string;
  componentOwnerId?: string;
  projection: "point" | "circle" | "rod" | "axis";
}
type TrustedStep = { requestId: string; snapshot: MechanicsProgramStepSnapshot; program: ReadonlyMap<string, MechanicsProgramStepSnapshot> };
const EPS = 128 * Number.EPSILON;
const VIEW_FIELDS = new Set(["origin", "displayScale", "displayLength"]);
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(message: string): never { throw new Error(message); }
function isMechanics(operator: string): boolean { return (MECHANICS_OPERATORS as readonly string[]).includes(operator); }
function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b || a !== 0 && b !== 0 && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= EPS * Math.max(Math.abs(a), Math.abs(b));
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => same(value, b[i]));
  if (record(a) || record(b)) return record(a) && record(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
  return a === b;
}
function data(value: unknown, path = "", depth = 0): unknown {
  if (depth > 32) fail("mechanics physical snapshot exceeds structural bounds");
  if (Array.isArray(value)) return value.map((child, i) => data(child, `${path}.${i}`, depth + 1));
  if (!record(value)) {
    if (typeof value === "string" && path.endsWith(".expression")) return { syntaxKey: parseMathExpression(value).syntaxKey };
    return value;
  }
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, data(child, `${path}.${key}`, depth + 1)]));
}
function intrinsic(geometry: MechanicsGeometry): unknown {
  const value = geometry.mechanicsValue;
  const model = geometry.kind === "point" ? geometry.mechanicsModel : undefined;
  return data({
    ...(model ? { model: { kind: model.kind, source: model.source, state: model.state, units: model.units,
      scalarReferences: ("scalarReferences" in model && Array.isArray(model.scalarReferences) ? model.scalarReferences : []).map(reference => Object.fromEntries(Object.entries(reference).filter(([key]) => key !== "reference"))),
      sourcePositionAuthority: model.sourcePositionAuthority,
    } } : {}),
    ...(value ? { value: { kind: value.kind, scalarSI: value.scalarSI, componentsSI: value.componentsSI, symbol: value.symbol, unit: value.unit, zero: value.zero, claims: value.claims, sourcePositionAuthority: value.sourcePositionAuthority, physicalPointSI: value.physicalPointSI } } : {}),
  });
}
function meaning(step: TrustedStep): string {
  return JSON.stringify(data({ ownerId: step.snapshot.step.ownerId, axisId: step.snapshot.step.axisId, sourceOwners: step.snapshot.step.sourceOwners ?? {}, operator: step.snapshot.step.operator, physical: intrinsic(step.snapshot.geometry) }));
}

/** Carries original source evidence for save/replay; this does not certify it. */
export function withMechanicsSceneSource(document: SceneDocument, problemIR: unknown): SceneDocument {
  return { ...document, source: { ...document.source, mechanicsProblemIR: structuredClone(problemIR) } };
}

/**
 * Numeric mechanics must match complete independently replayed source models.
 * Selector records choose source steps; stamps and provider flags confer no authority.
 */
export function validateMechanicsSceneSourceBinding(document: SceneDocument, explicitProblemIR: unknown, question: string, acceptedPlan?: TurnPlanV3 | null): SceneIssue[] {
  const constructions = document.constructions.filter(construction => isMechanics(construction.operator));
  const issue = (code: string, message: string, construction?: SceneConstruction): SceneIssue => ({ code, message, severity: "fatal", failureKind: "truth", path: construction ? `constructions[${document.constructions.indexOf(construction)}]` : "source.mechanicsBindings", entityIds: construction?.outputs });
  const raw = explicitProblemIR ?? document.source.mechanicsProblemIR;
  const givenIssues = [...sourcePointBodyGivenIssues(question, acceptedPlan?.givens ?? []), ...sourcePointBodyGivenIssues(question, document.quantities, "scene_quantities")];
  if (givenIssues.length) return givenIssues.map(message => issue("mechanics_source_given_mismatch", message));
  if (!constructions.length) {
    const pointAuthority = validateRequestedPointSourceAuthority(document, question, acceptedPlan);
    const independentlyProved = (pointAuthority.issues.length > 0 || pointAuthority.completeSourceProof || document.source.mechanicsProblemIR !== undefined ||
      record(raw) && Array.isArray(raw.solveRequests) && raw.solveRequests.some(request => record(request) && request.kind === "mechanics")) &&
      independentlyReplayedSourceDocument(document, question, acceptedPlan);
    if (pointAuthority.issues.length && !independentlyProved) return pointAuthority.issues;
    const mechanicalRequest = record(raw) && Array.isArray(raw.solveRequests) && raw.solveRequests.some(request => record(request) && request.kind === "mechanics");
    if ((mechanicalRequest || document.source.mechanicsProblemIR !== undefined) && document.constructions.some(construction => construction.operator !== "label") && document.visualDecision?.mode !== "text_only" && !pointAuthority.completeSourceProof && !independentlyProved) return [issue("mechanics_source_model_missing", "raw mechanical geometry must retain its recomputed physical models or independently proved equivalent authority")];
    return [];
  }
  if (typeof question !== "string" || !question.trim()) return [issue("mechanics_source_question_missing", "numeric mechanics require the original accepted question")];
  const validated = validateProblemIR(raw, question);
  const problem = validated.problem;
  if (!problem || problem.question !== question) return [issue("mechanics_source_program_missing", "numeric mechanics require a revalidated program for the exact original question")];
  const scopeHelpers = implicitSolverEntityIds({ ...document, relations: document.relations ?? [], assertions: document.assertions ?? [],
    requiredEntityIds: document.requiredEntityIds ?? [], annotations: document.annotations ?? [], revealGroups: document.revealGroups ?? [] });
  const sourceScopeIssues = sourcePointBodySceneScopeIssues(document, question, problem, new Set(document.entities.filter(entity => !scopeHelpers.has(entity.id)).map(entity => entity.id)));
  if (sourceScopeIssues.length) return sourceScopeIssues.map(message => issue("mechanics_source_display_scope_mismatch", message));
  const source = new Map<string, TrustedStep>();
  try {
    for (const request of problem.solveRequests) if (request.kind === "mechanics") {
      const program = replayMechanicsProgram(problem, request.program, request.resultBinding);
      for (const [stepId, snapshot] of program) source.set(`${request.id}/${stepId}`, { requestId: request.id, snapshot, program });
    }
  } catch (error) { return [issue("mechanics_source_program_invalid", error instanceof Error ? error.message : "mechanics source replay failed")]; }
  if (!source.size) return [issue("mechanics_source_program_missing", "numeric mechanics require a supported source program")];
  const rawBindings = document.source.mechanicsBindings;
  if (!Array.isArray(rawBindings) || rawBindings.length > 256) return [issue("mechanics_source_binding_missing", "every numeric mechanics output needs a source selector")];
  const byOutput = new Map<string, SceneConstruction>();
  for (const construction of constructions) {
    if (construction.outputs.length !== 1 || byOutput.has(construction.outputs[0]!)) return [issue("mechanics_source_output_invalid", "mechanics outputs must be unique single-output physical authorities", construction)];
    byOutput.set(construction.outputs[0]!, construction);
  }
  const bindings = new Map<string, TrustedStep>();
  for (const rawBinding of rawBindings) {
    if (!record(rawBinding) || Object.keys(rawBinding).some(key => !["outputId", "requestId", "stepId", "ownerId", "axisId", "sourceOwners"].includes(key)) || typeof rawBinding.outputId !== "string" || typeof rawBinding.requestId !== "string" || typeof rawBinding.stepId !== "string") return [issue("mechanics_source_binding_invalid", "mechanics bindings are source selectors, not proof stamps")];
    const selected = source.get(`${rawBinding.requestId}/${rawBinding.stepId}`);
    if (!selected || !byOutput.has(rawBinding.outputId) || bindings.has(rawBinding.outputId) || rawBinding.ownerId !== selected.snapshot.step.ownerId || rawBinding.axisId !== undefined && rawBinding.axisId !== selected.snapshot.step.axisId || !same(rawBinding.sourceOwners ?? {}, selected.snapshot.step.sourceOwners ?? {})) return [issue("mechanics_source_binding_invalid", "source selector must preserve its exact owner, axis and physical input scopes")];
    bindings.set(rawBinding.outputId, selected);
  }
  if ([...byOutput.keys()].some(id => !bindings.has(id))) return [issue("mechanics_source_binding_missing", "every numeric mechanics model and observable needs a source selector")];
  const quantities = new Map(document.quantities.map(quantity => [quantity.id, quantity]));
  const cache = new Map<string, MechanicsGeometry>(), active = new Set<string>(); let reads = 0;
  function number(value: unknown, depth = 0, seen = new Set<string>()): number {
    if (++reads > 16384 || depth > 32) fail("mechanics scene numeric references exceed structural bounds");
    if (typeof value === "number") { if (!Number.isFinite(value) || Math.abs(value) > 1e12) fail("mechanics scene number is out of bounds"); return value; }
    if (record(value)) { if (Object.keys(value).some(key => !["value", "unit"].includes(key))) fail("mechanics scene quantity wrapper has unsupported fields"); return number(value.value, depth + 1, seen); }
    if (typeof value !== "string" || !value.trim()) fail("mechanics scene number must be explicit or quantity-bound");
    const quantity = quantities.get(value);
    if (quantity) { if (seen.has(value)) fail("cyclic mechanics scene quantity"); seen.add(value); try { return number(quantity.value, depth + 1, seen); } finally { seen.delete(value); } }
    if (/\b[xy]\b/.test(value)) fail("a free variable cannot supply a physical scene scalar");
    return parseMathExpression(value).evaluate(0);
  }
  const context: MechanicsEvaluationContext = { number, point() { return fail("screen geometry is not source physical coordinates"); }, geometry(value) { if (typeof value !== "string") fail("physical scene dependency must be a named mechanics output"); return byOutput.has(value) ? evaluate(value) : undefined; } };
  function evaluate(id: string): MechanicsGeometry {
    const cached = cache.get(id); if (cached) return cached;
    const construction = byOutput.get(id); if (!construction || active.has(id) || active.size > 32) fail("mechanics scene references must be typed, source-bound and acyclic");
    active.add(id);
    try {
      validateMechanicsInputUnits(construction.operator, construction.inputs, context, document);
      const selected = bindings.get(id)!;
      const replayInputs = { ...construction.inputs }; delete replayInputs.sourcePositionAuthority;
      const outputs = evaluateMechanicsConstruction(construction.operator, replayInputs, context);
      if (outputs.length !== 1) fail("mechanics scene constructor must emit one physical authority");
      const request = problem!.solveRequests.find(request => request.id === selected.requestId);
      if (!request || request.kind !== "mechanics") fail("position source proof needs its revalidated original native request");
      const sourceInputs = new Map(request.program.inputs.map(input => [input.id, input]));
      const sourceGeometry = new Map([...selected.program].map(([stepId, snapshot]) => [stepId, snapshot.geometry]));
      const originalStep = { ...selected.snapshot.step, inputs: { ...selected.snapshot.step.inputs,
        ...(construction.inputs.kind === undefined ? {} : { kind: construction.inputs.kind }) } };
      const positionAuthority = deriveMechanicsPositionAuthority(problem!, originalStep, sourceInputs, outputs[0]!, sourceGeometry);
      if (positionAuthority) {
        if (positionAuthority.sourceMismatches.length) fail(positionAuthority.sourceMismatches.join("; "));
        outputs[0] = withMechanicsPositionAuthority(outputs[0]!, positionAuthority);
      }
      cache.set(id, outputs[0]!); return outputs[0]!;
    } finally { active.delete(id); }
  }
  function inputs(value: unknown, selected: TrustedStep, scene: boolean, path = "", depth = 0, seen = new Set<string>()): unknown {
    if (++reads > 32768 || depth > 32) fail("mechanics physical input tree exceeds structural bounds");
    if (Array.isArray(value)) return value.map((child, i) => inputs(child, selected, scene, `${path}.${i}`, depth + 1, seen));
    if (record(value)) {
      if ("value" in value && Object.keys(value).every(key => ["value", "unit"].includes(key))) return inputs(value.value, selected, scene, path, depth + 1, seen);
      const normalized = { ...value };
      if (path === "" && selected.snapshot.step.operator === "rolling_contact" && normalized.mode === undefined) normalized.mode = "dynamics";
      if (path === "" && selected.snapshot.step.operator === "rigid_body_motion" && normalized.mode === undefined) normalized.mode = "dynamics";
      if (path === "" && selected.snapshot.step.operator === "angular_impulse" && normalized.kind === undefined) normalized.kind = "impulse";
      if (path === "" && normalized.mode === "equilibrium" && normalized.equilibriumMode === undefined) normalized.equilibriumMode = "dynamics";
      return Object.fromEntries(Object.entries(normalized).filter(([key]) => path !== "" || !VIEW_FIELDS.has(key) && key !== "sourcePositionAuthority").filter(([key]) => !(path === "" && ["mass_property", "rigid_body_state"].includes(selected.snapshot.step.operator) && key === "kind")).map(([key, child]) => [key, inputs(child, selected, scene, path ? `${path}.${key}` : key, depth + 1, seen)]));
    }
    if (typeof value !== "string") return value;
    if (path.endsWith(".expression")) return { syntaxKey: parseMathExpression(value).syntaxKey };
    if (path === "units" || path.startsWith("units.") || ["kind", "mode", "frame", "axisId", "centralId", "id", "shape", "symbol", "operation", "landmark", "direction", "angleUnit", "timeUnit", "inertiaUnit", "gravityDirection", "supportId", "forceId", "particleId", "plane"].includes(path.split(".").at(-1)!)) return value;
    const ref = scene ? bindings.get(value) : (() => { const snapshot = selected.program.get(value); return snapshot ? { requestId: selected.requestId, snapshot, program: selected.program } : undefined; })();
    if (ref) return { physicalReference: meaning(ref) };
    if (scene && quantities.has(value)) { if (seen.has(value)) fail("cyclic physical quantity input"); seen.add(value); try { return inputs(quantities.get(value)!.value, selected, scene, path, depth + 1, seen); } finally { seen.delete(value); } }
    if (!/\b[xy]\b/.test(value)) {
      try { return number(value); } catch { /* Non-numeric operator literals remain exact strings. */ }
    }
    return value;
  }
  const issues: SceneIssue[] = [];
  for (const [outputId, construction] of byOutput) {
    const selected = bindings.get(outputId)!;
    try {
      const expected = selected.snapshot;
      if (construction.operator !== expected.step.operator) fail("scene constructor changed the verified source operator");
      if (construction.operator === "rigid_body_state" && construction.inputs.origin !== undefined && ["point_position", "point_velocity", "point_acceleration", "instantaneous_center", "momentum", "net_force", "support_reaction", "friction_force", "normal_force"].includes(String(construction.inputs.kind))) fail("physical part anchors must be derived from their source model, not independently relocated");
      if (!same(inputs(construction.inputs, selected, true), inputs(expected.physicalInputs, selected, false))) fail("hidden or visible mechanics input differs from its full source-bound definition");
      const actual = evaluate(outputId);
      let expectedGeometry = expected.geometry;
      if (["mass_property", "rigid_body_state"].includes(construction.operator) && construction.inputs.kind !== expected.step.inputs.kind) {
        const variant: Record<string, unknown> = { ...expected.physicalInputs, kind: construction.inputs.kind };
        delete variant.origin; delete variant.displayScale; delete variant.displayLength;
        if (construction.operator === "rigid_body_state" && ["point_velocity", "point_acceleration", "momentum", "support_reaction", "net_force", "friction_force", "normal_force"].includes(String(variant.kind))) variant.displayLength = 1;
        const sourceContext: MechanicsEvaluationContext = { number(value) { if (typeof value !== "number") fail("source variant scalar must remain source-resolved"); return value; }, point() { return fail("source variant cannot use screen geometry"); }, geometry(value) { if (typeof value !== "string") fail("source variant dependency is not typed"); const target = selected.program.get(value); if (!target) fail("source variant dependency is not source-bound"); return target.geometry; } };
        expectedGeometry = evaluateMechanicsConstruction(construction.operator, variant, sourceContext)[0]!;
        const request = problem.solveRequests.find(request => request.id === selected.requestId);
        if (!request || request.kind !== "mechanics") fail("source selector variant lost its original native request");
        const variantStep = { ...expected.step, inputs: { ...expected.step.inputs, kind: construction.inputs.kind } };
        const positionAuthority = deriveMechanicsPositionAuthority(problem, variantStep, new Map(request.program.inputs.map(input => [input.id, input])),
          expectedGeometry, new Map([...selected.program].map(([stepId, snapshot]) => [stepId, snapshot.geometry])));
        if (positionAuthority) expectedGeometry = withMechanicsPositionAuthority(expectedGeometry, positionAuthority);
      }
      if (!same(intrinsic(actual), intrinsic(expectedGeometry))) fail("mechanics scene source, frame, regime, state or observable differs from the independently recomputed physical model");
      const positionAuthority = actual.mechanicsValue?.sourcePositionAuthority ?? (actual.kind === "point" ? actual.mechanicsModel?.sourcePositionAuthority : undefined);
      if (positionAuthority?.unprovedGeometry) fail("a directed physical glyph depends on an unproved source position");
      const labelIssues: SceneIssue[] = [];
      validateEvaluatedMechanicsLabels(construction, document.constructions.indexOf(construction), document, [actual], labelIssues);
      if (labelIssues.length) issues.push(...labelIssues.map(labelIssue => ({ ...labelIssue, code: positionAuthority?.unprovedClaims.length ? "mechanics_position_source_missing" : "mechanics_scene_label_mismatch" })));
      const captions = [...document.annotations.filter(annotation => annotation.targetIds.includes(outputId)).map(annotation => annotation.text),
        document.entities.find(entity => entity.id === outputId)?.label,
        ...document.constructions.filter(label => label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === outputId).map(label => label.inputs.text)];
      for (const caption of captions) { const message = mechanicsPositionCaptionIssue(caption, actual); if (message) issues.push(issue("mechanics_position_source_missing", message, construction)); }
    } catch (error) { issues.push(issue("mechanics_scene_source_mismatch", error instanceof Error ? error.message : "mechanics scene source replay failed", construction)); }
  }
  if (issues.length) return issues;
  const unavailable = new Set<string>(), available = new Set<string>();
  for (const outputId of byOutput.keys()) {
    const geometry = evaluate(outputId);
    const authority = geometry.mechanicsValue?.sourcePositionAuthority ?? (geometry.kind === "point" ? geometry.mechanicsModel?.sourcePositionAuthority : undefined);
    authority?.unprovedClaims.forEach(symbol => unavailable.add(symbol));
    mechanicsPhysicalClaims(geometry).forEach(claim => available.add(claim.symbol));
  }
  for (const quantity of document.quantities) if (typeof quantity.symbol === "string" && unavailable.has(unwrapMathMarkup(quantity.symbol).trim()) && !available.has(unwrapMathMarkup(quantity.symbol).trim()))
    issues.push({ ...issue("mechanics_position_source_missing", "a physical coordinate-dependent quantity needs original source position authority; a planner value and an invariant native model do not prove it"), path: `quantities[${document.quantities.indexOf(quantity)}]` });
  if (issues.length) return issues;
  const allByOutput = new Map<string, SceneConstruction>();
  for (const construction of document.constructions) for (const output of construction.outputs) {
    if (allByOutput.has(output)) return [issue("mechanics_boundary_output_invalid", "visible mechanics dependencies must have unique producers", construction)];
    allByOutput.set(output, construction);
  }
  const pointCache = new Map<string, RenderPoint>(), pointActive = new Set<string>(), vectorActive = new Set<string>();
  const first = (inputs: Record<string, unknown>, keys: string[]): unknown => keys.map(key => inputs[key]).find(value => value !== undefined);
  function screenPoint(value: unknown): RenderPoint {
    if (++reads > 32768) fail("mechanics visible dependencies exceed structural bounds");
    if (Array.isArray(value) && value.length === 2 && value.every(component => typeof component === "number" && Number.isFinite(component))) return { x: number(value[0]), y: number(value[1]) };
    if (record(value) && typeof value.x === "number" && typeof value.y === "number" && Object.keys(value).every(key => ["x", "y"].includes(key))) return { x: number(value.x), y: number(value.y) };
    if (typeof value !== "string") fail("a visible boundary requires a constructed screen point");
    if (byOutput.has(value)) { const geometry = evaluate(value); if (geometry.kind !== "point") fail("boundary anchor must retain a computed source point"); return geometry.point; }
    const saved = pointCache.get(value); if (saved) return saved;
    const construction = allByOutput.get(value);
    if (!construction || construction.outputs.length !== 1 || pointActive.has(value) || pointActive.size > 32) fail("visible boundary points must be bounded and acyclic");
    pointActive.add(value);
    try {
      const raw = construction.inputs;
      let point: RenderPoint;
      if (construction.operator === "point") point = { x: number(raw.x), y: number(raw.y) };
      else if (construction.operator === "midpoint") point = scale2(add2(screenPoint(first(raw, ["a", "start"])), screenPoint(first(raw, ["b", "end"])), "midpoint"), 0.5, "midpoint");
      else if (construction.operator === "translate") point = add2(screenPoint(first(raw, ["point", "source"])), screenVector(first(raw, ["vector", "delta"])), "translation");
      else if (construction.operator === "affine_point") {
        const result = evaluateAffineConstruction("affine_point", raw, { number, point: screenPoint, geometry(reference) { return { kind: "point", point: screenPoint(reference) }; } });
        if (result[0]?.kind !== "point") fail("affine boundary dependency must remain a point"); point = result[0].point;
      } else return fail("unsupported visible boundary point construction");
      pointCache.set(value, point); return point;
    } finally { pointActive.delete(value); }
  }
  function screenVector(value: unknown): RenderPoint {
    if (++reads > 32768) fail("visible vector dependencies exceed structural bounds");
    if (Array.isArray(value) && value.length === 2 && value.every(component => typeof component === "number" && Number.isFinite(component))) return { x: value[0], y: value[1] };
    if (record(value) && typeof value.x === "number" && typeof value.y === "number") return { x: value.x, y: value.y };
    if (typeof value !== "string") return fail("boundary direction must be a constructed planar vector");
    const construction = allByOutput.get(value);
    if (!construction || vectorActive.has(value) || vectorActive.size >= 32 || !["segment", "line", "vector", "ray", "polyline"].includes(construction.operator)) return fail("boundary vector dependencies must be supported, bounded and acyclic");
    vectorActive.add(value);
    try { const [a, b] = lineEnds(construction); return { x: b.x - a.x, y: b.y - a.y }; } finally { vectorActive.delete(value); }
  }
  function lineEnds(construction: SceneConstruction): readonly [RenderPoint, RenderPoint] {
    if (construction.operator === "polyline") { if (!Array.isArray(construction.inputs.points) || construction.inputs.points.length !== 2) fail("rod/axis polyline must be one straight segment"); return [screenPoint(construction.inputs.points[0]), screenPoint(construction.inputs.points[1])]; }
    const start = screenPoint(first(construction.inputs, ["start", "from", "a", "origin"]));
    const end = first(construction.inputs, ["end", "to", "b"]);
    return [start, end === undefined ? add2(start, screenVector(first(construction.inputs, ["direction", "vector"])), "axis endpoint") : screenPoint(end)];
  }
  function pointOwner(selected: TrustedStep, path: string): string {
    const scope = Object.keys(selected.snapshot.step.sourceOwners ?? {}).filter(key => path === key || path.startsWith(`${key}.`)).sort((a, b) => b.length - a.length)[0];
    if (scope) return selected.snapshot.step.sourceOwners![scope]!;
    let value: unknown = selected.snapshot.step.inputs;
    for (const key of path.split(".")) value = record(value) || Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
    const request = problem!.solveRequests.find(candidate => candidate.id === selected.requestId);
    if (request?.kind === "mechanics" && Array.isArray(value)) {
      const owners = value.map(component => request.program.inputs.find(input => input.id === component)?.ownerId);
      if (owners.length && owners.every(owner => owner !== undefined && owner === owners[0])) return owners[0]!;
    }
    return mechanicsSourceOwnerForPath(selected.snapshot.step, path);
  }
  function sourcePointSelector(selected: TrustedStep, geometry: MechanicsGeometry, ownerId?: string): MechanicsBoundarySelector {
    if (ownerId === undefined) return { projection: "point" };
    const model = geometry.kind === "point" ? geometry.mechanicsModel : undefined;
    if (!model) {
      if (!["offset", "pointDefinition"].some(path => selected.snapshot.step.sourceOwners?.[path] === ownerId)) fail("a native value point must retain its verified material-point owner");
      return { projection: "point" };
    }
    const candidates: MechanicsBoundarySelector[] = [], raw = selected.snapshot.step.inputs;
    const add = (path: string, selector: MechanicsBoundarySelector): void => { if (pointOwner(selected, path) === ownerId) candidates.push(selector); };
    const sourceGeometry = mechanicsSourceGeometry(geometry);
    for (const body of sourceGeometry.bodies) {
      const index = body.componentIndex;
      const path = selected.snapshot.step.operator === "mass_moments" ? `components.${index ?? 0}` : "bodyGeometry";
      add(`${path}.center`, { projection: "point", ...(index === undefined ? {} : { componentIndex: index }) });
      if (body.endpointsSI && index !== undefined) for (const endpointIndex of [0, 1] as const) add(`${path}.endpoints.${endpointIndex}`, { projection: "point", componentIndex: index, endpointIndex });
    }
    if (raw.position !== undefined) add("position", { projection: "point" });
    if (raw.referencePoint !== undefined) add("referencePoint.0", { projection: "point", referencePoint: true });
    if (record(raw.axis) && raw.axis.point !== undefined) add("axis.point", { projection: "point", referencePoint: true });
    const derivation = record(raw.derivation) ? raw.derivation : undefined;
    const forcePath = Array.isArray(raw.forces) ? "forces" : "derivation.forces", forces = raw.forces ?? derivation?.forces;
    if (Array.isArray(forces)) forces.forEach((force, forceIndex) => { if (record(force)) add(`${forcePath}.${forceIndex}.point`, { projection: "point", forceIndex }); });
    const supportPath = Array.isArray(raw.supports) ? "supports" : "derivation.supports", supports = raw.supports ?? derivation?.supports;
    if (Array.isArray(supports)) supports.forEach((support, index) => { if (record(support) && typeof support.id === "string") add(`${supportPath}.${index}.point`, { projection: "point", supportId: support.id }); });
    const usable = candidates.flatMap(selector => { try { return [{ selector, projection: mechanicsBoundaryProjection(geometry, selector) }]; } catch { return []; } });
    if (!usable.length || usable.some(candidate => candidate.projection.projection !== "point" || !same(candidate.projection.point, (usable[0]!.projection as { point: RenderPoint }).point))) fail("a named physical point must select one unambiguous native source position");
    return usable[0]!.selector;
  }
  function validatePointLabel(construction: SceneConstruction, selected: TrustedStep, geometry: MechanicsGeometry, componentOwnerId?: string): void {
    const text = document.entities.find(entity => entity.id === construction.outputs[0])?.label?.trim();
    if (!text) return;
    const named = (ownerId: string): boolean => {
      const sourceLabel = problem!.entities.find(entity => entity.id === ownerId)?.label;
      if (!sourceLabel) return false;
      const escaped = sourceLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^${escaped}(?:$|\\s|[=(])`, "u").test(text);
    };
    if (componentOwnerId !== undefined) { if (!named(componentOwnerId)) fail("visible point label changed its selected source owner"); return; }
    const model = geometry.kind === "point" ? geometry.mechanicsModel : undefined;
    const comNames = [...problem!.question.matchAll(/(?:cent(?:re|er)\s+of\s+mass|COM)\s+([A-Za-z][A-Za-z0-9_]*)\b/gi)].map(match => match[1]!);
    if (model?.kind === "mass_moments") {
      if (!["CM", "COM", ...comNames].some(name => text === name || text.startsWith(`${name} `) || text.startsWith(`${name}=`))) fail("a combined COM point cannot inherit another body's point identity");
      return;
    }
    const path = model && ["wrench", "equilibrium"].includes(model.kind) ? "referencePoint.0" : "position";
    const owners = [pointOwner(selected, path), selected.snapshot.step.sourceOwners?.offset, selected.snapshot.step.sourceOwners?.pointDefinition].filter((owner): owner is string => typeof owner === "string");
    if (!owners.some(named)) fail("visible native point must retain its source pose or material-point identity");
  }
  const boundaryOutputs = new Set<string>();
  const rawBoundaries = document.source.mechanicsBoundaryBindings ?? [];
  if (!Array.isArray(rawBoundaries) || rawBoundaries.length > 256) return [issue("mechanics_boundary_binding_invalid", "visible body bindings must be a bounded selector list")];
  for (const rawBinding of rawBoundaries) {
    const invalid = (message: string): void => { issues.push(issue("mechanics_boundary_binding_invalid", message)); };
    if (!record(rawBinding) || Object.keys(rawBinding).some(key => !["outputId", "modelOutputId", "requestId", "stepId", "ownerId", "axisId", "componentOwnerId", "projection"].includes(key)) || !["outputId", "modelOutputId", "requestId", "stepId", "ownerId"].every(key => typeof rawBinding[key] === "string" && String(rawBinding[key]).length <= 128) || ["axisId", "componentOwnerId"].some(key => rawBinding[key] !== undefined && (typeof rawBinding[key] !== "string" || String(rawBinding[key]).length > 128)) || !["point", "circle", "rod", "axis"].includes(String(rawBinding.projection))) { invalid("body boundary records select native source models, never proof stamps"); continue; }
    const selected = bindings.get(String(rawBinding.modelOutputId)), construction = allByOutput.get(String(rawBinding.outputId));
    if (!selected || !construction || construction.outputs.length !== 1 || boundaryOutputs.has(String(rawBinding.outputId)) || rawBinding.requestId !== selected.requestId || rawBinding.stepId !== selected.snapshot.step.id || rawBinding.ownerId !== selected.snapshot.step.ownerId) { invalid("visible boundary must select one completely revalidated source model and owner"); continue; }
    boundaryOutputs.add(String(rawBinding.outputId));
    try {
      const geometry = evaluate(String(rawBinding.modelOutputId));
      if (rawBinding.projection === "point") {
        if (rawBinding.axisId !== undefined && rawBinding.axisId !== selected.snapshot.step.axisId) fail("visible point changed its named source axis");
        const ownerId = typeof rawBinding.componentOwnerId === "string" ? rawBinding.componentOwnerId : undefined;
        const expected = mechanicsBoundaryProjection(geometry, sourcePointSelector(selected, geometry, ownerId));
        if (expected.projection !== "point" || !same(screenPoint(String(rawBinding.outputId)), expected.point)) fail("visible source point differs from its independently projected source position");
        validatePointLabel(construction, selected, geometry, ownerId);
        continue;
      }
      const sourceGeometry = mechanicsSourceGeometry(geometry);
      let componentIndex: number | undefined;
      if (rawBinding.componentOwnerId !== undefined) {
        if (typeof rawBinding.componentOwnerId !== "string") fail("boundary component owner must be a source entity");
        const component = sourceGeometry.bodies.find(body => body.componentIndex === undefined ? rawBinding.componentOwnerId === selected.snapshot.step.ownerId : mechanicsSourceOwnerForPath(selected.snapshot.step, `components.${body.componentIndex}.mass`) === rawBinding.componentOwnerId);
        if (!component) fail("visible shape component must preserve its source physical owner"); componentIndex = component.componentIndex;
      } else if (sourceGeometry.bodies.length > 1 && rawBinding.projection !== "axis") fail("multi-body boundary must identify its source component");
      const axisId = typeof rawBinding.axisId === "string" ? rawBinding.axisId : selected.snapshot.step.axisId;
      const nativeAxis = sourceGeometry.axes.find(axis => axis.id === axisId);
      if (rawBinding.projection !== "axis" && axisId !== selected.snapshot.step.axisId || rawBinding.projection === "axis" && !nativeAxis && (axisId !== selected.snapshot.step.axisId || sourceGeometry.axes.some(axis => axis.id))) fail("visible boundary changed its named source axis");
      const expected = mechanicsBoundaryProjection(geometry, { projection: rawBinding.projection as "circle" | "rod" | "axis", ...(componentIndex === undefined ? {} : { componentIndex }), ...(rawBinding.projection === "axis" && nativeAxis ? { axisId } : {}) });
      if (expected.projection === "circle") {
        if (construction.operator !== "circle" || Object.keys(construction.inputs).some(key => !["center", "radius", "r"].includes(key))) fail("a source circle must retain its ordinary exact circle constructor");
        if (!same(screenPoint(construction.inputs.center), expected.center) || !same(number(first(construction.inputs, ["radius", "r"])), expected.radius)) fail("visible circle centre or radius contradicts source pose, units or display scale");
      } else if (expected.projection === "rod") {
        if (!["segment", "polyline"].includes(construction.operator)) fail("a finite source rod must retain its two exact endpoints");
        const actual = lineEnds(construction);
        if (!same(actual, expected.endpoints) && !same([actual[1], actual[0]], expected.endpoints)) fail("visible rod endpoints contradict its full source shape and pose");
      } else if (expected.projection === "point") {
        if (!same(screenPoint(String(rawBinding.outputId)), expected.point)) fail("visible source point differs from its independently projected source position");
      } else {
        if (!["vector", "line", "segment", "ray", "polyline"].includes(construction.operator)) fail("source axis needs its native planar or page-normal direction glyph");
        const direction = construction.inputs.direction;
        if (construction.operator === "vector" && Array.isArray(direction) && direction.length === 3) {
          const values = direction.map(value => number(value)), norm = Math.hypot(...values);
          if (!(norm > 0) || values[2] !== 0 && (values[0] !== 0 || values[1] !== 0) || !same(screenPoint(first(construction.inputs, ["start", "from", "a", "origin"])), expected.point) || !same({ x: values[0]! / norm, y: values[1]! / norm, z: values[2]! / norm }, expected.directionSI)) fail("visible axis cannot replace its source page-normal sign or spatial direction");
        } else {
          if (expected.directionSI.z !== 0) fail("a normal axis must use a true page-normal dot/cross glyph");
          const [a, b] = lineEnds(construction), delta = { x: b.x - a.x, y: b.y - a.y }, norm = Math.hypot(delta.x, delta.y), unit = { x: delta.x / norm, y: delta.y / norm };
          const wanted = { x: expected.directionSI.x, y: expected.directionSI.y };
          if (!(norm > 0) || !same(a, expected.point) || !same(unit, wanted) && (!["line", "segment"].includes(construction.operator) || !same({ x: -unit.x, y: -unit.y }, wanted))) fail("visible axis must retain its exact source point and direction");
        }
      }
    } catch (error) { issues.push(issue("mechanics_boundary_source_mismatch", error instanceof Error ? error.message : "visible mechanics boundary replay failed", construction)); }
  }
  const metricModels = [...bindings.keys()].flatMap(id => { try { return mechanicsSourceGeometry(evaluate(id)).bodies; } catch { return []; } }).filter(body => body.radiusSI !== undefined || body.lengthSI !== undefined);
  function dependsOnMechanics(value: unknown, seen = new Set<string>(), depth = 0): boolean {
    if (depth > 32) fail("visible source dependency tree exceeds structural bounds");
    if (Array.isArray(value)) return value.some(child => dependsOnMechanics(child, seen, depth + 1));
    if (record(value)) return Object.values(value).some(child => dependsOnMechanics(child, seen, depth + 1));
    if (typeof value !== "string") return false;
    if (bindings.has(value)) return true;
    const producer = allByOutput.get(value);
    if (!producer || seen.has(value)) return false;
    seen.add(value); return dependsOnMechanics(producer.inputs, seen, depth + 1);
  }
  const implicitHelpers = implicitSolverEntityIds({ ...document, relations: document.relations ?? [], assertions: document.assertions ?? [],
    requiredEntityIds: document.requiredEntityIds ?? [], annotations: document.annotations ?? [], revealGroups: document.revealGroups ?? [] });
  const physicalOwners = problem.entities.filter(entity => ["body", "solid", "component", "point", "line", "field"].includes(entity.kind));
  const identity = (text: string): string => unwrapMathMarkup(text).normalize("NFKC").replace(/_\{([^{}]+)\}/g, "_$1").trim();
  const ownerAliases = physicalOwners.map(owner => ({ id: owner.id, names: [...new Set([owner.id, owner.label]
    .filter((name): name is string => typeof name === "string" && Boolean(name.trim())).map(identity))] }));
  function namedOwners(output: string): string[] {
    const entity = document.entities.find(entity => entity.id === output);
    if (!entity) return [];
    const labels = [entity.label, entity.semantic?.name, entity.semantic?.symbol,
      ...(!implicitHelpers.has(output) ? document.annotations.filter(annotation => annotation.kind === "label" && annotation.targetIds.includes(output)).map(annotation => annotation.text) : []),
      ...(!implicitHelpers.has(output) ? document.constructions.filter(construction => construction.operator === "label" &&
        [construction.inputs.target, construction.inputs.at, construction.inputs.point].includes(output)).map(construction => construction.inputs.text) : []),
    ].filter((text): text is string => typeof text === "string" && Boolean(text.trim())).map(identity);
    const role = identity(entity.role ?? "");
    const prefix = (text: string, name: string): boolean => text === name || text.startsWith(name) &&
      !/[\p{L}\p{N}_]/u.test(text.slice(name.length, name.length + 1));
    // A primary name owns its glyph. Context later in the label ("A about O")
    // describes that owner; it does not turn the same glyph into the axis O.
    const owners = labels.flatMap(label => {
      const primary = ownerAliases.filter(owner => owner.names.some(name => prefix(label, name)));
      if (primary.length) return primary.map(owner => owner.id);
      const head = label.split(/[([=:;,]/u)[0]!.trim();
      return ownerAliases.filter(owner => owner.names.some(name => head === name || head.endsWith(` ${name}`))).map(owner => owner.id);
    });
    for (const owner of ownerAliases) if (owner.names.includes(identity(entity.id)) || owner.names.some(name => role === name ||
      !/\b(?:of|at|on|from|to|about|through|around|between|toward|towards)\b/iu.test(role) && (prefix(role, name) || role.endsWith(` ${name}`)))) owners.push(owner.id);
    return [...new Set(owners)];
  }
  function declaresPhysicalGeometry(output: string): boolean {
    const entity = document.entities.find(entity => entity.id === output);
    const role = identity(entity?.role ?? "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
    return ["body", "physical body", "source body", "axis", "physical axis", "source axis", "physical point", "source point",
      "physical vector", "source vector", "field", "force"].includes(role);
  }
  const boundaryBindings = new Map(rawBoundaries.filter(record).map(binding => [String(binding.outputId), binding]));
  function boundaryOwners(binding: Record<string, unknown>): string[] {
    const selected = bindings.get(String(binding.modelOutputId));
    if (!selected) return [];
    if (binding.projection === "axis") return [typeof binding.axisId === "string" ? binding.axisId : selected.snapshot.step.axisId];
    if (typeof binding.componentOwnerId === "string") return [binding.componentOwnerId];
    if (binding.projection === "point") return [selected.snapshot.step.ownerId, selected.snapshot.step.sourceOwners?.offset,
      selected.snapshot.step.sourceOwners?.pointDefinition].filter((owner): owner is string => typeof owner === "string");
    const bodies = mechanicsSourceGeometry(evaluate(String(binding.modelOutputId))).bodies;
    const index = bodies.length === 1 ? bodies[0]!.componentIndex : undefined;
    return [selected.snapshot.step.operator === "mass_moments" && index !== undefined
      ? mechanicsSourceOwnerForPath(selected.snapshot.step, `components.${index}.mass`) : selected.snapshot.step.ownerId];
  }
  let independentlyProved: boolean | undefined;
  for (const construction of document.constructions) {
    if (isMechanics(construction.operator) || construction.operator === "label") continue;
    try {
      for (const output of construction.outputs) {
        if (["dimension", "angle_mark"].includes(construction.operator) && !declaresPhysicalGeometry(output)) continue;
        const named = namedOwners(output);
        if (!named.length && !declaresPhysicalGeometry(output)) continue;
        const binding = boundaryBindings.get(output);
        if (binding && boundaryOutputs.has(output)) {
          if (named.some(owner => !boundaryOwners(binding).includes(owner))) issues.push(issue("mechanics_boundary_owner_mismatch",
            "visible physical identity must retain the source body, point, axis or vector selected by its native boundary", construction));
        } else if (!(independentlyProved ??= independentlyReplayedSourceDocument(document, question, acceptedPlan))) {
          issues.push(issue("mechanics_boundary_binding_missing",
            "source-identified physical bodies, points, axes and vectors need their own verified native boundary; literal helper coordinates and an unrelated correct model prove no source geometry", construction));
        }
      }
    } catch (error) { issues.push(issue("mechanics_boundary_binding_invalid", error instanceof Error ? error.message : "invalid physical source identity", construction)); }
  }
  for (const construction of document.constructions) {
    if (construction.outputs.some(output => boundaryOutputs.has(output)) || !["circle", "segment", "line", "ray", "polyline", "vector"].includes(construction.operator)) continue;
    try {
      if (construction.operator === "circle" && metricModels.length || construction.operator !== "circle" && (dependsOnMechanics(construction.inputs) || construction.operator === "vector" && Array.isArray(construction.inputs.direction) && construction.inputs.direction.length === 3)) issues.push(issue("mechanics_boundary_binding_missing", "visible source body/axis consumers require their own physical boundary selector", construction));
    } catch (error) { issues.push(issue("mechanics_boundary_binding_invalid", error instanceof Error ? error.message : "invalid visible source dependency", construction)); }
  }
  const revealed = new Set(document.revealGroups.flatMap(group => group.entityIds));
  for (const construction of document.constructions) {
    if (!["point", "midpoint", "translate", "rotate", "affine_point", "intersection"].includes(construction.operator) || construction.outputs.some(output => boundaryOutputs.has(output))) continue;
    const labelled = construction.outputs.some(output => document.entities.some(entity => entity.id === output && typeof entity.label === "string" && entity.label.trim()));
    const visible = labelled || construction.outputs.some(output => revealed.has(output) && !implicitHelpers.has(output));
    const plotHelper = !labelled && document.constructions.some(consumer => ["axes", "function_curve", "function_region"].includes(consumer.operator) && construction.outputs.some(output => Object.values(consumer.inputs).includes(output)));
    if (visible && !plotHelper) issues.push(issue("mechanics_point_binding_missing", "generic physical source/derived locations require a native point selector; a hidden valid model cannot certify another point", construction));
  }
  const plotModels = new Map<string, MechanicsPlotModel>();
  for (const [output, selected] of bindings) plotModels.set(output, { requestId: selected.requestId, step: selected.snapshot.step, geometry: evaluate(output) });
  issues.push(...validateMechanicsPlotSourceBinding(document, plotModels, number));
  return issues;
}
