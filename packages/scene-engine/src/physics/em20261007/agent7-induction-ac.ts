import { evaluateAcConstruction, type AcGeometry } from "../../compile/acGeometry";
import { evaluateInductionConstruction } from "../../compile/inductionGeometry";
import type { SceneConstruction, SceneDocument, SceneEntity } from "../../types";
import { agree, construction, entity, finiteInputs, numberContext, positive, sceneDocument, type EmModel } from "./sceneKit";
import type { InputRole, ModelAdmission } from "./admission";

const chapter = "Electromagnetic Induction and Alternating Currents";

function box(model: EmModel, certified: Record<string, number>, constructions: SceneConstruction[], entities: SceneEntity[]) {
  const document = sceneDocument({
    model: model.name, family: model.family, scope: model.scope, assumptions: model.assumptions, certified, entities, constructions,
  });
  // Explicit component constructions/series-combine topology drive apparatus.
  // This is independent of chapter/topic IDs and never selects a physical model.
  const combined = constructions.find((item) => item.operator === "impedance_combine" && item.inputs.mode === "series");
  const sources = combined?.inputs.sources;
  const components = constructions.filter((item) => item.operator === "impedance" && (!Array.isArray(sources) || sources.includes(item.outputs[0])));
  if (components.length && (combined || components.length === 1)) {
    const kinds = components.map((item) => item.inputs.kind === "resistor" ? "R" : item.inputs.kind === "inductor" ? "L" : "C") as Array<"R" | "L" | "C">;
    const ink = new Ink(); seriesInk(ink, kinds, constructions.some((item) => item.operator === "phasor_response"));
    // Place the independently normalized apparatus above the phasor panel.
    for (const item of ink.constructions) {
      for (const key of ["points", "center", "start", "end"]) { const value = item.inputs[key]; if (key === "points" && Array.isArray(value)) item.inputs[key] = value.map((point: Point): Point => [point[0], point[1] + 4]); else if (Array.isArray(value)) item.inputs[key] = [value[0], value[1] + 4]; }
      if (item.operator === "point") item.inputs.y = Number(item.inputs.y) + 4;
    }
    document.entities.push(...ink.entities); document.constructions.push(...ink.constructions.map((item, i) => ({ ...item, id: `apparatus_${i}_${item.id}` })));
    document.requiredEntityIds.push(...ink.entities.map((item) => item.id)); document.revealGroups[0]!.entityIds.push(...ink.entities.map((item) => item.id));
    document.source.terminalTopology = { mode: combined ? "series" : "single component", components: kinds, source: constructions.some((item) => item.operator === "phasor_response"), nodes: Array.from({ length: kinds.length + 1 }, (_, i) => `n${i}`), branches: kinds.map((kind, i) => ({ id: `${kind}${i}`, from: `n${i}`, to: `n${i + 1}` })) };
  }
  return document;
}

function impedance(kind: "resistor" | "inductor" | "capacitor", value: number, frequency: number): Record<string, unknown> {
  return {
    kind, value, unit: kind === "resistor" ? "ohm" : kind === "inductor" ? "H" : "F",
    frequency, frequencyUnit: "rad/s", displayScale: 0.15, origin: [0, 0],
  };
}

