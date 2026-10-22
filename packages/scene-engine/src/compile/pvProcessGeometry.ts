import type { RenderPoint, RenderPrimitive, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { snapshotMathSourceData } from "./mathSourceData";
import { directedCurveInk } from "./directedCurve";
import { evaluateThermodynamicsConstruction, polytropicPressureAt, pressureCanonical, volumeCanonical, PRESSURE_FACTORS, VOLUME_FACTORS, type PressureUnit, type VolumeUnit, type ThermodynamicProcessDefinition } from "./thermodynamicsGeometry";

type State = { id: string; pressure: number; volume: number };
type Law = "isobar" | "isochor" | "isotherm" | "adiabat";
type Process = { kind: Law; from: string; to: string; representativeExponent?: number };
type PhysicalProcess = { kind: Law; from: string; to: string; physicalProcess: ThermodynamicProcessDefinition };
type PhysicalState = State & { pressureSI: number; volumeSI: number };
export interface PvPlotGeometry {
  kind: "pv_plot";
  pvPlot:
    | { mode: "conceptual"; nonmetric: true; states: State[]; processes: Process[] }
    | { mode: "physical"; nonmetric: true; pressureUnit: PressureUnit; volumeUnit: VolumeUnit; states: PhysicalState[]; processes: PhysicalProcess[] };
}
function fail(message: string): never { throw new Error(message); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail("P-V inputs contain unsupported fields");
}
function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1e12) fail("P-V coordinates must be positive bounded numbers");
  return value;
}
function identity(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z](?:_?\d{1,2})?$/.test(value)) fail("P-V state names must be short mathematical identities");
  return value.replace(/^([A-Za-z])_?(\d+)$/, "$1_$2");
}
function close(a: number, b: number): boolean { return Math.abs(a - b) <= 64 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b)); }
function exponent(process: Process | PhysicalProcess): number { return "physicalProcess" in process ? process.physicalProcess.exponent! : process.kind === "isobar" ? 0 : process.kind === "isotherm" ? 1 : process.representativeExponent!; }
function physicalScalar(value: unknown, unit: string, quantities: SceneDocument["quantities"]): number {
  if (typeof value !== "string" || !quantities.some((quantity) => quantity.id === value)) fail("Physical P-V values require exact declared quantity references");
  const quantity = quantities.find((candidate) => candidate.id === value)!;
  // Production plan agreement audits flat numeric quantities. Do not let an
  // object/string value evade that audit and become physical authority here.
  if (typeof quantity.value !== "number" || typeof quantity.unit !== "string") fail("P-V physical references need flat numeric values and explicit units");
  const canonical = pressureCanonical(quantity.unit) ?? volumeCanonical(quantity.unit) ?? (["1", "dimensionless"].includes(quantity.unit.trim().toLowerCase()) ? "1" : undefined);
  if (canonical !== unit) fail("P-V quantity unit contradicts the declared axis dimension/scale");
  return positive(quantity.value);
}
export function evaluatePvProcessConstruction(raw: Record<string, unknown>, document: SceneDocument): PvPlotGeometry[] {
  const { inputs, quantities, source } = snapshotMathSourceData({ inputs: raw, quantities: document.quantities, source: document.source });
  const physical = inputs.mode === "physical";
  if (!physical && inputs.mode !== "conceptual") fail("P-V mode must be physical or conceptual");
  keys(inputs, physical ? ["mode", "states", "processes", "pressureUnit", "volumeUnit"] : ["mode", "states", "processes"]);
  if (!physical && (source.nonMetric !== true || source.representationTier !== "qualitative_verified")) fail("Conceptual P-V plots require explicit qualitative nonmetric provenance");
  const pressureUnit = typeof inputs.pressureUnit === "string" ? pressureCanonical(inputs.pressureUnit) : undefined;
  const volumeUnit = typeof inputs.volumeUnit === "string" ? volumeCanonical(inputs.volumeUnit) : undefined;
  if (physical && (!pressureUnit || !volumeUnit)) fail("Physical P-V plots require explicit pressure and volume units");
  if (new Set(quantities.map((quantity) => quantity.id)).size !== quantities.length) fail("P-V quantity IDs must be unique");
  if (!Array.isArray(inputs.states) || inputs.states.length < 2 || inputs.states.length > 8) fail("P-V plots require 2..8 named states");
  const states = inputs.states.map((value): State => {
    if (!record(value)) fail("P-V state must be an object"); keys(value, ["id", "pressure", "volume"]);
    return { id: identity(value.id), pressure: physical ? physicalScalar(value.pressure, pressureUnit!, quantities) : positive(value.pressure), volume: physical ? physicalScalar(value.volume, volumeUnit!, quantities) : positive(value.volume) };
  });
  if (new Set(states.map((state) => state.id)).size !== states.length) fail("P-V state identities must be unique");
  if (states.some((a, index) => states.slice(index + 1).some((b) => close(a.pressure, b.pressure) && close(a.volume, b.volume)))) fail("Different P-V state identities cannot occupy the same state");
  if (!Array.isArray(inputs.processes) || inputs.processes.length < 1 || inputs.processes.length > 8) fail("P-V plots require 1..8 processes");
  const used = new Set<string>();
  const pairs = new Set<string>();
  const processes = inputs.processes.map((value): Process | PhysicalProcess => {
    if (!record(value)) fail("P-V process must be an object"); keys(value, physical && value.kind === "adiabat" ? ["kind", "from", "to", "gamma"] : ["kind", "from", "to"]);
    const from = identity(value.from); const to = identity(value.to);
    const a = states.find((state) => state.id === from); const b = states.find((state) => state.id === to);
    if (!a || !b || from === to) fail("P-V process needs two distinct named states");
    if (!["isobar", "isochor", "isotherm", "adiabat"].includes(String(value.kind))) fail("Unknown P-V process law");
    const kind = value.kind as Law;
    const pair = [from, to].sort().join("/");
    if (pairs.has(pair)) fail("P-V processes cannot duplicate a state pair, including in reverse"); pairs.add(pair);
    if (kind === "isochor") {
      if (!close(a.volume, b.volume) || close(a.pressure, b.pressure)) fail("An isochor needs equal volumes and distinct pressures");
    } else {
      if (close(a.volume, b.volume)) fail("A P-V volume-changing process needs distinct volumes");
      const n = kind === "isobar" ? 0 : kind === "isotherm" ? 1 : physical ? physicalScalar(value.gamma, "1", quantities) : (Math.log(a.pressure) - Math.log(b.pressure)) / (Math.log(b.volume) - Math.log(a.volume));
      if (kind === "adiabat" && (!Number.isFinite(n) || n <= 1 || n > 64)) fail("A reversible ideal-gas adiabat needs an endpoint exponent in (1,64]");
      if (!close(polytropicPressureAt(a.pressure, a.volume, n, b.volume), b.pressure)) fail("P-V endpoints contradict the declared law");
      used.add(from); used.add(to);
      if (physical) return { kind, from, to, physicalProcess: kernelProcess(a, b, n, pressureUnit!, volumeUnit!) };
      return { kind, from, to, ...(kind === "adiabat" ? { representativeExponent: n } : {}) };
    }
    used.add(from); used.add(to);
    return physical ? { kind, from, to, physicalProcess: kernelProcess(a, b, null, pressureUnit!, volumeUnit!) } : { kind, from, to };
  });
  if (used.size !== states.length) fail("Every P-V state must belong to a process");
  for (const [i, first] of processes.entries()) for (const second of processes.slice(i + 1)) {
    const a = states.find((state) => state.id === first.from)!; const b = states.find((state) => state.id === first.to)!;
    const c = states.find((state) => state.id === second.from)!; const d = states.find((state) => state.id === second.to)!;
    if ((first.kind === "isochor") !== (second.kind === "isochor")) continue;
    const axis = first.kind === "isochor" ? "pressure" : "volume";
    const lo = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
    const hi = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
    if (hi <= lo || close(lo, hi)) continue;
    const same = axis === "pressure" ? close(a.volume, c.volume) : close(exponent(first), exponent(second)) && close(polytropicPressureAt(a.pressure, a.volume, exponent(first), (lo + hi) / 2), polytropicPressureAt(c.pressure, c.volume, exponent(second), (lo + hi) / 2));
    if (same) fail("P-V processes cannot duplicate overlapping law geometry");
  }
  if (physical) return [{ kind: "pv_plot", pvPlot: { mode: "physical", nonmetric: true, pressureUnit: pressureUnit!, volumeUnit: volumeUnit!,
    states: states.map((state) => ({ ...state, pressureSI: state.pressure * PRESSURE_FACTORS[pressureUnit!], volumeSI: state.volume * VOLUME_FACTORS[volumeUnit!] })),
    processes: processes.map((process) => { if (!("physicalProcess" in process)) fail("Physical process authority is missing"); return process; }),
  } }];
  return [{ kind: "pv_plot", pvPlot: { mode: "conceptual", nonmetric: true, states, processes: processes.map((process) => { if ("physicalProcess" in process) fail("Conceptual process cannot contain physical authority"); return process; }) } }];
}
function kernelProcess(a: State, b: State, n: number | null, pressureUnit: PressureUnit, volumeUnit: VolumeUnit): ThermodynamicProcessDefinition {
  const outputs = evaluateThermodynamicsConstruction(n === null ? "isochoric_process" : "polytropic_process", {
    ...(n === null ? { volume: a.volume, pressureEnd: b.pressure } : { volumeStart: a.volume, volumeEnd: b.volume, exponent: n }),
    pressureStart: a.pressure, pressureUnit, volumeUnit, pressureScale: 1 / Math.max(a.pressure, b.pressure), volumeScale: 1 / Math.max(a.volume, b.volume),
  }, { number(value) { if (typeof value !== "number" || !Number.isFinite(value)) fail("Physical process kernel needs finite scalars"); return value; }, point() { return { x: 0, y: 0 }; }, geometry() { return undefined; } });
  const output = outputs[0]; if (output?.kind !== "path") fail("Physical process kernel returned no path"); return output.physicalProcess;
}
export function pvPlotBounds(): RenderPoint[] { return [{ x: -0.7, y: -0.6 }, { x: 8.7, y: 5.6 }]; }
export function pvPlotPrimitives(value: PvPlotGeometry, entityId: string, groupId: string, transform: (point: RenderPoint) => RenderPoint): RenderPrimitive[] {
  const plot = value.pvPlot; const { states, processes } = plot;
  const maxP = Math.max(...states.map((state) => state.pressure)) * 1.2;
  const maxV = Math.max(...states.map((state) => state.volume)) * 1.2;
  const at = (state: State): RenderPoint => ({ x: state.volume / maxV * 8, y: state.pressure / maxP * 5 });
  const zero = transform({ x: 0, y: 0 });
  const displayStates = states.map((state) => transform(at(state)));
  if (displayStates.some((point, index) => point.x - zero.x < 3 || zero.y - point.y < 3 || displayStates.slice(index + 1).some((other) => Math.hypot(other.x - point.x, other.y - point.y) < 12))) fail("P-V states collapse at final display precision");
  const result: RenderPrimitive[] = [];
  const emit = (suffix: string, kind: RenderPrimitive["kind"], points: RenderPoint[], text?: string, role = suffix, metadata?: Record<string, unknown>): void => {
    result.push({ id: `${entityId}_${suffix}`, entityId, groupId, kind, points: points.map(transform), ...(text ? { text } : {}), provenance: { pvRole: role, pvMode: plot.mode, nonmetric: true, ...metadata } });
  };
  emit("axis_v", "vector", [{ x: 0, y: 0 }, { x: 8, y: 0 }]);
  emit("axis_p", "vector", [{ x: 0, y: 0 }, { x: 0, y: 5 }]);
  emit("name_v", "label", [{ x: 8.3, y: 0 }], plot.mode === "physical" ? `V (${plot.volumeUnit})` : "V");
  emit("name_p", "label", [{ x: 0, y: 5.3 }], plot.mode === "physical" ? `P (${plot.pressureUnit})` : "P");
  if (plot.mode === "conceptual") emit("schematic", "label", [{ x: 4, y: 5.4 }], "ideal gas sketch");
  for (const state of states) {
    const point = at(state); emit(`state_${state.id}`, "point", [point], undefined, "state", { pvStateId: state.id, ...("pressureSI" in state ? { pressureSI: state.pressureSI, volumeSI: state.volumeSI } : {}) });
    emit(`name_${state.id}`, "label", [point], state.id, "state_name");
  }
  processes.forEach((process, index) => {
    const a = states.find((state) => state.id === process.from)!; const b = states.find((state) => state.id === process.to)!;
    const stateAt = (t: number): State => {
      if (t === 0) return a; if (t === 1) return b;
      const volume = a.volume * (1 - t) + b.volume * t;
      return { id: "", volume, pressure: process.kind === "isochor" ? a.pressure * (1 - t) + b.pressure * t : polytropicPressureAt(a.pressure, a.volume, exponent(process), volume) };
    };
    const pointAt = (t: number) => at(stateAt(t));
    const start = transform(pointAt(0)); const end = transform(pointAt(1));
    for (const axis of process.kind === "isochor" ? ["y"] as const : process.kind === "isobar" ? ["x"] as const : ["x", "y"] as const) if (Math.abs(end[axis] - start[axis]) < 3) fail("A changing P-V axis is unresolved on the final display");
    const derivativeAt = (t: number): RenderPoint => {
      const state = stateAt(t); const dx = (b.volume - a.volume) / maxV * 8;
      const dy = -exponent(process) * (state.pressure / maxP) / (state.volume / maxV) * dx * 5 / 8;
      return { x: dx * (transform({ x: 1, y: 0 }).x - zero.x), y: dy * (transform({ x: 0, y: 1 }).y - zero.y) };
    };
    const points = process.kind === "isochor" || process.kind === "isobar" ? [pointAt(0), pointAt(1)] : sampleCurve(pointAt, derivativeAt, transform);
    emit(`process_${index}`, "vector", points, undefined, "process", "physicalProcess" in process ? { pvWorkJ: process.physicalProcess.workJ } : undefined);
    const middle = pointAt(0.5);
    emit(`law_${index}`, "label", [middle], process.kind, "process_name");
  });
  return result;
}
function angle(a: RenderPoint, b: RenderPoint): number {
  return Math.atan2(Math.abs(a.x * b.y - a.y * b.x), a.x * b.x + a.y * b.y);
}
function sampleCurve(pointAt: (t: number) => RenderPoint, derivativeAt: (t: number) => RenderPoint, transform: (point: RenderPoint) => RenderPoint): RenderPoint[] {
  const points = [pointAt(0)];
  function sample(lo: number, hi: number, depth: number): void {
    const a = transform(pointAt(lo)); const b = transform(pointAt(hi));
    const chord = { x: b.x - a.x, y: b.y - a.y }; const length = Math.hypot(chord.x, chord.y);
    const error = Math.max(...[0.25, 0.5, 0.75].map((fraction) => {
      const p = transform(pointAt(lo + (hi - lo) * fraction));
      return Math.abs(chord.y * (p.x - a.x) - chord.x * (p.y - a.y)) / length;
    }));
    if (!(error <= 0.15 && angle(chord, derivativeAt(lo)) <= 0.035 && angle(chord, derivativeAt(hi)) <= 0.035)) {
      const middle = (lo + hi) / 2;
      if (depth >= 24 || middle === lo || middle === hi) fail("P-V curve cannot resolve its analytic shape/tangent");
      sample(lo, middle, depth + 1); sample(middle, hi, depth + 1); return;
    }
    points.push(pointAt(hi)); if (points.length > 513) fail("P-V curve exceeds513 analytic vertices");
  }
  for (let i = 0; i < 8; i++) sample(i / 8, (i + 1) / 8, 0);
  const arrow = directedCurveInk(points.map(transform)).arrow;
  if (!arrow || angle({ x: arrow[1].x - arrow[0].x, y: arrow[1].y - arrow[0].y }, derivativeAt(1)) > 0.09) fail("P-V terminal arrow cannot resolve the analytic direction");
  return points;
}
export function validatePvProcessConstruction(construction: SceneConstruction, index: number, document: SceneDocument, issues: SceneIssue[]): void {
  try {
    checkClaims(construction, document);
    evaluatePvProcessConstruction(construction.inputs, document);
  } catch (error) {
    issues.push({ code: "invalid_pv_process", message: error instanceof Error ? error.message : "Invalid P-V process", severity: "fatal", path: `constructions[${index}]`, entityIds: construction.outputs });
  }
}
function checkClaims(construction: SceneConstruction, document: SceneDocument): void {
  const entity = document.entities.find((candidate) => candidate.id === construction.outputs[0]);
  if (construction.outputs.length !== 1 || entity?.kind !== "polyline") fail("pv_process needs one polyline output");
  if (document.constructions.length !== 1 || document.entities.some((candidate) => candidate.id !== entity.id && candidate.kind !== "group")) fail("A P-V scene is one atomic plot; additional geometry/labels cannot add unverified ink");
  if (document.entities.some((candidate) => candidate.label?.trim() || candidate.provenance && Object.keys(candidate.provenance).length || candidate.semantic && Object.keys(candidate.semantic).length)) fail("P-V plot marks and claims are engine-owned; omit entity labels and metadata");
  if (document.annotations.some((annotation) => annotation.kind !== "narration" || annotation.quantityId !== undefined)) fail("P-V plots permit narration annotations only");
}
export function validateEvaluatedPvProcess(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  try {
    checkClaims(construction, document);
    if (outputs.length !== 1 || !record(outputs[0]) || outputs[0].kind !== "pv_plot") fail("P-V plot is missing evaluated authority");
  } catch (error) {
    issues.push({ code: "invalid_pv_process_claim", message: error instanceof Error ? error.message : "Invalid P-V plot claims", severity: "fatal", path: `constructions[${index}].outputs`, entityIds: construction.outputs });
  }
}