type Point = [number, number];
/** Dimensionless presentation geometry; physical sizes never come from ink. */
class Ink {
  entities: SceneEntity[] = [];
  constructions: SceneConstruction[] = [];
  path(id: string, points: Point[], role = id): void {
    this.entities.push(entity(id, "polyline", role));
    this.constructions.push(construction(id, "polyline", { points }, [id]));
  }
  arrow(id: string, start: Point, end: Point, role = id): void {
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-10) return;
    this.entities.push(entity(id, "vector", role));
    this.constructions.push(construction(id, "vector", { start, end }, [id]));
  }
  circle(id: string, center: Point, radius: number, dot = false): void {
    this.entities.push({ ...entity(id, "circle", id), ...(dot ? { provenance: { inkRole: "opaque_dot" } } : {}) });
    this.constructions.push(construction(id, "circle", { center, radius }, [id]));
  }
  label(id: string, at: Point, text: string): void {
    const anchor = `${id}_anchor`;
    this.entities.push({ ...entity(anchor, "point", "label anchor"), provenance: { hideMark: true } }, { ...entity(id, "label", text), label: text });
    this.constructions.push(construction(anchor, "point", { x: at[0], y: at[1] }, [anchor]), construction(id, "label", { target: anchor, text }, [id]));
  }
  coil(id: string, at: Point, width = 2): void {
    this.path(id, Array.from({ length: 81 }, (_, i): Point => [at[0] + width * i / 80, at[1] + 0.22 * Math.sin(i * Math.PI / 10)]), "coil winding");
  }
  normal(id: string, at: Point, sign: number): void {
    if (sign === 0) { this.label(id, at, "B=0"); return; }
    this.circle(id, at, 0.12);
    if (sign > 0) this.circle(`${id}_dot`, at, 0.035, true);
    else { this.path(`${id}_a`, [[at[0] - 0.065, at[1] - 0.065], [at[0] + 0.065, at[1] + 0.065]]); this.path(`${id}_b`, [[at[0] - 0.065, at[1] + 0.065], [at[0] + 0.065, at[1] - 0.065]]); }
    this.label(`${id}_name`, [at[0], at[1] + 0.38], "B");
  }
  finish(model: EmModel, certified: Record<string, number>, metadata: Record<string, unknown> = {}): SceneDocument {
    const doc = box(model, certified, this.constructions, this.entities);
    doc.source = { ...doc.source, ...metadata };
    return doc;
  }
}
function optionalInputs(inputs: Record<string, unknown>, required: readonly string[], optional: readonly string[] = [], groups: readonly (readonly string[])[] = []): Record<string, number> {
  const values = finiteInputs(Object.fromEntries(Object.entries(inputs).filter(([key]) => required.includes(key))), required);
  for (const [key, value] of Object.entries(inputs)) {
    if (required.includes(key)) continue;
    if (!optional.includes(key) || typeof value !== "number" || !Number.isFinite(value)) throw new Error(`unsupported or invalid input ${key}`);
    values[key] = value;
  }
  for (const group of groups) if (group.some((key) => key in values) && !group.every((key) => key in values)) throw new Error(`complete source group required: ${group.join(",")}`);
  return values;
}
function turns(n: number): void { if (!Number.isInteger(n) || n < 1) throw new Error("turns must be a positive integer"); }
function flag(n: number): void { if (n !== 0 && n !== 1) throw new Error("flag must be 0 or 1"); }
function sign(n: number): void { if (Math.abs(n) !== 1) throw new Error("orientation must be +1 or -1"); }
function loopInk(ink: Ink, winding: number, closed: boolean, current?: number): void {
  ink.path("loop", [[-1.5, -1], [-1.5, 1], [1.5, 1], [1.5, -1], [0.3, -1]], "oriented source loop");
  ink.path("return", closed ? [[0.3, -1], [0.2, -0.9], [0.1, -1.1], [0, -0.9], [-0.1, -1.1], [-0.2, -0.9], [-0.3, -1], [-1.5, -1]] : [[-0.3, -1], [-1.5, -1]], closed ? "resistive closed return path" : "open terminal");
  ink.circle("terminalA", [-0.3, -1], 0.055); ink.circle("terminalB", [0.3, -1], 0.055);
  ink.label("termA", [-0.6, -1.35], "A"); ink.label("termB", [0.6, -1.35], "B");
  ink.arrow("winding", [-1, 1.35], [winding > 0 ? -1.9 : -0.1, 1.35], "positive loop traversal");
  ink.label("orientation", [0, 1.75], winding > 0 ? "+CCW" : "+CW");
  if (current !== undefined && current !== 0) ink.arrow("current", [1.8, 0], [1.8, Math.sign(current * winding) * 0.7], "conventional induced current");
}
function seriesInk(ink: Ink, kinds: readonly ("R" | "L" | "C")[], source = true): void {
  const width = kinds.length * 2;
  if (source) { ink.path("returnLeft", [[0, 0], [0, -2], [width / 2 - 0.35, -2]], "source return to A"); ink.path("returnRight", [[width / 2 + 0.35, -2], [width, -2], [width, 0]], "source return to B"); }
  else { ink.path("returnLeft", [[0, 0], [0, -2], [width / 2 - 0.35, -2]], "input terminal A conductor"); ink.path("returnRight", [[width / 2 + 0.35, -2], [width, -2], [width, 0]], "input terminal B conductor"); ink.circle("inputA", [width / 2 - 0.35, -2], 0.04); ink.circle("inputB", [width / 2 + 0.35, -2], 0.04); ink.label("inputNames", [width / 2, -2.7], "input A,B"); }
  for (const [index, kind] of kinds.entries()) {
    const x = index * 2;
    if (kind === "L") ink.coil(`component${index}`, [x, 0]);
    else if (kind === "R") ink.path(`component${index}`, [[x, 0], [x + 0.4, 0], [x + 0.6, 0.2], [x + 0.8, -0.2], [x + 1, 0.2], [x + 1.2, -0.2], [x + 1.4, 0], [x + 2, 0]], "resistor");
    else { ink.path(`component${index}a`, [[x, 0], [x + 0.85, 0], [x + 0.85, -0.3], [x + 0.85, 0.3]], "capacitor terminal A"); ink.path(`component${index}b`, [[x + 1.15, -0.3], [x + 1.15, 0.3], [x + 1.15, 0], [x + 2, 0]], "capacitor terminal B"); }
    ink.label(`componentName${index}`, [x + 1, 0.8], kind);
  }
  if (source) { // Break the return conductor at source terminals, preserving topology.
    ink.circle("source", [width / 2, -2], 0.35); ink.label("sourceName", [width / 2, -2.7], "AC source");
  }
}
const motionalKeys = ["B", "l", "vx", "rodAngle", "closed"];
function motionalScalars(inputs: Record<string, unknown>): Record<string, number> {
  const v = optionalInputs(inputs, motionalKeys, ["R"]); positive(v.l, "l"); flag(v.closed);
  if (Math.abs(Math.sin(v.rodAngle)) < 1e-8) throw new Error("rail separation requires a nonparallel rod");
  const emf = -v.vx * v.B * v.l * Math.sin(v.rodAngle);
  if (v.closed === 0) { if (v.R !== undefined) throw new Error("open rods cannot supply a return resistance"); return { emf }; }
  positive(v.R, "R"); const I = emf / v.R, Fx = I * v.l * v.B * Math.sin(v.rodAngle);
  return { emf, I, Fx, P: I ** 2 * v.R };
}
function motionalInk(model: EmModel, r: Record<string, number>, v: Record<string, number>): SceneDocument {
  const ink = new Ink(), dy = Math.sin(v.rodAngle), dx = Math.cos(v.rodAngle);
  if (Math.abs(dy) < 1e-8) throw new Error("rail separation requires a nonparallel rod");
  const a: Point = [1 - dx, -dy], b: Point = [1 + dx, dy];
  ink.path("lowerRail", [[-2, a[1]], [a[0], a[1]], [3, a[1]]], "lower conducting rail");
  ink.path("upperRail", [[-2, b[1]], [b[0], b[1]], [3, b[1]]], "upper conducting rail");
  ink.path("rod", [a, b], "moving source conductor from A to B"); ink.label("terminalA", [a[0] - 0.3, a[1] - 0.5], "A"); ink.label("terminalB", [b[0] + 0.3, b[1] + 0.5], "B");
  if (v.closed) { ink.path("load", [[-2, a[1]], [-2, -0.35], [-2.15, -0.2], [-1.85, 0], [-2.15, 0.2], [-2, 0.35], [-2, b[1]]], "resistive return"); ink.label("loadName", [-2.6, 0], "R"); }
  else ink.label("open", [-2.5, 0], "open");
  ink.normal("field", [0, 0], v.B); ink.arrow("velocity", [2, 1.8], [2 + Math.sign(v.vx) * 0.9, 1.8], "rod velocity"); ink.label("velocityName", [2.4, 2.2], "v");
  if (r.Fx) { ink.arrow("drag", [2, -1.8], [2 + Math.sign(r.Fx) * 0.9, -1.8], "magnetic drag"); ink.label("dragName", [2.4, -2.2], "Fmag"); }
  if (r.I) { ink.arrow("rodCurrent", [1.4, 0], [1.4 + Math.sign(r.I) * dx * 0.65, Math.sign(r.I) * dy * 0.65], "conventional current along A to B rod reference"); ink.label("currentName", [2, 0.3], "I"); }
  return ink.finish(model, r, { terminalTopology: { rod: { from: "A", to: "B" }, return: v.closed ? { from: "B", to: "A", resistance: v.R } : null }, rodVectorSI: [v.l * dx, v.l * dy, 0], velocitySI: [v.vx, 0, 0], fieldSI: [0, 0, v.B] });
}
const sinusoidKeys = ["Vpeak", "Ipeak", "omega", "voltagePhase", "currentPhase", "time"];
function sinusoidScalars(inputs: Record<string, unknown>): Record<string, number> {
  const v = finiteInputs(inputs, sinusoidKeys); positive(v.omega, "omega"); if (v.Vpeak < 0 || v.Ipeak < 0) throw new Error("peak amplitudes must be nonnegative");
  const phase = v.voltagePhase - v.currentPhase;
  return { Vrms: v.Vpeak / Math.SQRT2, Irms: v.Ipeak / Math.SQRT2, phase, P: v.Vpeak * v.Ipeak * Math.cos(phase) / 2, v: v.Vpeak * Math.sin(v.omega * v.time + v.voltagePhase), i: v.Ipeak * Math.sin(v.omega * v.time + v.currentPhase) };
}
function waveInk(ink: Ink, id: string, phase: number, y: number, amplitude = 0.7): void {
  ink.path(id, Array.from({ length: 97 }, (_, j): Point => [j / 16, y + Math.sin(j * Math.PI / 24 + phase) * amplitude]), `${id}: normalized sinusoid vs phase`);
  ink.path(`${id}_axis`, [[0, y], [6, y]]); ink.label(`${id}_name`, [-0.5, y + 1], id);
  ink.label(`${id}_phaseAxis`, [6.6, y], "omega t");
}
const transientKeys = ["kind", "R", "storage", "V", "initial", "time"];
function transientScalars(inputs: Record<string, unknown>): Record<string, number> {
  const v = finiteInputs(inputs, transientKeys); flag(v.kind); positive(v.R, "R"); positive(v.storage, "storage"); if (v.time < 0) throw new Error("time must be nonnegative");
  const tau = v.kind === 0 ? v.R * v.storage : v.storage / v.R, final = v.kind === 0 ? v.V : v.V / v.R;
  const state = final + (v.initial - final) * Math.exp(-v.time / tau), current = v.kind === 0 ? (v.V - state) / v.R : state;
  return { tau, state, current, stored: v.storage * state ** 2 / 2 };
}
function transientInk(model: EmModel, v: Record<string, number>): SceneDocument {
  const r = transientScalars(v), ink = new Ink(); seriesInk(ink, ["R", v.kind === 0 ? "C" : "L"]);
  const source = ink.entities.find((item) => item.id === "sourceName"); if (source) source.label = "DC step";
  const sourceConstruction = ink.constructions.find((item) => item.id === "sourceName"); if (sourceConstruction) sourceConstruction.inputs.text = "DC step";
  const final = v.kind === 0 ? v.V : v.V / v.R, scale = Math.max(1, Math.abs(final), Math.abs(v.initial));
  ink.path("stateTime", Array.from({ length: 65 }, (_, j): Point => [6 + j / 16, (final + (v.initial - final) * Math.exp(-j / 16)) / scale]), "exponential step response over four time constants");
  ink.label("stateTimeName", [8, -1], v.kind === 0 ? "Vc(t)" : "I(t)");
  return ink.finish(model, r, { terminalTopology: { series: ["source", "R", v.kind === 0 ? "C" : "L"], closed: true }, initialState: v.initial });
}
const rcKeys = ["R", "C", "V", "initialV", "time"], lrKeys = ["R", "L", "V", "initialI", "time"];
function rcValues(inputs: Record<string, unknown>): Record<string, number> { const v = finiteInputs(inputs, rcKeys); return { kind: 0, R: v.R, storage: v.C, V: v.V, initial: v.initialV, time: v.time }; }
function lrValues(inputs: Record<string, unknown>): Record<string, number> { const v = finiteInputs(inputs, lrKeys); return { kind: 1, R: v.R, storage: v.L, V: v.V, initial: v.initialI, time: v.time }; }
const generatorKeys = ["N", "B", "A", "omega", "theta0", "time", "winding", "closed"];
function generatorScalars(inputs: Record<string, unknown>): Record<string, number> {
  const v = optionalInputs(inputs, generatorKeys, ["R"]); turns(v.N); positive(v.A, "A"); sign(v.winding); flag(v.closed);
  if (v.time < 0 || v.omega === 0 || v.B === 0) throw new Error("generator requires a nonzero field and rotation and nonnegative time");
  const angle = v.theta0 + v.omega * v.time, phi = v.winding * v.N * v.B * v.A * Math.cos(angle), emf = v.winding * v.N * v.B * v.A * v.omega * Math.sin(angle);
  const result = { phi, emf, peakEmf: Math.abs(v.N * v.B * v.A * v.omega) };
  if (!v.closed) { if (v.R !== undefined) throw new Error("open generator cannot supply load current"); return result; }
  positive(v.R, "R"); return { ...result, I: emf / v.R, P: emf ** 2 / v.R };
}
function generatorInk(model: EmModel, r: Record<string, number>, v: Record<string, number>): SceneDocument {
  const ink = new Ink(), angle = (v.theta0 ?? 0) + v.omega * (v.time ?? 0);
  const corners: Point[] = [[-0.2, -0.7], [-1, -0.7], [-1, 0.7], [1, 0.7], [1, -0.7], [0.2, -0.7]];
  // Rotation about world +x; projection maps z to (+0.35,+0.2).
  const projected = corners.map(([x, y]): Point => [x + 0.35 * y * Math.sin(angle), y * (Math.cos(angle) + 0.2 * Math.sin(angle))]);
  ink.path("rotatingCoil", projected, "projection of rotating source coil with two terminal ends");
  ink.path("shaft", [[-1.6, 0], [2.2, 0]], "rotation axis"); ink.label("shaftName", [0, 1.5], "rotation axis");
  ink.circle("slipRingA", [2.5, 0], 0.2); ink.circle("slipRingB", [3.2, 0], 0.2);
  ink.path("coilLeadA", [projected[0]!, [2.5, -0.7], [2.5, -0.2]], "coil terminal to continuous ring A");
  ink.path("coilLeadB", [projected[projected.length - 1]!, [3.2, 0.7], [3.2, 0.2]], "coil terminal to continuous ring B");
  ink.path("brushA", [[2.5, -0.2], [2.5, -1.4], [4, -1.4]], "stationary brush A"); ink.path("brushB", [[3.2, 0.2], [3.2, 1.4], [4, 1.4]], "stationary brush B");
  ink.label("terminalAName", [4.2, -1.4], "A"); ink.label("terminalBName", [4.2, 1.4], "B");
  ink.label("ringName", [3, -2], "slip rings"); ink.label("brushName", [4.5, 2], "brushes A,B");
  if (v.closed) { ink.path("load", [[4, -1.4], [4, -0.3], [4.15, -0.1], [3.85, 0.1], [4, 0.3], [4, 1.4]], "resistive generator load"); ink.label("loadName", [4.7, 0], "R"); }
  ink.normal("field", [-2.2, 0], v.B); waveInk(ink, "emf(t)", (v.theta0 ?? 0) + ((v.winding ?? 1) * v.B * v.omega < 0 ? Math.PI : 0), -4);
  const winding = v.winding ?? 1;
  return ink.finish(model, r, { generator: { axisWorld: [1, 0, 0], areaNormalWorld: [0, -Math.sin(angle), Math.cos(angle)], fieldWorld: [0, 0, v.B], rings: ["A", "B"], brushes: ["A", "B"], continuousRingContacts: true }, terminalTopology: { closed: v.closed === 1, load: v.R, emfReference: winding > 0 ? { positive: "A", negative: "B" } : { positive: "B", negative: "A" } }, winding });
}
const transformerKeys = ["Np", "Ns", "Vp", "frequency", "dotP", "dotS", "load"];
function transformerScalars(inputs: Record<string, unknown>): Record<string, number> {
  const v = optionalInputs(inputs, transformerKeys, ["coreLoss", "copperLoss"], [["coreLoss", "copperLoss"]]); turns(v.Np); turns(v.Ns); sign(v.dotP); sign(v.dotS); positive(v.frequency, "AC frequency"); positive(v.Vp, "Vp RMS"); positive(v.load, "load");
  if ((v.coreLoss ?? 0) < 0 || (v.copperLoss ?? 0) < 0) throw new Error("source losses must be nonnegative");
  const Vs = v.dotP * v.dotS * v.Vp * v.Ns / v.Np, Is = Math.abs(Vs) / v.load, Pout = Vs ** 2 / v.load, Pin = Pout + (v.coreLoss ?? 0) + (v.copperLoss ?? 0);
  return { Vs, Is, Pout, Pin, Ip: Pin / v.Vp, efficiency: Pout / Pin };
}
function transformerInk(model: EmModel, r: Record<string, number>, dots?: [number, number], load = false): SceneDocument {
  const ink = new Ink(); ink.path("coreOuter", [[-2.2, -1.8], [2.2, -1.8], [2.2, 1.8], [-2.2, 1.8], [-2.2, -1.8]], "closed magnetic core"); ink.path("coreInner", [[-1.7, -1.3], [1.7, -1.3], [1.7, 1.3], [-1.7, 1.3], [-1.7, -1.3]], "magnetic core inner boundary");
  ink.path("primary", Array.from({ length: 81 }, (_, i): Point => [-2 + 0.4 * Math.sin(i * Math.PI / 10), -1 + i / 40]), "primary winding");
  ink.path("secondary", Array.from({ length: 81 }, (_, i): Point => [2 + 0.4 * Math.sin(i * Math.PI / 10), -1 + i / 40]), "secondary winding");
  ink.path("primaryLeadA", [[-2, 1], [-3.3, 1], [-3.3, 0.3]]); ink.path("primaryLeadB", [[-2, -1], [-3.3, -1], [-3.3, -0.3]]); ink.circle("ACsource", [-3.3, 0], 0.3);
  ink.path("secondaryA", [[2, 1], [3.3, 1]]); ink.path("secondaryB", [[2, -1], [3.3, -1]]);
  if (load) { ink.path("load", [[3.3, 1], [3.3, 0.3], [3.45, 0.1], [3.15, -0.1], [3.3, -0.3], [3.3, -1]], "secondary resistive load"); ink.label("loadName", [4, 0], "load R"); }
  ink.label("pname", [-3, -1.7], "Np, Vp"); ink.label("sname", [3, -1.7], "Ns, Vs"); ink.label("coreName", [0, 2.4], "magnetic core");
  if (dots) { ink.circle("primaryDot", [-2.6, dots[0] > 0 ? 1 : -1], 0.045, true); ink.circle("secondaryDot", [2.6, dots[1] > 0 ? 1 : -1], 0.045, true); }
  return ink.finish(model, r, { dotConvention: dots, terminalTopology: { primary: ["PA", "PB"], secondary: ["SA", "SB"], electricallyIsolated: true, secondaryLoad: load }, lossConvention: "source-stated power budget; ideal induced-voltage ratio retained; input current is active RMS at declared unity input power factor" });
}
const responseKeys = ["V", "R", "L", "C", "omega", "phase", "series"];
const scanKeys = ["scanMin", "scanMax", "scanCount"];
function responseScalars(inputs: Record<string, unknown>): Record<string, number> {
  const v = optionalInputs(inputs, responseKeys, scanKeys, [scanKeys]); positive(v.V, "V RMS"); positive(v.C, "C"); positive(v.omega, "omega");
  if (v.series !== 1 || v.R < 0 || v.L < 0) throw new Error("requires explicit series connection and passive components");
  if (v.scanCount !== undefined && (!Number.isInteger(v.scanCount) || v.scanCount < 3 || v.scanCount > 129 || v.scanMin <= 0 || v.scanMax <= v.scanMin)) throw new Error("frequency scan requires positive ordered interval and 3..129 samples");
  if (v.scanCount !== undefined && v.R === 0 && v.L > 0) {
    const singularFrequency = 1 / Math.sqrt(v.L * v.C);
    if (v.scanMin <= singularFrequency && singularFrequency <= v.scanMax) throw new Error("frequency scan interval contains singular ideal resonance");
  }
  const XL = v.omega * v.L, XC = 1 / (v.omega * v.C), X = XL - XC, Z = Math.hypot(v.R, X);
  if (Z === 0) throw new Error("ideal zero-impedance resonance has no finite steady current");
  const realV = v.V * Math.cos(v.phase), imagV = v.V * Math.sin(v.phase), denom = Z ** 2;
  const Ireal = (realV * v.R + imagV * X) / denom, Iimag = (imagV * v.R - realV * X) / denom, I = v.V / Z;
  return { XL, XC, Zreal: v.R, Zimag: X, Z, Ireal, Iimag, I, lag: Math.atan2(X, v.R), P: I ** 2 * v.R, Q: I ** 2 * X, VR: I * v.R, VL: I * XL, VC: I * XC };
}
function responseInk(model: EmModel, r: Record<string, number>, v: Record<string, number>): SceneDocument {
  const cons = [construction("zr", "impedance", { ...impedance("resistor", v.R, v.omega), origin: [4, 0] }, ["zr"]), construction("zl", "impedance", { ...impedance("inductor", v.L, v.omega), origin: [4, 1] }, ["zl"]), construction("zc", "impedance", { ...impedance("capacitor", v.C, v.omega), origin: [4, -1] }, ["zc"]), construction("z", "impedance_combine", { sources: ["zr", "zl", "zc"], mode: "series", displayScale: 0.15, origin: [6, 0] }, ["z"]), construction("response", "phasor_response", { voltage: { real: v.V * Math.cos(v.phase), imaginary: v.V * Math.sin(v.phase) }, voltageUnit: "V", convention: "rms", impedance: "z", voltageScale: 0.08, currentScale: 0.4, origin: [0, 0] }, ["voltage", "current"])];
  const doc = box(model, r, cons, [entity("zr", "vector", "R"), entity("zl", "vector", "XL"), entity("zc", "vector", "XC"), entity("z", "vector", "Z"), entity("voltage", "vector", "V RMS"), entity("current", "vector", "I RMS")]);
  if (v.scanCount !== undefined) {
    const samples = Array.from({ length: v.scanCount }, (_, i) => { const omega = v.scanMin + (v.scanMax - v.scanMin) * i / (v.scanCount - 1), Z = Math.hypot(v.R, omega * v.L - 1 / (omega * v.C)); if (Z === 0) throw new Error("scan crosses singular ideal resonance"); return { omega, I: v.V / Z }; });
    const peak = Math.max(...samples.map((item) => item.I)), ink = new Ink(); ink.path("frequencyResponse", samples.map((sample, i): Point => [i * 6 / (samples.length - 1), -3 + sample.I / peak]), "current versus supplied angular-frequency interval"); ink.label("scanName", [3, -4], "I vs omega");
    doc.entities.push(...ink.entities); doc.constructions.push(...ink.constructions.map((item, i) => ({ ...item, id: `scan_${i}_${item.id}` }))); doc.requiredEntityIds.push(...ink.entities.map((item) => item.id)); doc.revealGroups[0]!.entityIds.push(...ink.entities.map((item) => item.id)); doc.source.frequencySamples = samples;
  }
  return doc;
}
function stateCoil(model: EmModel, certified: Record<string, number>, mutual = false, dots?: [number, number]): SceneDocument {
  const ink = new Ink(); ink.coil("coil1", [-2, 0]); ink.label("name1", [-1, 0.7], mutual ? "L1" : "L");
  ink.path("lead1a", [[-2.7, 0], [-2, 0]]); ink.path("lead1b", [[0, 0], [0.7, 0]]);
  if (mutual) { ink.coil("coil2", [-2, -1.6]); ink.label("name2", [-1, -2.1], "L2"); ink.path("lead2a", [[-2.7, -1.6], [-2, -1.6]]); ink.path("lead2b", [[0, -1.6], [0.7, -1.6]]); if (dots) { ink.circle("dot1", [dots[0] > 0 ? -2.2 : 0.2, 0.2], 0.045, true); ink.circle("dot2", [dots[1] > 0 ? -2.2 : 0.2, -1.4], 0.045, true); } ink.label("coupling", [-1, -0.8], dots ? "signed M" : "magnitude M"); }
  return ink.finish(model, certified, { dotConvention: mutual ? dots : undefined });
}

export const inductionAcModels: EmModel[] = [
  {
    name: "ind.faraday",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Uniform affine flux. Ordinary case: Bz = 2 + 3 t, area fixed at 4 along z, one turn. Phi(1) = 20 and emf = -12. The sign is Lenz's law for this declared rate. The figure labels the sampled field direction along the page normal: out of the page when Bz(t) > 0, into the page when Bz(t) < 0, and a zero sampled field is rejected because it has no direction to draw.",
    topics: [
      { topicId: "physics|14|faradays-law", packet: "CH-09a", chapter, remaining: "A non-affine field or a changing loop shape needs its own flux_process inputs." },
      { topicId: "physics|14|induced-emf-current-and-lenz-law", packet: "CH-09a", chapter, remaining: "The induced current still needs a declared resistance; this model certifies emf, not a guessed current." },
    ],
    keys: ["Bz0", "dBz", "area", "turns", "time"],
    ordinary: { Bz0: 2, dBz: 3, area: 4, turns: 1, time: 1 },
    altered: { Bz0: 1, dBz: 2, area: 4, turns: 1, time: 1 },
    rejections: [{ Bz0: 2, dBz: 3, area: 0, turns: 1, time: 1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.area, "area");
      if (!Number.isInteger(v.turns) || v.turns < 1) throw new Error("turns must be a positive integer");
      if (!(v.time > 0) || !(v.time < 2)) throw new Error("the sample time must lie strictly inside 0..2 s");
      const sampledField = v.Bz0 + v.dBz * v.time;
      if (sampledField === 0) throw new Error("the field-direction label requires a nonzero sampled field");
      const phi = v.turns * sampledField * v.area;
      const emf = -v.turns * v.dBz * v.area;
      const fluxInputs = {
        model: "uniform_affine", B0: [0, 0, v.Bz0], fieldRate: [0, 0, v.dBz], areaVector: [0, 0, v.area], areaRate: [0, 0, 0],
        turns: v.turns, tMin: 0, tMax: 2, units: { field: "T", area: "m^2", time: "s" }, samples: 17,
      };
      const process = evaluateInductionConstruction("flux_process", fluxInputs, numberContext)[0];
      const state = evaluateInductionConstruction("induction_state", { process: "curve", time: v.time }, {
        ...numberContext,
        geometry(id) { return id === "curve" ? process : undefined; },
      });
      const fluxState = state[0] && "inductionState" in state[0] ? state[0].inductionState : undefined;
      if (!fluxState) throw new Error("induction state is missing");
      agree(fluxState.fluxSI, phi, "phi");
      agree(fluxState.emfSI, emf, "emf");
      const outOfPage = sampledField > 0;
      const fieldMarker = outOfPage ? "⊙" : "⊗";
      const document = box(this, { phi, emf }, [
        construction("curve", "flux_process", fluxInputs, ["curve"]),
        construction("state", "induction_state", { process: "curve", time: v.time }, ["flux", "emf"]),
        construction("fieldAnchor", "point", { x: -1.1, y: phi }, ["fieldAnchor"]),
        construction("field", "label", { target: "fieldAnchor", text: "B" }, ["field"]),
        construction("fieldNormalAnchor", "point", { x: -1.1, y: phi - 3 }, ["fieldNormalAnchor"]),
        construction("fieldNormal", "label", { target: "fieldNormalAnchor", text: fieldMarker }, ["fieldNormal"]),
      ], [
        entity("curve", "polyline", "flux"),
        entity("flux", "point", "flux state"),
        entity("emf", "label", "emf state"),
        entity("fieldAnchor", "point", "field direction anchor helper"),
        { ...entity("field", "label", "field direction"), label: "B", provenance: { pinLabel: true } },
        entity("fieldNormalAnchor", "point", "field page-normal anchor helper"),
        { ...entity("fieldNormal", "label", outOfPage ? "field out of the page" : "field into the page"), label: fieldMarker, provenance: { pinLabel: true } },
      ]);
      const helperIds = new Set(["fieldAnchor", "fieldNormalAnchor"]);
      document.requiredEntityIds = document.requiredEntityIds.filter((id) => !helperIds.has(id));
      document.revealGroups = document.revealGroups.map((group) => ({
        ...group, entityIds: group.entityIds.filter((id) => !helperIds.has(id)),
      }));
      return document;
    },
  },
  {
    name: "ind.motional",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Rod perpendicular to a uniform field and to its velocity. emf = B l v. A supplied angle would be a different model and is not assumed.",
    topics: [{ topicId: "physics|14|motional-emf", packet: "CH-09a", chapter, remaining: "A rod that is not perpendicular needs an explicit angle and is rejected here." }],
    keys: ["B", "l", "v", "perpendicular"],
    ordinary: { B: 2, l: 3, v: 4, perpendicular: 1 },
    altered: { B: 2, l: 3, v: 5, perpendicular: 1 },
    rejections: [{ B: 2, l: 3, v: 4, perpendicular: 0 }, { B: 2, l: 0, v: 4, perpendicular: 1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.B, "B");
      positive(v.l, "l");
      if (v.v < 0) throw new Error("speed must be nonnegative");
      if (v.perpendicular !== 1) throw new Error("motional emf here requires a perpendicular rod, field, and velocity");
      return motionalInk(this, { emf: v.B * v.l * v.v }, { B: v.B, l: v.l, vx: v.v, rodAngle: -Math.PI / 2, closed: 0 });
    },
  },
  {
    name: "ind.eddy",
    family: "circuit_network",
    scope: "qualitative",
    assumptions: "Eddy currents are indicated only. No loss, frequency, or drag number is certified.",
    topics: [{ topicId: "physics|14|eddy-currents-and-inductance", packet: "CH-09a", chapter, remaining: "A dissipation number has to be supplied. Self-inductance is the separate solved model." }],
    keys: ["shown"],
    ordinary: { shown: 1 },
    altered: { shown: 1 },
    rejections: [{ shown: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      if (v.shown !== 1) throw new Error("the eddy schematic requires the explicit shown flag");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: {},
        entities: [entity("plate", "polygon", "conducting plate")],
        constructions: [construction("plate", "rectangle", { center: { x: 0, y: 0 }, width: 2, height: 1.2 }, ["plate"])],
      });
    },
  },
  {
    name: "ind.self",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Long solenoid self-inductance L = mu0 n^2 A length. mu0 is explicit. End effects are neglected.",
    topics: [{ topicId: "physics|14|self-inductance", packet: "CH-09b", chapter, remaining: "A short coil with a measured geometry factor is unsupported." }],
    keys: ["mu0", "n", "A", "length"],
    ordinary: { mu0: 2, n: 3, A: 4, length: 5 },
    altered: { mu0: 2, n: 3, A: 4, length: 2 },
    rejections: [{ mu0: 2, n: 3, A: 0, length: 5 }],
    build(inputs) {
      const v = optionalInputs(inputs, this.keys, ["geometryFactor", "muR"]);
      positive(v.mu0, "mu0");
      positive(v.n, "n");
      positive(v.A, "A");
      positive(v.length, "length");
      const geometryFactor = positive(v.geometryFactor ?? 1, "geometryFactor"), muR = positive(v.muR ?? 1, "muR");
      return stateCoil(this, { L: v.mu0 * muR * v.n * v.n * v.A * v.length * geometryFactor });
    },
  },
  {
    name: "ind.mutual",
    family: "circuit_network",
    scope: "solved",
    assumptions: "M = k sqrt(L1 L2). The coupling coefficient is an explicit input and is not invented.",
    topics: [{ topicId: "physics|14|mutual-inductance", packet: "CH-09b", chapter, remaining: "A geometry-derived mutual inductance without k or a flux linkage is unsupported." }],
    keys: ["L1", "L2", "k"],
    ordinary: { L1: 4, L2: 9, k: 0.5 },
    altered: { L1: 4, L2: 9, k: 1 },
    rejections: [{ L1: 4, L2: 9, k: 1.2 }, { L1: 0, L2: 9, k: 0.5 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.L1, "L1");
      positive(v.L2, "L2");
      if (v.k < 0 || v.k > 1) throw new Error("coupling must lie on 0..1");
      return stateCoil(this, { M: v.k * Math.sqrt(v.L1 * v.L2) }, true);
    },
  },
  {
    name: "ind.lc",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Ideal LC. omega = 1/sqrt(L C). Instantaneous energy is Q^2/(2C) + L I^2/2 for the supplied simultaneous charge and current.",
    topics: [{ topicId: "physics|14|lc-oscillations", packet: "CH-09b", chapter, remaining: "A damped RLC ring-down is not this ideal LC state." }],
    keys: ["L", "C", "Q", "I"],
    ordinary: { L: 4, C: 0.25, Q: 2, I: 0 },
    altered: { L: 4, C: 0.25, Q: 0, I: 4 },
    rejections: [{ L: 4, C: 0, Q: 2, I: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.L, "L");
      positive(v.C, "C");
      return lcInk(this, { omega: 1 / Math.sqrt(v.L * v.C), U: v.Q * v.Q / (2 * v.C) + v.L * v.I * v.I / 2 }, { Q0: v.Q, I0: v.I });
    },
  },
  {
    name: "ind.resistor",
    family: "circuit_network",
    scope: "solved",
    assumptions: "AC resistor. Impedance is the resistance at the explicit angular frequency. No phase is invented beyond zero.",
    topics: [{ topicId: "physics|14|alternating-current-basics", packet: "CH-09c", chapter, remaining: "A nonsinusoidal source is unsupported." }],
    keys: ["R", "omega"],
    ordinary: { R: 5, omega: 4 },
    altered: { R: 7, omega: 4 },
    rejections: [{ R: -1, omega: 4 }, { R: 5, omega: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      if (v.R < 0) throw new Error("resistance must be nonnegative");
      positive(v.omega, "omega");
      const drawn = evaluateAcConstruction("impedance", impedance("resistor", v.R, v.omega), numberContext);
      const Z = drawn[0]?.acImpedance?.components;
      if (!Z) throw new Error("resistor impedance is missing");
      agree(Z.real, v.R, "R");
      agree(Z.imaginary, 0, "X");
      return box(this, { Z: v.R }, [
        construction("z", "impedance", impedance("resistor", v.R, v.omega), ["z"]),
      ], [entity("z", "vector", "impedance")]);
    },
  },
  {
    name: "ind.reactance",
    family: "circuit_network",
    scope: "solved",
    assumptions: "XL = omega L and XC = 1/(omega C) at one explicit angular frequency.",
    topics: [{ topicId: "physics|14|inductive-and-capacitive-reactance", packet: "CH-09c", chapter, remaining: "A frequency in hertz must be converted by the caller before this radian model." }],
    keys: ["omega", "L", "C"],
    ordinary: { omega: 4, L: 2, C: 0.25 },
    altered: { omega: 2, L: 2, C: 0.25 },
    rejections: [{ omega: 4, L: 2, C: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.omega, "omega");
      if (v.L < 0) throw new Error("inductance must be nonnegative");
      positive(v.C, "C");
      const XL = v.omega * v.L;
      const XC = 1 / (v.omega * v.C);
      const inductor = evaluateAcConstruction("impedance", impedance("inductor", v.L, v.omega), numberContext);
      const capacitor = evaluateAcConstruction("impedance", impedance("capacitor", v.C, v.omega), numberContext);
      agree(inductor[0]?.acImpedance?.components.imaginary ?? NaN, XL, "XL");
      agree(capacitor[0]?.acImpedance?.components.imaginary ?? NaN, -XC, "XC");
      return box(this, { XL, XC }, [
        construction("zl", "impedance", impedance("inductor", v.L, v.omega), ["zl"]),
        construction("zc", "impedance", { ...impedance("capacitor", v.C, v.omega), origin: [0, -1.5] }, ["zc"]),
      ], [entity("zl", "vector", "inductive reactance"), entity("zc", "vector", "capacitive reactance")]);
    },
  },
  {
    name: "ind.lcr",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Series LCR at one angular frequency. Z = R + j(XL - XC). Ordinary values are R=3, XL=8, XC=4, so Z = 3+4j and |Z|=5.",
    topics: [{ topicId: "physics|14|reactance-impedance-and-lcr", packet: "CH-09c", chapter, remaining: "A parallel LCR network is not this series model." }],
    keys: ["R", "L", "C", "omega"],
    ordinary: { R: 3, L: 2, C: 0.0625, omega: 4 },
    altered: { R: 8, L: 2, C: 0.0625, omega: 4 },
    rejections: [{ R: 3, L: 2, C: 0, omega: 4 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      if (v.R < 0 || v.L < 0) throw new Error("R and L must be nonnegative");
      positive(v.C, "C");
      positive(v.omega, "omega");
      const X = v.omega * v.L - 1 / (v.omega * v.C);
      const magnitude = Math.hypot(v.R, X);
      const geometries = new Map<string, AcGeometry>();
      const context = { ...numberContext, geometry: (id: unknown) => geometries.get(String(id)) };
      for (const [id, kind, value] of [["zr", "resistor", v.R], ["zl", "inductor", v.L], ["zc", "capacitor", v.C]] as const) {
        geometries.set(id, evaluateAcConstruction("impedance", impedance(kind, value, v.omega), context)[0]!);
      }
      const combined = evaluateAcConstruction("impedance_combine", { sources: ["zr", "zl", "zc"], mode: "series", displayScale: 0.15, origin: [2, 0] }, context)[0];
      agree(combined?.acImpedance?.components.real ?? NaN, v.R, "Zr");
      agree(combined?.acImpedance?.components.imaginary ?? NaN, X, "Zi");
      return box(this, { X, Z: magnitude }, [
        construction("zr", "impedance", impedance("resistor", v.R, v.omega), ["zr"]),
        construction("zl", "impedance", { ...impedance("inductor", v.L, v.omega), origin: [0, 1.2] }, ["zl"]),
        construction("zc", "impedance", { ...impedance("capacitor", v.C, v.omega), origin: [0, -1.2] }, ["zc"]),
        construction("zeq", "impedance_combine", { sources: ["zr", "zl", "zc"], mode: "series", displayScale: 0.15, origin: [2, 0] }, ["zeq"]),
      ], [entity("zr", "vector", "R"), entity("zl", "vector", "XL"), entity("zc", "vector", "XC"), entity("zeq", "vector", "series Z")]);
    },
  },
  {
    name: "ind.phasor",
    family: "circuit_network",
    scope: "solved",
    assumptions: "RMS phasor. Ordinary source is 10 V at phase zero through series Z = 3+4j. Current is 1.2-1.6j, magnitude 2, average power 12, power factor 0.6.",
    topics: [{ topicId: "physics|14|power-in-ac-circuits-and-wattless-current", packet: "CH-09c", chapter, remaining: "A non-RMS convention is rejected. Wattless current is ind.wattless." }],
    keys: ["V", "R", "L", "C", "omega"],
    ordinary: { V: 10, R: 3, L: 2, C: 0.0625, omega: 4 },
    altered: { V: 5, R: 3, L: 2, C: 0.0625, omega: 4 },
    rejections: [{ V: 10, R: 3, L: 2, C: 0, omega: 4 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.V, "V");
      if (v.R < 0 || v.L < 0) throw new Error("R and L must be nonnegative");
      positive(v.C, "C");
      positive(v.omega, "omega");
      const X = v.omega * v.L - 1 / (v.omega * v.C);
      const denom = v.R * v.R + X * X;
      const Ireal = v.V * v.R / denom;
      const Iimag = -v.V * X / denom;
      const Imag = Math.hypot(Ireal, Iimag);
      const P = Imag * Imag * v.R;
      const geometries = new Map<string, AcGeometry>();
      const context = { ...numberContext, geometry: (id: unknown) => geometries.get(String(id)) };
      geometries.set("zeq", evaluateAcConstruction("impedance", impedance("resistor", v.R, v.omega), context)[0]!);
      const inductor = evaluateAcConstruction("impedance", impedance("inductor", v.L, v.omega), context)[0]!;
      const capacitor = evaluateAcConstruction("impedance", impedance("capacitor", v.C, v.omega), context)[0]!;
      geometries.set("zl", inductor);
      geometries.set("zc", capacitor);
      geometries.set("z", evaluateAcConstruction("impedance_combine", { sources: ["zeq", "zl", "zc"], mode: "series", displayScale: 0.15 }, context)[0]!);
      const phasor = evaluateAcConstruction("phasor_response", {
        voltage: { real: v.V, imaginary: 0 }, voltageUnit: "V", convention: "rms", impedance: "z",
        voltageScale: 0.08, currentScale: 0.4, origin: [0, 0],
      }, context);
      const response = phasor[0]?.acPhasor?.response;
      if (!response) throw new Error("phasor response is missing");
      agree(response.current.real, Ireal, "Ireal");
      agree(response.current.imaginary, Iimag, "Iimag");
      agree(response.realPower, P, "P");
      return box(this, { Ireal, Iimag, I: Imag, P, powerFactor: P === 0 ? 0 : v.R / Math.hypot(v.R, X) }, [
        construction("zr", "impedance", impedance("resistor", v.R, v.omega), ["zr"]),
        construction("zl", "impedance", { ...impedance("inductor", v.L, v.omega), origin: [0, 1] }, ["zl"]),
        construction("zc", "impedance", { ...impedance("capacitor", v.C, v.omega), origin: [0, -1] }, ["zc"]),
        construction("z", "impedance_combine", { sources: ["zr", "zl", "zc"], mode: "series", displayScale: 0.15, origin: [2, 0] }, ["z"]),
        construction("phasor", "phasor_response", {
          voltage: { real: v.V, imaginary: 0 }, voltageUnit: "V", convention: "rms", impedance: "z",
          voltageScale: 0.08, currentScale: 0.4, origin: [4, 0],
        }, ["voltage", "current"]),
      ], [entity("zr", "vector", "R"), entity("zl", "vector", "XL"), entity("zc", "vector", "XC"), entity("z", "vector", "Z"), entity("voltage", "vector", "voltage"), entity("current", "vector", "current")]);
    },
  },
  {
    name: "ind.resonance",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Series resonance omega = 1/sqrt(L C). At that frequency Z = R. The ordinary L=4 and C=0.25 give omega = 1.",
    topics: [{ topicId: "physics|14|resonance-power-and-wattless-current", packet: "CH-09c", chapter, remaining: "A loaded parallel resonance is not this series zero-reactance case." }],
    keys: ["R", "L", "C"],
    ordinary: { R: 5, L: 4, C: 0.25 },
    altered: { R: 8, L: 4, C: 0.25 },
    rejections: [{ R: 5, L: 0, C: 0.25 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.R, "R");
      positive(v.L, "L");
      positive(v.C, "C");
      const omega = 1 / Math.sqrt(v.L * v.C);
      const geometries = new Map<string, AcGeometry>();
      const context = { ...numberContext, geometry: (id: unknown) => geometries.get(String(id)) };
      for (const [id, kind, value] of [["zr", "resistor", v.R], ["zl", "inductor", v.L], ["zc", "capacitor", v.C]] as const) {
        geometries.set(id, evaluateAcConstruction("impedance", impedance(kind, value, omega), context)[0]!);
      }
      const combined = evaluateAcConstruction("impedance_combine", { sources: ["zr", "zl", "zc"], mode: "series", displayScale: 0.15 }, context)[0];
      agree(combined?.acImpedance?.components.imaginary ?? NaN, 0, "X");
      agree(combined?.acImpedance?.components.real ?? NaN, v.R, "Z");
      return box(this, { omega, Z: v.R }, [
        construction("zr", "impedance", impedance("resistor", v.R, omega), ["zr"]),
        construction("zl", "impedance", { ...impedance("inductor", v.L, omega), origin: [0, 1] }, ["zl"]),
        construction("zc", "impedance", { ...impedance("capacitor", v.C, omega), origin: [0, -1] }, ["zc"]),
        construction("z", "impedance_combine", { sources: ["zr", "zl", "zc"], mode: "series", displayScale: 0.15, origin: [2, 0] }, ["z"]),
      ], [entity("zr", "vector", "R"), entity("zl", "vector", "XL"), entity("zc", "vector", "XC"), entity("z", "vector", "Z")]);
    },
  },
  {
    name: "ind.wattless",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Pure inductor, RMS voltage, zero resistance. Average power is zero. This is the wattless case, not a resistive phasor.",
    topics: [{ topicId: "physics|14|resonance-power-and-wattless-current", packet: "CH-09c", chapter, remaining: "A partly resistive circuit is ind.phasor, where power is not zero." }],
    keys: ["V", "L", "omega"],
    ordinary: { V: 10, L: 2, omega: 4 },
    altered: { V: 10, L: 4, omega: 4 },
    rejections: [{ V: 10, L: 0, omega: 4 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.V, "V");
      positive(v.L, "L");
      positive(v.omega, "omega");
      const XL = v.omega * v.L;
      const geometries = new Map<string, AcGeometry>();
      const context = { ...numberContext, geometry: (id: unknown) => geometries.get(String(id)) };
      geometries.set("z", evaluateAcConstruction("impedance", impedance("inductor", v.L, v.omega), context)[0]!);
      const phasor = evaluateAcConstruction("phasor_response", {
        voltage: { real: v.V, imaginary: 0 }, voltageUnit: "V", convention: "rms", impedance: "z",
        voltageScale: 0.08, currentScale: 0.4,
      }, context);
      agree(phasor[0]?.acPhasor?.response.realPower ?? NaN, 0, "P");
      return box(this, { XL, I: v.V / XL, P: 0 }, [
        construction("z", "impedance", impedance("inductor", v.L, v.omega), ["z"]),
        construction("phasor", "phasor_response", {
          voltage: { real: v.V, imaginary: 0 }, voltageUnit: "V", convention: "rms", impedance: "z",
          voltageScale: 0.08, currentScale: 0.4, origin: [2, 0],
        }, ["voltage", "current"]),
      ], [entity("z", "vector", "reactance"), entity("voltage", "vector", "voltage"), entity("current", "vector", "current")]);
    },
  },
  {
    name: "ind.generator",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Declared rotating loop. Peak emf = N B A omega. This is not a drawing of an unnamed machine.",
    topics: [{ topicId: "physics|14|ac-generator-and-transformer", packet: "CH-09c", chapter, remaining: "The transformer half of this row is ind.transformer. A commutator DC machine is unsupported." }],
    keys: ["N", "B", "A", "omega"],
    ordinary: { N: 2, B: 3, A: 4, omega: 5 },
    altered: { N: 2, B: 3, A: 4, omega: 2 },
    rejections: [{ N: 0, B: 3, A: 4, omega: 5 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.N, "N");
      positive(v.B, "B");
      positive(v.A, "A");
      positive(v.omega, "omega");
      if (!Number.isInteger(v.N)) throw new Error("turns must be an integer");
      return generatorInk(this, { peakEmf: v.N * v.B * v.A * v.omega }, v);
    },
  },
  {
    name: "ind.transformer",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Ideal transformer. Vs / Vp = Ns / Np and Ip Vp = Is Vs. A claimed secondary that breaks either identity is rejected. Ns is required.",
    topics: [
      { topicId: "physics|14|transformer", packet: "CH-09c", chapter, remaining: "Core loss, leakage, and a non-ideal regulation are unsupported." },
      { topicId: "physics|14|ac-generator-and-transformer", packet: "CH-09c", chapter, remaining: "The generator half is ind.generator." },
    ],
    keys: ["Np", "Ns", "Vp", "Ip", "claimedVs", "claimedIs"],
    ordinary: { Np: 10, Ns: 2, Vp: 100, Ip: 1, claimedVs: 20, claimedIs: 5 },
    altered: { Np: 10, Ns: 5, Vp: 100, Ip: 1, claimedVs: 50, claimedIs: 2 },
    rejections: [{ Np: 10, Ns: 2, Vp: 100, Ip: 1, claimedVs: 21, claimedIs: 5 }, { Np: 10, Ns: 0, Vp: 100, Ip: 1, claimedVs: 0, claimedIs: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.Np, "Np");
      positive(v.Ns, "Ns");
      turns(v.Np); turns(v.Ns);
      positive(v.Vp, "Vp");
      if (v.Ip < 0) throw new Error("primary current must be nonnegative");
      const Vs = v.Vp * v.Ns / v.Np;
      const Is = v.Ip * v.Np / v.Ns;
      if (v.claimedVs !== Vs || v.claimedIs !== Is) throw new Error("claimed secondary values break the ideal transformer identities");
      return transformerInk(this, { Vs, Is });
    },
  },
];

function extension(name: string, topic: string, keys: string[], ordinary: Record<string, number>, altered: Record<string, number>, rejections: Record<string, number>[], assumptions: string, build: (this: EmModel, inputs: Record<string, unknown>) => SceneDocument, scope: EmModel["scope"] = "solved"): EmModel {
  return { name, family: "circuit_network", scope, assumptions, topics: [{ topicId: `physics|14|${topic}`, packet: topic.includes("current") || topic.includes("faraday") ? "CH-09a" : "CH-09b", chapter, remaining: "Shared source/planner/runtime/persistence and independent acceptance pending." }], keys, ordinary, altered, rejections, build };
}

const fluxKeys = ["B0", "dB", "ddB", "A0", "dA", "theta0", "omega", "N", "winding", "time", "closed"];
function fluxScalars(inputs: Record<string, unknown>): Record<string, number> {
  const v = optionalInputs(inputs, fluxKeys, ["R"]); turns(v.N); sign(v.winding); flag(v.closed);
  if (v.time < 0 || Math.min(v.A0, v.A0 + v.dA * v.time) <= 0) throw new Error("time must be nonnegative and loop area positive over the interval");
  const B = v.B0 + v.dB * v.time + v.ddB * v.time ** 2 / 2, A = v.A0 + v.dA * v.time, angle = v.theta0 + v.omega * v.time;
  const phi = v.N * v.winding * B * A * Math.cos(angle);
  const emf = -v.N * v.winding * (((v.dB + v.ddB * v.time) * A + B * v.dA) * Math.cos(angle) - B * A * v.omega * Math.sin(angle));
  if (v.closed === 0) { if (v.R !== undefined) throw new Error("open loop cannot bind a conducting return resistance"); return { phi, emf }; }
  positive(v.R, "closed return resistance"); const I = emf / v.R;
  return { phi, emf, I, P: I ** 2 * v.R };
}
function fluxInk(model: EmModel, v: Record<string, number>, r: Record<string, number>): SceneDocument {
  const ink = new Ink(), angle = v.theta0 + v.omega * v.time, B = v.B0 + v.dB * v.time + v.ddB * v.time ** 2 / 2;
  loopInk(ink, v.winding, v.closed === 1, r.I);
  ink.normal("field", [0, 0], B);
  // Separate x-z side view: page-normal B is vertical in this projection.
  // The schematic loop is not an assertion of its world-space tilted shape.
  if (B !== 0) ink.arrow("sideField", [2, 0], [2, Math.sign(B) * 0.9], "magnetic field in x-z projection");
  ink.label("sideFieldName", [1.9, -0.4], B === 0 ? "B=0" : "B");
  ink.arrow("areaNormal", [2.5, 0], [2.5 + v.winding * Math.sin(angle), v.winding * Math.cos(angle)], "positive area normal in field-normal projection");
  ink.label("normalName", [3, 1.4], "+area normal"); ink.label("sideViewName", [2.5, -1.4], "x-z side view"); ink.label("emfName", [0, -2], v.winding > 0 ? "emf: V(A)-V(B)" : "emf: V(B)-V(A)");
  return ink.finish(model, r, { fluxLaw: { ...v }, terminalTopology: { closed: v.closed === 1, terminals: ["A", "B"], resistance: v.R, emfReference: v.winding > 0 ? { positive: "A", negative: "B" } : { positive: "B", negative: "A" } }, positiveAreaNormalWorld: [v.winding * Math.sin(angle), 0, v.winding * Math.cos(angle)], fieldWorld: [0, 0, B], projection: "oriented loop schematic and separate x-z area-normal/B projection; shape is area-equivalent" });
}
function eddyInk(model: EmModel, v: Record<string, number>): SceneDocument {
  sign(v.fieldSign); sign(v.velocitySign); if (![0, -1, 1].includes(v.boundary)) throw new Error("boundary must be -1 left edge, +1 right edge, or 0 uniform interior");
  const ink = new Ink(); ink.path("plate", [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]], "conducting plate");
  if (v.boundary) ink.path("fieldBoundary", [[0, -1.6], [0, 1.6]], "field boundary");
  ink.normal("field", [v.boundary === 1 ? -0.6 : 0.6, 0], v.fieldSign);
  ink.arrow("velocity", [-0.3, 2], [-0.3 + v.velocitySign, 2], "plate velocity"); ink.label("vname", [0, 2.45], "v");
  const entering = v.boundary !== 0 && v.velocitySign === -v.boundary, circulation = v.boundary === 0 ? 0 : -v.fieldSign * (entering ? 1 : -1);
  if (circulation) { ink.arrow("eddy", [-0.65, 0.7], [-0.65 - circulation * 0.8, 0.7], "conceptual induced circulation"); ink.arrow("drag", [0, -2], [-v.velocitySign, -2], "drag opposes motion"); ink.label("dname", [0, -2.5], "drag"); }
  ink.label("state", [2, 0], v.boundary === 0 ? "no flux change" : entering ? "entering field" : "leaving field");
  return ink.finish(model, {}, { qualitativeRelations: { entering, circulation, dragDirection: circulation ? -v.velocitySign : 0, dissipation: circulation ? "nonnegative; supplied geometry and conductivity required to quantify" : "zero induction in uniform translation" }, uniqueEddyMap: false });
}
const selfKeys = ["L0", "dL", "I0", "dI", "time"];
function selfScalars(inputs: Record<string, unknown>): Record<string, number> {
  const v = finiteInputs(inputs, selfKeys); positive(v.L0, "L0"); if (v.time < 0) throw new Error("time must be nonnegative");
  const L = positive(v.L0 + v.dL * v.time, "L(time)"), I = v.I0 + v.dI * v.time;
  return { L, I, linkage: L * I, emf: -(L * v.dI + v.dL * I), U: L * I ** 2 / 2 };
}
const mutualKeys = ["L1", "L2", "k", "dot1", "dot2", "I10", "dI1", "I20", "dI2", "time"];
function mutualScalars(inputs: Record<string, unknown>): Record<string, number> {
  const v = finiteInputs(inputs, mutualKeys); positive(v.L1, "L1"); positive(v.L2, "L2"); sign(v.dot1); sign(v.dot2);
  if (v.k < 0 || v.k > 1 || v.time < 0) throw new Error("coupling must be 0..1 and time nonnegative");
  const M = v.dot1 * v.dot2 * v.k * Math.sqrt(v.L1 * v.L2), I1 = v.I10 + v.dI1 * v.time, I2 = v.I20 + v.dI2 * v.time;
  return { M, emf1: -M * v.dI2, emf2: -M * v.dI1, U: v.L1 * I1 ** 2 / 2 + v.L2 * I2 ** 2 / 2 + M * I1 * I2 };
}
const lcKeys = ["L", "C", "Q0", "I0", "time"];
function lcScalars(inputs: Record<string, unknown>): Record<string, number> {
  const v = finiteInputs(inputs, lcKeys); positive(v.L, "L"); positive(v.C, "C"); if (v.time < 0) throw new Error("time must be nonnegative");
  const omega = 1 / Math.sqrt(v.L * v.C), Q = v.Q0 * Math.cos(omega * v.time) + v.I0 / omega * Math.sin(omega * v.time), I = -v.Q0 * omega * Math.sin(omega * v.time) + v.I0 * Math.cos(omega * v.time);
  const UC = Q ** 2 / (2 * v.C), UL = v.L * I ** 2 / 2;
  return { omega, Q, I, V: Q / v.C, UL, UC, U: UL + UC };
}
function lcInk(model: EmModel, result: Record<string, number>, v: Record<string, number>): SceneDocument {
  const ink = new Ink(); ink.coil("inductor", [-1, 1]); ink.label("lname", [0, 1.6], "L");
  ink.path("return", [[-1, 1], [-2, 1], [-2, -1], [-0.15, -1]]); ink.path("return2", [[0.15, -1], [2, -1], [2, 1], [1, 1]]);
  ink.path("plate1", [[-0.15, -1.35], [-0.15, -0.65]]); ink.path("plate2", [[0.15, -1.35], [0.15, -0.65]]); ink.label("cname", [0, -1.8], "C");
  ink.arrow("positiveI", [2.3, -0.4], [2.3, 0.4], "+I=dQ/dt"); ink.label("iref", [2.6, 0.9], "+I");
  const qAmplitude = Math.hypot(v.Q0, v.I0 / result.omega);
  ink.path("chargeTime", Array.from({ length: 65 }, (_, j): Point => { const t = j * 2 * Math.PI / (64 * result.omega); return [3.5 + j / 16, qAmplitude ? 0.6 * (v.Q0 * Math.cos(result.omega * t) + v.I0 / result.omega * Math.sin(result.omega * t)) / qAmplitude : 0]; }), "undamped charge vs time");
  ink.label("qtime", [5.5, -1.2], "Q(t), one cycle");
  return ink.finish(model, result, { terminalTopology: { nodes: ["A", "B"], branches: [{ id: "L", from: "A", to: "B" }, { id: "C", from: "B", to: "A" }] }, initialState: { Q0: v.Q0, I0: v.I0 }, chargeConvention: "I=dQ/dt; capacitor drop in positive loop direction is Q/C" });
}
inductionAcModels.push(
  extension("ind.flux_loop", "faradays-law", fluxKeys, { B0: 2, dB: 3, ddB: 0, A0: 4, dA: 1, theta0: 0, omega: 0, N: 2, winding: 1, time: 1, closed: 1, R: 10 }, { B0: 2, dB: 0, ddB: 0, A0: 3, dA: 0, theta0: 0, omega: 2, N: 2, winding: -1, time: Math.PI / 4, closed: 0 }, [{ B0: 1, dB: 1, ddB: 0, A0: 1, dA: 0, theta0: 0, omega: 0, N: 1, winding: 1, time: 1, closed: 1 }], "Uniform field; source-defined oriented area and quadratic B/affine area/constant angular rate; resistive return only if explicitly closed.", function(inputs) { return fluxInk(this, optionalInputs(inputs, fluxKeys, ["R"]), fluxScalars(inputs)); }),
  extension("ind.self_state", "self-inductance", selfKeys, { L0: 2, dL: 3, I0: 4, dI: -1, time: 1 }, { L0: 5, dL: 0, I0: 2, dI: 3, time: 0 }, [{ L0: 1, dL: -2, I0: 1, dI: 0, time: 1 }], "Linear instantaneous inductance with explicit affine L and current; emf is the total flux-linkage derivative.", function(inputs) { return stateCoil(this, selfScalars(inputs)); }),
  extension("ind.mutual_state", "mutual-inductance", mutualKeys, { L1: 4, L2: 9, k: 0.5, dot1: 1, dot2: -1, I10: 2, dI1: 4, I20: 1, dI2: -1, time: 0 }, { L1: 4, L2: 9, k: 0, dot1: 1, dot2: 1, I10: 2, dI1: 4, I20: 1, dI2: -1, time: 0 }, [{ L1: 4, L2: 9, k: 2, dot1: 1, dot2: 1, I10: 2, dI1: 4, I20: 1, dI2: -1, time: 0 }], "Linear reciprocal coupled coils with explicit dot convention; positive current references run left to right in each winding.", function(inputs) { const v = finiteInputs(inputs, mutualKeys); return stateCoil(this, mutualScalars(inputs), true, [v.dot1, v.dot2]); }),
  extension("ind.lc_state", "lc-oscillations", lcKeys, { L: 4, C: 0.25, Q0: 2, I0: 0, time: Math.PI / 2 }, { L: 4, C: 0.25, Q0: 0, I0: 4, time: Math.PI / 2 }, [{ L: 4, C: 0, Q0: 2, I0: 0, time: 0 }], "Closed ideal LC; Q and I are initial states with I=dQ/dt; no resistance or dissipative decay.", function(inputs) { return lcInk(this, lcScalars(inputs), finiteInputs(inputs, lcKeys)); }),
  extension("ind.motional_circuit", "motional-emf", motionalKeys, { B: -2, l: 3, vx: 4, rodAngle: Math.PI / 2, closed: 1, R: 6 }, { B: 2, l: 3, vx: -4, rodAngle: Math.PI / 4, closed: 0 }, [{ B: 2, l: 3, vx: 4, rodAngle: Math.PI / 2, closed: 1 }], "Uniform page-normal field; rod translates along straight conducting rails; rod angle and open/resistive return are explicit.", function(inputs) { const v = optionalInputs(inputs, motionalKeys, ["R"]); return motionalInk(this, motionalScalars(inputs), v); }),
  extension("ind.sinusoid", "alternating-current-basics", sinusoidKeys, { Vpeak: 10, Ipeak: 4, omega: 3, voltagePhase: 0.4, currentPhase: -0.6, time: 0 }, { Vpeak: 8, Ipeak: 2, omega: 2, voltagePhase: 0, currentPhase: Math.PI / 2, time: 0 }, [{ Vpeak: 1, Ipeak: 1, omega: 0, voltagePhase: 0, currentPhase: 0, time: 0 }], "Sinusoidal voltage and current with declared amplitudes and phases; time plots use separate normalized amplitude scales.", function(inputs) { const v = finiteInputs(inputs, sinusoidKeys), ink = new Ink(); waveInk(ink, "v(t)", v.voltagePhase, 1.2, v.Vpeak === 0 ? 0 : 0.7); waveInk(ink, "i(t)", v.currentPhase, -1.2, v.Ipeak === 0 ? 0 : 0.7); return ink.finish(this, sinusoidScalars(inputs), { waveform: "sinusoid", phaseConvention: "sin(omega t + source phase)", sourceAmplitude: { Vpeak: v.Vpeak, Ipeak: v.Ipeak }, distinctAmplitudeScales: true }); }),
  extension("ind.eddy_motion", "eddy-currents-and-inductance", ["fieldSign", "velocitySign", "boundary"], { fieldSign: 1, velocitySign: 1, boundary: -1 }, { fieldSign: -1, velocitySign: 1, boundary: 1 }, [{ fieldSign: 0, velocitySign: 1, boundary: -1 }], "Conducting plate crosses a boundary of a uniform normal magnetic field or remains wholly in uniform field; circulation is conceptual, not a unique eddy-current map.", function(inputs) { return eddyInk(this, finiteInputs(inputs, this.keys)); }, "qualitative"),
  extension("ind.rc_transient", "lc-oscillations", rcKeys, { R: 2, C: 0.5, V: 10, initialV: 2, time: 1 }, { R: 2, C: 0.5, V: 0, initialV: 8, time: 1 }, [{ R: 0, C: 0.5, V: 10, initialV: 0, time: 1 }], "DC step at time zero into explicit series RC; initial capacitor voltage stated; passive linear positive components.", function(inputs) { return transientInk(this, rcValues(inputs)); }),
  extension("ind.lr_transient", "lc-oscillations", lrKeys, { R: 2, L: 4, V: 10, initialI: 1, time: 2 }, { R: 2, L: 4, V: 0, initialI: 4, time: 2 }, [{ R: 2, L: 0, V: 10, initialI: 0, time: 1 }], "DC step at time zero into explicit series LR; initial inductor current stated; passive linear positive components.", function(inputs) { return transientInk(this, lrValues(inputs)); }),
  extension("ind.generator_state", "ac-generator-and-transformer", generatorKeys, { N: 2, B: 3, A: 4, omega: 5, theta0: 0, time: Math.PI / 10, winding: -1, closed: 1, R: 12 }, { N: 2, B: -3, A: 4, omega: 2, theta0: Math.PI / 2, time: 0, winding: 1, closed: 0 }, [{ N: 2, B: 3, A: 4, omega: 0, theta0: 0, time: 0, winding: 1, closed: 0 }], "Uniform field; rigid source coil rotates about a declared transverse axis; sine emf phase is the derivative of cosine linkage; continuous slip rings with named terminals.", function(inputs) { return generatorInk(this, generatorScalars(inputs), optionalInputs(inputs, generatorKeys, ["R"])); }),
  extension("ind.transformer_load", "transformer", transformerKeys, { Np: 10, Ns: 2, Vp: 100, frequency: 50, dotP: 1, dotS: -1, load: 4, coreLoss: 5, copperLoss: 5 }, { Np: 2, Ns: 10, Vp: 20, frequency: 60, dotP: -1, dotS: -1, load: 20 }, [{ Np: 10, Ns: 2, Vp: 100, frequency: 0, dotP: 1, dotS: 1, load: 4 }], "Sinusoidal AC transformer; ideal induced-voltage turns ratio; resistive load; source-stated power losses if present, negligible regulation and unity input power factor for active RMS current.", function(inputs) { const v = optionalInputs(inputs, transformerKeys, ["coreLoss", "copperLoss"], [["coreLoss", "copperLoss"]]); return transformerInk(this, transformerScalars(inputs), [v.dotP, v.dotS], true); }),
  extension("ind.dc_limits", "inductive-and-capacitive-reactance", ["kind", "steady"], { kind: 1, steady: 1 }, { kind: 0, steady: 1 }, [{ kind: 1, steady: 0 }], "Ideal component zero-frequency limit only, steady DC: inductor behaves as a short and capacitor as an open; no source or finite capacitor reactance is solved.", function(inputs) { const v = finiteInputs(inputs, this.keys); flag(v.kind); if (v.steady !== 1) throw new Error("DC limit requires steady state"); const ink = new Ink(); if (v.kind === 0) ink.path("dcShort", [[0, 0], [3, 0]], "ideal inductor steady short"); else { ink.path("dcOpenA", [[0, 0], [1.3, 0]]); ink.path("dcOpenB", [[1.7, 0], [3, 0]]); ink.circle("terminalA", [1.3, 0], 0.04); ink.circle("terminalB", [1.7, 0], 0.04); } ink.label("limit", [1.5, 0.8], v.kind === 0 ? "DC L: short" : "DC C: open"); return ink.finish(this, {}, { dcLimit: v.kind === 0 ? "zero impedance; current requires external circuit" : "open; no finite reactance", zeroFrequency: true }); }, "qualitative"),
  extension("ind.series_response", "reactance-impedance-and-lcr", responseKeys, { V: 10, R: 3, L: 2, C: 0.0625, omega: 4, phase: 0, series: 1, scanMin: 1, scanMax: 8, scanCount: 29 }, { V: 10, R: 3, L: 2, C: 0.0625, omega: 2, phase: Math.PI / 2, series: 1 }, [{ V: 10, R: 0, L: 1, C: 1, omega: 1, phase: 0, series: 1 }, { V: 10, R: 3, L: 1, C: 1, omega: 1, phase: 0, series: 0 }], "Explicit series RLC with sinusoidal RMS voltage and phase; ideal linear components; frequency scan optional only with complete declared bounds and sample count.", function(inputs) { return responseInk(this, responseScalars(inputs), optionalInputs(inputs, responseKeys, scanKeys, [scanKeys])); }),
);

const reusableTopicClosures: Readonly<Record<string, readonly string[]>> = {
  "ind.flux_loop": ["induced-emf-current-and-lenz-law"],
  "ind.sinusoid": ["power-in-ac-circuits-and-wattless-current"],
  "ind.transformer_load": ["ac-generator-and-transformer"],
  "ind.series_response": [
    "inductive-and-capacitive-reactance",
    "resonance-power-and-wattless-current",
    "power-in-ac-circuits-and-wattless-current",
  ],
};
for (const [modelName, topics] of Object.entries(reusableTopicClosures)) {
  const model = inductionAcModels.find((candidate) => candidate.name === modelName);
  if (!model) throw new Error(`missing reusable induction model ${modelName}`);
  model.topics.push(...topics.map((topic) => ({
    topicId: `physics|14|${topic}`,
    packet: "CH-09c",
    chapter,
    remaining: "Shared source/planner/runtime/persistence and independent acceptance pending.",
  })));
}

const categoricalRoles: Record<string, Readonly<Record<string, readonly string[]>>> = {
  shown: { "1": ["conducting plate is supplied"] },
  perpendicular: { "1": ["rod field and velocity are mutually perpendicular"], "0": ["rod field and velocity are not mutually perpendicular"] },
  winding: { "1": ["positive loop traversal counterclockwise"], "-1": ["positive loop traversal clockwise"] },
  closed: { "1": ["closed resistive return", "closed resistive load"], "0": ["open circuit"] },
  fieldSign: { "1": ["magnetic field out of the page"], "-1": ["magnetic field into the page"] },
  velocitySign: { "1": ["plate moves in positive x"], "-1": ["plate moves in negative x"] },
  boundary: { "-1": ["left boundary of magnetic field"], "0": ["plate wholly within uniform field"], "1": ["right boundary of magnetic field"] },
  dot1: { "1": ["primary dot at left terminal"], "-1": ["primary dot at right terminal"] },
  dot2: { "1": ["secondary dot at left terminal"], "-1": ["secondary dot at right terminal"] },
  dotP: { "1": ["primary dot at top terminal"], "-1": ["primary dot at bottom terminal"] },
  dotS: { "1": ["secondary dot at top terminal"], "-1": ["secondary dot at bottom terminal"] },
  kind: { "0": ["ideal inductor"], "1": ["ideal capacitor"] },
  steady: { "1": ["steady DC"], "0": ["transient DC"] },
  series: { "1": ["series connected"], "0": ["not series connected"] },
};
function roles(spec: Record<string, [string, string]>): Record<string, InputRole> {
  return Object.fromEntries(Object.entries(spec).map(([key, [role, unit]]) => [key, { role, unit, ...(categoricalRoles[key] ? { sourcePhrases: categoricalRoles[key] } : {}) }]));
}
const legacyScalars: Record<string, (v: Record<string, number>) => Record<string, number>> = {
  "ind.faraday": (v) => { positive(v.area, "area"); turns(v.turns); if (v.time <= 0 || v.time >= 2 || v.Bz0 + v.dBz * v.time === 0) throw new Error("field snapshot requires an interior time and nonzero direction"); return { phi: v.turns * (v.Bz0 + v.dBz * v.time) * v.area, emf: -v.turns * v.dBz * v.area }; },
  "ind.motional": (v) => { positive(v.B, "B"); positive(v.l, "l"); if (v.v < 0 || v.perpendicular !== 1) throw new Error("requires nonnegative speed and perpendicular geometry"); return { emf: v.B * v.l * v.v }; },
  "ind.eddy": (v) => { if (v.shown !== 1) throw new Error("requires conducting plate"); return {}; },
  "ind.self": (v) => { for (const key of ["mu0", "n", "A", "length"]) positive(v[key], key); return { L: v.mu0 * positive(v.muR ?? 1, "muR") * v.n ** 2 * v.A * v.length * positive(v.geometryFactor ?? 1, "geometryFactor") }; },
  "ind.mutual": (v) => { positive(v.L1, "L1"); positive(v.L2, "L2"); if (v.k < 0 || v.k > 1) throw new Error("coupling magnitude must be 0..1"); return { M: v.k * Math.sqrt(v.L1 * v.L2) }; },
  "ind.lc": (v) => { positive(v.L, "L"); positive(v.C, "C"); return { omega: 1 / Math.sqrt(v.L * v.C), U: v.Q ** 2 / (2 * v.C) + v.L * v.I ** 2 / 2 }; },
  "ind.resistor": (v) => { if (v.R < 0) throw new Error("R must be nonnegative"); positive(v.omega, "omega"); return { Z: v.R }; },
  "ind.reactance": (v) => { positive(v.omega, "omega"); positive(v.C, "C"); if (v.L < 0) throw new Error("L must be nonnegative"); return { XL: v.omega * v.L, XC: 1 / (v.omega * v.C) }; },
  "ind.lcr": (v) => { if (v.R < 0 || v.L < 0) throw new Error("passive components required"); positive(v.C, "C"); positive(v.omega, "omega"); const X = v.omega * v.L - 1 / (v.omega * v.C); return { X, Z: Math.hypot(v.R, X) }; },
  "ind.phasor": (v) => { const r = responseScalars({ ...v, phase: 0, series: 1 }); return { Ireal: r.Ireal, Iimag: r.Iimag, I: r.I, P: r.P, powerFactor: v.R / r.Z }; },
  "ind.resonance": (v) => { positive(v.R, "R"); positive(v.L, "L"); positive(v.C, "C"); return { omega: 1 / Math.sqrt(v.L * v.C), Z: v.R }; },
  "ind.wattless": (v) => { positive(v.V, "V"); positive(v.L, "L"); positive(v.omega, "omega"); const XL = v.omega * v.L; return { XL, I: v.V / XL, P: 0 }; },
  "ind.generator": (v) => { turns(v.N); positive(v.B, "B"); positive(v.A, "A"); positive(v.omega, "omega"); return { peakEmf: v.N * v.B * v.A * v.omega }; },
  "ind.transformer": (v) => { turns(v.Np); turns(v.Ns); positive(v.Vp, "Vp"); if (v.Ip < 0) throw new Error("Ip must be nonnegative"); const Vs = v.Vp * v.Ns / v.Np, Is = v.Ip * v.Np / v.Ns; if (v.claimedVs !== Vs || v.claimedIs !== Is) throw new Error("secondary claims conflict with ideal transformer"); return { Vs, Is }; },
};
const roleSpecs: Record<string, Record<string, [string, string]>> = {
  "ind.faraday": { Bz0: ["initial signed normal magnetic field", "T"], dBz: ["signed normal magnetic field rate", "T/s"], area: ["fixed oriented loop area", "m^2"], turns: ["coil turns", "1"], time: ["sample time", "s"] },
  "ind.motional": { B: ["magnetic field magnitude", "T"], l: ["rod length", "m"], v: ["rod speed", "m/s"], perpendicular: ["perpendicular geometry flag", "1"] },
  "ind.eddy": { shown: ["conducting plate flag", "1"] },
  "ind.self": { mu0: ["vacuum permeability", "H/m"], n: ["solenoid turns per length", "1/m"], A: ["coil cross section area", "m^2"], length: ["solenoid length", "m"] },
  "ind.mutual": { L1: ["primary self inductance", "H"], L2: ["secondary self inductance", "H"], k: ["coupling coefficient magnitude", "1"] },
  "ind.lc": { L: ["inductance", "H"], C: ["capacitance", "F"], Q: ["simultaneous capacitor charge", "C"], I: ["simultaneous circuit current", "A"] },
  "ind.resistor": { R: ["resistance", "ohm"], omega: ["angular frequency", "rad/s"] },
  "ind.reactance": { L: ["inductance", "H"], C: ["capacitance", "F"], omega: ["angular frequency", "rad/s"] },
  "ind.lcr": { R: ["series resistance", "ohm"], L: ["series inductance", "H"], C: ["series capacitance", "F"], omega: ["angular frequency", "rad/s"] },
  "ind.phasor": { V: ["source RMS voltage", "V"], R: ["series resistance", "ohm"], L: ["series inductance", "H"], C: ["series capacitance", "F"], omega: ["angular frequency", "rad/s"] },
  "ind.resonance": { R: ["series resistance", "ohm"], L: ["series inductance", "H"], C: ["series capacitance", "F"] },
  "ind.wattless": { V: ["source RMS voltage", "V"], L: ["inductance", "H"], omega: ["angular frequency", "rad/s"] },
  "ind.generator": { N: ["generator turns", "1"], B: ["magnetic field magnitude", "T"], A: ["coil area", "m^2"], omega: ["rotation angular frequency", "rad/s"] },
  "ind.transformer": { Np: ["primary turns", "1"], Ns: ["secondary turns", "1"], Vp: ["primary RMS voltage", "V"], Ip: ["primary RMS current", "A"], claimedVs: ["claimed secondary RMS voltage", "V"], claimedIs: ["claimed secondary RMS current", "A"] },
  "ind.flux_loop": { B0: ["initial signed normal magnetic field", "T"], dB: ["initial signed magnetic field rate", "T/s"], ddB: ["signed magnetic field second derivative", "T/s^2"], A0: ["initial loop area", "m^2"], dA: ["loop area rate", "m^2/s"], theta0: ["initial angle between area normal and field axis", "rad"], omega: ["area normal angular rate", "rad/s"], N: ["coil turns", "1"], winding: ["positive winding reference", "1"], time: ["sample time", "s"], closed: ["closed return flag", "1"] },
  "ind.self_state": { L0: ["initial inductance", "H"], dL: ["inductance rate", "H/s"], I0: ["initial coil current", "A"], dI: ["coil current rate", "A/s"], time: ["sample time", "s"] },
  "ind.mutual_state": { L1: ["primary self inductance", "H"], L2: ["secondary self inductance", "H"], k: ["coupling coefficient magnitude", "1"], dot1: ["primary winding dot reference", "1"], dot2: ["secondary winding dot reference", "1"], I10: ["initial primary current", "A"], dI1: ["primary current rate", "A/s"], I20: ["initial secondary current", "A"], dI2: ["secondary current rate", "A/s"], time: ["sample time", "s"] },
  "ind.lc_state": { L: ["inductance", "H"], C: ["capacitance", "F"], Q0: ["initial capacitor charge", "C"], I0: ["initial circuit current", "A"], time: ["sample time", "s"] },
  "ind.motional_circuit": { B: ["signed normal magnetic field", "T"], l: ["rod length", "m"], vx: ["signed rod x velocity", "m/s"], rodAngle: ["rod angle measured from positive x", "rad"], closed: ["closed return flag", "1"] },
  "ind.sinusoid": { Vpeak: ["peak voltage amplitude", "V"], Ipeak: ["peak current amplitude", "A"], omega: ["angular frequency", "rad/s"], voltagePhase: ["voltage sine phase", "rad"], currentPhase: ["current sine phase", "rad"], time: ["sample time", "s"] },
  "ind.eddy_motion": { fieldSign: ["normal magnetic field direction", "1"], velocitySign: ["plate x velocity direction", "1"], boundary: ["field boundary identity", "1"] },
  "ind.rc_transient": { R: ["series resistance", "ohm"], C: ["capacitance", "F"], V: ["DC step voltage", "V"], initialV: ["initial capacitor voltage", "V"], time: ["time since DC step", "s"] },
  "ind.lr_transient": { R: ["series resistance", "ohm"], L: ["inductance", "H"], V: ["DC step voltage", "V"], initialI: ["initial inductor current", "A"], time: ["time since DC step", "s"] },
  "ind.generator_state": { N: ["generator turns", "1"], B: ["signed normal magnetic field", "T"], A: ["coil area", "m^2"], omega: ["signed rotation angular frequency", "rad/s"], theta0: ["initial coil normal angle", "rad"], time: ["sample time", "s"], winding: ["positive winding reference", "1"], closed: ["closed load flag", "1"] },
  "ind.transformer_load": { Np: ["primary turns", "1"], Ns: ["secondary turns", "1"], Vp: ["primary RMS voltage", "V"], frequency: ["source AC frequency", "Hz"], dotP: ["primary winding dot reference", "1"], dotS: ["secondary winding dot reference", "1"], load: ["secondary load resistance", "ohm"] },
  "ind.dc_limits": { kind: ["component kind", "1"], steady: ["steady DC flag", "1"] },
  "ind.series_response": { V: ["source RMS voltage", "V"], R: ["series resistance", "ohm"], L: ["series inductance", "H"], C: ["series capacitance", "F"], omega: ["angular frequency", "rad/s"], phase: ["source RMS phasor phase", "rad"], series: ["series topology flag", "1"] },
};
const scalarExtensions: Record<string, (inputs: Record<string, unknown>) => Record<string, number>> = { "ind.flux_loop": fluxScalars, "ind.self_state": selfScalars, "ind.mutual_state": mutualScalars, "ind.lc_state": lcScalars, "ind.motional_circuit": motionalScalars, "ind.sinusoid": sinusoidScalars, "ind.rc_transient": (inputs) => transientScalars(rcValues(inputs)), "ind.lr_transient": (inputs) => transientScalars(lrValues(inputs)), "ind.generator_state": generatorScalars, "ind.transformer_load": transformerScalars, "ind.series_response": responseScalars };
const assumptionSpecs: Record<string, string[]> = {
  "ind.faraday": ["uniform affine normal field", "fixed positive page normal area"],
  "ind.motional": ["uniform normal field", "velocity along positive x", "rod points along negative y"],
  "ind.eddy": ["conducting plate"],
  "ind.self": ["linear"],
  "ind.mutual": ["linear coupled coils", "coupling magnitude"],
  "ind.lc": ["ideal LC", "simultaneous charge and current", "current is charge derivative"],
  "ind.resistor": ["ohmic"],
  "ind.reactance": ["ideal inductor and capacitor"],
  "ind.lcr": ["series RLC", "linear components"],
  "ind.phasor": ["series RLC", "sinusoidal", "RMS", "zero source phase"],
  "ind.resonance": ["series RLC", "resonance", "linear components"],
  "ind.wattless": ["pure inductor", "RMS", "sinusoidal"],
  "ind.generator": ["uniform field", "rigid rotating coil", "rotation axis perpendicular to field"],
  "ind.transformer": ["ideal transformer", "sinusoidal AC", "RMS", "voltage and current magnitudes"],
  "ind.flux_loop": ["uniform field", "quadratic field and affine area", "constant angular rate", "source defined oriented area", "pure resistive return if closed"],
  "ind.self_state": ["linear", "affine inductance and current"],
  "ind.mutual_state": ["linear coupled coils", "explicit dot convention", "current references left to right", "emf along positive winding traversal"],
  "ind.lc_state": ["ideal LC", "current is charge derivative"],
  "ind.motional_circuit": ["uniform normal field", "straight conducting rails", "rigid translating rod"],
  "ind.sinusoid": ["sinusoidal voltage and current"],
  "ind.eddy_motion": ["conducting plate", "uniform normal field"],
  "ind.rc_transient": ["DC step", "series RC", "linear positive passive components"],
  "ind.lr_transient": ["DC step", "series LR", "linear positive passive components"],
  "ind.generator_state": ["uniform field", "rigid rotating coil", "rotation axis perpendicular to field", "continuous slip rings"],
  "ind.transformer_load": ["sinusoidal AC", "negligible regulation", "unity input power factor", "ideal induced voltage ratio"],
  "ind.dc_limits": ["ideal component", "steady DC"],
  "ind.series_response": ["series RLC", "sinusoidal", "RMS", "linear passive components"],
};
/** Exact integration handoff. Registration is owned by the coordinator. */
export const inductionAcAdmissions: readonly ModelAdmission[] = inductionAcModels.map((model) => ({
  name: model.name,
  roles: roles(roleSpecs[model.name]!),
  optionalRoles: model.name === "ind.self" ? roles({ geometryFactor: ["source supplied coil geometry factor", "1"], muR: ["relative linear permeability", "1"] }) : model.name === "ind.transformer_load" ? roles({ coreLoss: ["source stated core loss", "W"], copperLoss: ["source stated copper loss", "W"] }) : model.name === "ind.series_response" ? roles({ scanMin: ["scan minimum angular frequency", "rad/s"], scanMax: ["scan maximum angular frequency", "rad/s"], scanCount: ["scan sample count", "1"] }) : ["ind.flux_loop", "ind.motional_circuit", "ind.generator_state"].includes(model.name) ? roles({ R: ["closed return resistance", "ohm"] }) : {},
  optionalGroups: model.name === "ind.transformer_load" ? [["coreLoss", "copperLoss"]] : model.name === "ind.series_response" ? [scanKeys] : [],
  conditionalRules: model.name === "ind.self" ? [
    { when: { absentAll: ["geometryFactor"] }, assumptions: ["long solenoid", "negligible end effects"] },
    { when: { presentAny: ["geometryFactor"] }, assumptions: ["source supplied geometry factor"] },
    { when: { presentAny: ["muR"] }, assumptions: ["uniform linear core"] },
  ] : model.name === "ind.transformer_load" ? [
    { when: { absentAll: ["coreLoss", "copperLoss"] }, assumptions: ["lossless transformer"] },
    { when: { presentAny: ["coreLoss", "copperLoss"] }, assumptions: ["source stated loss budget"] },
  ] : ["ind.flux_loop", "ind.motional_circuit", "ind.generator_state"].includes(model.name) ? [
    { when: { equals: { closed: 1 } }, requiredKeys: ["R"] },
    { when: { equals: { closed: 0 } }, forbiddenKeys: ["R"] },
  ] : [],
  assumptions: assumptionSpecs[model.name]!,
  resultKind: model.scope === "qualitative" ? "representation" : "scalar",
  scalar(inputs) {
    const values = { ...inputs }, compute = scalarExtensions[model.name];
    let result: Record<string, number>;
    if (compute) result = compute(values);
    else if (legacyScalars[model.name]) result = legacyScalars[model.name]!(model.name === "ind.self" ? optionalInputs(values, model.keys, ["geometryFactor", "muR"]) : finiteInputs(values, model.keys));
    else { // Qualitative model guards; no scalar can be certified here.
      const v = finiteInputs(values, model.keys);
      if (model.name === "ind.dc_limits") { flag(v.kind); if (v.steady !== 1) throw new Error("steady DC required"); }
      else { sign(v.fieldSign); sign(v.velocitySign); if (![0, -1, 1].includes(v.boundary)) throw new Error("unknown boundary"); }
      result = {};
    }
    if (Object.values(result).some((value) => !Number.isFinite(value))) throw new Error("physical result overflow or singularity");
    return result;
  },
}));

/** Units of solved scalar outputs, including reactive power (var = V A). */
export const inductionAcOutputUnits: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "ind.faraday": { phi: "Wb", emf: "V" }, "ind.motional": { emf: "V" }, "ind.eddy": {}, "ind.self": { L: "H" }, "ind.mutual": { M: "H" },
  "ind.lc": { omega: "rad/s", U: "J" }, "ind.resistor": { Z: "ohm" }, "ind.reactance": { XL: "ohm", XC: "ohm" }, "ind.lcr": { X: "ohm", Z: "ohm" },
  "ind.phasor": { Ireal: "A", Iimag: "A", I: "A", P: "W", powerFactor: "1" }, "ind.resonance": { omega: "rad/s", Z: "ohm" }, "ind.wattless": { XL: "ohm", I: "A", P: "W" },
  "ind.generator": { peakEmf: "V" }, "ind.transformer": { Vs: "V", Is: "A" }, "ind.flux_loop": { phi: "Wb", emf: "V", I: "A", P: "W" },
  "ind.self_state": { L: "H", I: "A", linkage: "Wb", emf: "V", U: "J" }, "ind.mutual_state": { M: "H", emf1: "V", emf2: "V", U: "J" },
  "ind.lc_state": { omega: "rad/s", Q: "C", I: "A", V: "V", UL: "J", UC: "J", U: "J" }, "ind.motional_circuit": { emf: "V", I: "A", Fx: "N", P: "W" },
  "ind.sinusoid": { Vrms: "V", Irms: "A", phase: "rad", P: "W", v: "V", i: "A" }, "ind.eddy_motion": {},
  "ind.rc_transient": { tau: "s", state: "V", current: "A", stored: "J" }, "ind.lr_transient": { tau: "s", state: "A", current: "A", stored: "J" },
  "ind.generator_state": { phi: "Wb", emf: "V", peakEmf: "V", I: "A", P: "W" }, "ind.transformer_load": { Vs: "V", Is: "A", Pout: "W", Pin: "W", Ip: "A", efficiency: "1" },
  "ind.dc_limits": {}, "ind.series_response": { XL: "ohm", XC: "ohm", Zreal: "ohm", Zimag: "ohm", Z: "ohm", Ireal: "A", Iimag: "A", I: "A", lag: "rad", P: "W", Q: "var", VR: "V", VL: "V", VC: "V" },
};
