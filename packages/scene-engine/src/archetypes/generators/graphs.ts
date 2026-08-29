/**
 * Graph archetypes: motion graphs from the phases a stem names, F–x work
 * areas, waves from their equation, P–V cycles constructed from the named
 * processes, and explicit function graphs with tangents and regions.
 *
 * Graphs are display-scaled on the vertical axis when the value range is far
 * from the domain range (a 4 s × 41 m plot would otherwise be a needle). The
 * scaling is a declared affine factor: every assertion is written in the
 * scaled space, every label reports the true value.
 */
import { parseMathExpression } from "../../math/expression";
import { SceneBuilder, fmt, withUnit } from "../document";
import { prepareStem, UNIT, firstNumberWithUnit, numbersWithUnit, explicitFunctions } from "../slots";
import { grounded, maybeNum, num, text, type GeneratorContext, type GeneratorTable } from "./context";

function evaluate(expression: string, x: number): number | null {
  try {
    const value = parseMathExpression(expression).evaluate(x);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function sampleRange(expressions: readonly string[], xMin: number, xMax: number, count = 33): { yMin: number; yMax: number } | null {
  const samples = expressions.flatMap((expression) => Array.from({ length: count }, (_, index) => evaluate(expression, xMin + (index / (count - 1)) * (xMax - xMin)))).filter((value): value is number => value !== null);
  if (samples.length < count / 2) return null;
  return { yMin: Math.min(0, ...samples), yMax: Math.max(0, ...samples) };
}

/** Vertical display factor so the plot's aspect stays readable under uniform world scaling. */
function displayFactor(xSpan: number, yMin: number, yMax: number): number {
  const ySpan = Math.max(yMax - yMin, 1e-9);
  const ratio = ySpan / Math.max(xSpan, 1e-9);
  if (ratio > 1.4) return (xSpan * 0.7) / ySpan;
  if (ratio < 0.3) return (xSpan * 0.45) / ySpan;
  return 1;
}

const scaled = (expression: string, k: number): string => (k === 1 ? expression : `(${k})*(${expression})`);
const compactExpression = (expression: string): string => expression.replace(/\*/g, "").slice(0, 14);

/* ------------------------------------------------------------------------- */
/* v–t from phases                                                            */
/* ------------------------------------------------------------------------- */

interface Phase { kind: "accelerate" | "cruise" | "decelerate"; duration: number; vEnd: number }

const SPEED_UNIT = /m\s*\/\s*s(?![\^\d])|m\s*s\^-1|ms\^-1|km\s*\/\s*h|kmph|km\s*h\^-1/;

function toMetresPerSecond(value: number, clause: string): number {
  return /km\s*\/\s*h|kmph|km\s*h\^-1/i.test(clause) ? value / 3.6 : value;
}

export function parseMotionPhases(question: string): Phase[] {
  const stem = prepareStem(question);
  const clauses = stem.split(/(?:,|;|\.(?!\d)|\bthen\b|\band then\b|\bafter (?:that|which)\b|\bfinally\b|\bnext\b)/i).map((clause) => clause.trim()).filter(Boolean);
  const phases: Phase[] = [];
  let v = 0;
  for (const clause of clauses) {
    const duration = firstNumberWithUnit(clause, UNIT.second);
    const speeds = numbersWithUnit(clause, SPEED_UNIT).map((value) => toMetresPerSecond(value, clause));
    const acceleration = firstNumberWithUnit(clause, UNIT.accel);
    const accelerates = /\b(?:accelerat\w*|speeds? up|picks up speed|attains|reaches a (?:speed|velocity)|starts from rest)\b/i.test(clause);
    const decelerates = /\b(?:decelerat\w*|retard\w*|brak\w*|slows?(?: down)?|comes to rest|stops|halts)\b/i.test(clause);
    const cruises = /\b(?:constant (?:speed|velocity)|uniform (?:speed|velocity)|steady speed|same speed|this speed|moves uniformly|continues)\b/i.test(clause);
    if (decelerates && (duration !== null || acceleration !== null)) {
      const target = /\b(?:rest|stops|halts)\b/i.test(clause) ? 0 : speeds.find((speed) => speed < v) ?? 0;
      const time = duration ?? (acceleration ? Math.abs(v - target) / acceleration : 0);
      if (time > 0) { phases.push({ kind: "decelerate", duration: time, vEnd: target }); v = target; }
      continue;
    }
    if (cruises && duration !== null && !accelerates) {
      const target = speeds.find((speed) => speed > 0) ?? v;
      if (phases.length === 0 && target > 0) v = target;
      phases.push({ kind: "cruise", duration, vEnd: v });
      continue;
    }
    if (accelerates && (duration !== null || acceleration !== null)) {
      const target = acceleration !== null && duration !== null
        ? v + acceleration * duration
        : speeds.find((speed) => speed > v) ?? null;
      if (target === null) continue;
      const time = duration ?? (acceleration ? (target - v) / acceleration : 0);
      if (time > 0) { phases.push({ kind: "accelerate", duration: time, vEnd: target }); v = target; }
    }
  }
  return phases;
}

function vtGraph(context: GeneratorContext) {
  const phases = parseMotionPhases(text(context, "phases", context.question));
  if (phases.length === 0) return null;
  const totalTime = phases.reduce((sum, phase) => sum + phase.duration, 0);
  const vMax = Math.max(...phases.map((phase) => phase.vEnd), 1e-9);
  const k = displayFactor(totalTime, 0, vMax);
  const scene = new SceneBuilder(context.question, `velocity–time graph with ${phases.length} phases read from the question`, "vt_graph");
  scene.axes("axes", -0.05 * totalTime, 1.12 * totalTime, -0.08 * vMax * k, 1.25 * vMax * k, "v-t axes", "v-t");
  const vertexIds: string[] = [];
  let t = 0;
  let v = 0;
  vertexIds.push(scene.point("p0", { x: 0, y: 0 }, "graph start", "0"));
  const phaseIds: string[] = [];
  for (const [index, phase] of phases.entries()) {
    t += phase.duration;
    v = phase.vEnd;
    const id = scene.point(`p${index + 1}`, { x: t, y: v * k }, `phase ${index + 1} end`, `(${fmt(t)} s, ${fmt(v)} m/s)`);
    vertexIds.push(id);
    const kind = phase.kind === "accelerate" ? "uniform acceleration" : phase.kind === "cruise" ? "constant velocity" : "uniform deceleration";
    phaseIds.push(scene.segment(`phase${index + 1}`, vertexIds[index]!, id, `phase ${index + 1}: ${kind}`, kind));
    scene.point(`foot${index + 1}`, { x: t, y: 0 }, `t=${fmt(t)} on the axis`, `t=${fmt(t)} s`);
    if (v > 1e-9) scene.segment(`drop${index + 1}`, id, `foot${index + 1}`, "ordinate to the time axis");
  }
  const drops = phases.map((phase, index) => (phase.vEnd > 1e-9 ? `drop${index + 1}` : null)).filter((id): id is string => id !== null);
  scene.polygon("area", [...vertexIds, `foot${phases.length}`], "area under the graph = distance");
  scene.point("origin_ref", { x: 0, y: 0 }, "origin reference");
  scene.assert("time_ratio", "distance_ratio", ["origin_ref", "foot1", "origin_ref", `foot${phases.length}`], Number((phases[0]!.duration / totalTime).toFixed(6)));
  if (phases.length > 1) {
    scene.assert("ordered", "ordered_along", vertexIds, { axis: "x", direction: "increasing" });
  }
  scene.labelled("axes", "p1");
  scene.group("axes_group", ["axes", "p0"], "velocity on the vertical axis, time on the horizontal");
  scene.group("graph", [...vertexIds.slice(1), ...phaseIds, ...phases.map((_, index) => `foot${index + 1}`), ...drops], "each phase of the motion as one straight piece", ["axes_group"]);
  scene.group("area_group", ["area", "origin_ref"], "the area under the graph is the distance travelled", ["graph"]);
  return scene.build();
}

/* ------------------------------------------------------------------------- */

function xtGraph(context: GeneratorContext) {
  const expression = text(context, "expression");
  if (!expression) return null;
  const tMax = Math.max(num(context, "tMax", 4), 0.5);
  const range = sampleRange([expression], 0, tMax, 41);
  if (!range) return null;
  const k = displayFactor(tMax, range.yMin, range.yMax);
  const span = Math.max(range.yMax - range.yMin, 1e-6) * k;
  const scene = new SceneBuilder(context.question, "position–time graph of the stated x(t)", "xt_graph");
  scene.axes("axes", -0.06 * tMax, 1.12 * tMax, range.yMin * k - 0.12 * span, range.yMax * k + 0.18 * span, "x-t axes", "x-t");
  scene.curve("graph", scaled(expression, k), 0, tMax, "x(t)", `x=${compactExpression(expression.replace(/\bx\b/g, "t"))}`, 65);
  const askedT = /(?:at|when)\s+t\s*=\s*(\d+(?:\.\d+)?)/i.exec(prepareStem(context.question));
  const t0 = askedT ? Number(askedT[1]) : tMax / 2;
  const x0 = evaluate(expression, t0);
  if (x0 !== null && t0 >= 0 && t0 <= tMax) {
    scene.point("P", { x: t0, y: x0 * k }, "marked instant", `t=${fmt(t0)} s, x=${fmt(x0)}`);
    if (Math.abs(x0) > 1e-9) {
      scene.point("P_foot", { x: t0, y: 0 }, "instant on the axis");
      scene.segment("P_drop", "P", "P_foot", "ordinate at the marked instant");
    }
    scene.assert("point_on_graph", "function_value", ["graph"], { x: Number(t0.toFixed(6)), y: Number((x0 * k).toFixed(6)) });
    if (/\b(?:velocity|slope|speed)\b/i.test(context.question) && t0 > 0.02 * tMax && t0 < 0.98 * tMax) {
      scene.tangent("slope", "graph", t0, "tangent at the instant: slope = velocity", "slope=v", Math.min(1.2, tMax / 3));
    }
  }
  scene.labelled("axes", "graph");
  return scene.build();
}

function fxGraphArea(context: GeneratorContext) {
  const expression = text(context, "expression");
  if (!expression) return null;
  const from = num(context, "from", 0);
  const to = num(context, "to", from + 4);
  if (to <= from) return null;
  const range = sampleRange([expression], from, to, 17);
  if (!range) return null;
  const k = displayFactor(to - from, range.yMin, range.yMax);
  const span = Math.max(range.yMax - range.yMin, 1e-6) * k;
  const pad = (to - from) * 0.25;
  const fTo = evaluate(expression, to);
  if (fTo === null) return null;
  const scene = new SceneBuilder(context.question, "force–displacement graph; the work done is the area under it", "fx_graph_area");
  scene.axes("axes", from - pad, to + pad, range.yMin * k - 0.15 * span, range.yMax * k + 0.2 * span, "F-x axes", "F-x");
  scene.curve("force", scaled(expression, k), from - pad * 0.5, to + pad * 0.3, "F(x)", `F=${compactExpression(expression)}`, 65);
  scene.curve("zero", "0", from, to, "x-axis under the region", undefined, 17);
  scene.region("work", "force", "zero", "work done = area under F(x)", from, to);
  scene.point("x_from", { x: from, y: 0 }, "lower limit", `x=${fmt(from)}`);
  scene.point("x_to", { x: to, y: 0 }, "upper limit", `x=${fmt(to)}`);
  scene.point("F_to", { x: to, y: fTo * k }, "force at the upper limit", `F=${fmt(fTo)}`);
  scene.assert("f_at_upper", "function_value", ["force"], { x: Number(to.toFixed(6)), y: Number((fTo * k).toFixed(6)) });
  scene.assert("limits_ordered", "ordered_along", ["x_from", "x_to"], { axis: "x", direction: "increasing" });
  scene.labelled("axes", "force");
  return scene.build();
}

function waveProfile(context: GeneratorContext) {
  const equation = text(context, "expression");
  let amplitude = maybeNum(context, "amplitude");
  let wavelength = maybeNum(context, "wavelength");
  let ampSource = context.sources.amplitude;
  let lamSource = context.sources.wavelength;
  if (equation) {
    const match = /(\d+(?:\.\d+)?)\s*\*?\s*(?:sin|cos)\s*\(?\s*(\d+(?:\.\d+)?)\s*\*?\s*x/i.exec(equation.replace(/\s+/g, ""))
      ?? /(\d+(?:\.\d+)?)\s*(?:sin|cos)\s*\(?\s*(\d+(?:\.\d+)?)\s*x/i.exec(equation);
    if (match) {
      amplitude = Number(match[1]);
      wavelength = 2 * Math.PI / Number(match[2]);
      ampSource = "stem";
      lamSource = "stem";
    }
  }
  const A = amplitude ?? 1;
  const lambda = wavelength ?? 4;
  const k = displayFactor(2 * lambda, -A, A);
  const expression = scaled(`${A}*sin(${2 * Math.PI / lambda}*x)`, k);
  const unit = /\bcm\b/.test(context.question) && A > 0.5 ? "cm" : "m";
  const scene = new SceneBuilder(context.question, "one wavelength of the wave with amplitude and wavelength marked", "wave_profile");
  scene.axes("axes", -0.1 * lambda, 2.15 * lambda, -1.6 * A * k, 1.6 * A * k, "displacement–position axes", "y-x");
  scene.curve("wave", expression, 0, 2 * lambda, "wave profile", undefined, 97);
  scene.point("crest", { x: lambda / 4, y: A * k }, "crest", "crest");
  scene.point("crest_foot", { x: lambda / 4, y: 0 }, "crest foot");
  scene.dimension("amp", "crest_foot", "crest", "amplitude", ampSource === "plan" || ampSource === "stem" ? `A=${withUnit(A, unit)}` : "A");
  scene.point("lam_a", { x: 0, y: -1.3 * A * k }, "wavelength start");
  scene.point("lam_b", { x: lambda, y: -1.3 * A * k }, "wavelength end");
  scene.dimension("lam", "lam_a", "lam_b", "wavelength", lamSource === "plan" || lamSource === "stem" ? `λ=${withUnit(lambda, unit)}` : "λ");
  scene.point("trough", { x: 3 * lambda / 4, y: -A * k }, "trough", "trough");
  scene.assert("crest_on_wave", "function_value", ["wave"], { x: Number((lambda / 4).toFixed(6)), y: Number((A * k).toFixed(6)) });
  scene.assert("trough_on_wave", "function_value", ["wave"], { x: Number((3 * lambda / 4).toFixed(6)), y: Number((-A * k).toFixed(6)) });
  scene.labelled("amp", "lam");
  return scene.build();
}

function standingWave(context: GeneratorContext) {
  const harmonic = Math.max(1, Math.min(6, Math.round(num(context, "harmonic", 1))));
  const ends = text(context, "ends", "fixed");
  const L = 6;
  const A = 1;
  const factor = ends === "closed_open" ? (2 * harmonic - 1) / 2 : harmonic;
  const phase = ends === "open" ? "cos" : "sin";
  const expression = `${A}*${phase}(${(factor * Math.PI / L)}*x)`;
  const mirrored = `-${A}*${phase}(${(factor * Math.PI / L)}*x)`;
  const scene = new SceneBuilder(context.question, `standing wave, harmonic ${harmonic}, with its nodes and antinodes`, "standing_wave");
  scene.axes("axes", -0.3, L + 0.5, -1.6, 1.6, "displacement axes", "y-x");
  scene.curve("wave", expression, 0, L, "wave envelope", `n=${harmonic}`, 97);
  scene.curve("wave_mirror", mirrored, 0, L, "wave envelope (half period later)", undefined, 97);
  const nodes: number[] = [];
  const antinodes: number[] = [];
  const step = L / factor;
  for (let x = 0; x <= L + 1e-9; x += step / 2) {
    const value = evaluate(expression, x) ?? 0;
    if (Math.abs(value) < 1e-6) nodes.push(x); else antinodes.push(x);
  }
  nodes.forEach((x, index) => scene.point(`node${index}`, { x, y: 0 }, "node", index === 0 ? "N" : undefined));
  antinodes.forEach((x, index) => scene.point(`antinode${index}`, { x, y: evaluate(expression, x) ?? A }, "antinode", index === 0 ? "A" : undefined));
  scene.point("end_l", { x: 0, y: -1.3 }, "length start");
  scene.point("end_r", { x: L, y: -1.3 }, "length end");
  scene.dimension("length", "end_l", "end_r", "length", grounded(context, "length") ? `L=${withUnit(num(context, "length", 1), "m")}` : "L");
  if (antinodes[0] !== undefined) {
    scene.assert("antinode_on_wave", "function_value", ["wave"], { x: Number(antinodes[0].toFixed(6)), y: Number((evaluate(expression, antinodes[0]) ?? A).toFixed(6)) });
  }
  scene.labelled("wave", "length");
  return scene.build();
}

/* ------------------------------------------------------------------------- */
/* P–V cycles from named processes                                            */
/* ------------------------------------------------------------------------- */

type ProcessKind = "isobaric" | "isochoric" | "isothermal" | "adiabatic";
interface Process { kind: ProcessKind; from: string; to: string; grows: boolean | null }
const GAMMA = 1.4;

export function parseProcesses(question: string): Process[] {
  const stem = prepareStem(question);
  const found: Process[] = [];
  const pattern = /\b(isobaric|isochoric|isovolumetric|isothermal|adiabatic)\b([^.;]{0,80}?)(?:from\s+)?\b([A-D])\b\s*(?:to|→|->|—|-)\s*\b([A-D])\b/gi;
  for (const match of stem.matchAll(pattern)) {
    const kindRaw = match[1]!.toLowerCase();
    const kind: ProcessKind = kindRaw === "isovolumetric" ? "isochoric" : kindRaw as ProcessKind;
    const words = match[2] ?? "";
    const grows = /expan|heat|increas/i.test(words) ? true : /compress|cool|decreas/i.test(words) ? false : null;
    found.push({ kind, from: match[3]!.toUpperCase(), to: match[4]!.toUpperCase(), grows });
  }
  if (found.length === 0) {
    const cycle = /\b([A-D])\s*(?:to|→|->)\s*([A-D])\s*(?:to|→|->)\s*([A-D])(?:\s*(?:to|→|->)\s*([A-D]))?/i.exec(stem);
    const kinds = [...stem.matchAll(/\b(isobaric|isochoric|isovolumetric|isothermal|adiabatic)\b/gi)].map((match) => (match[1]!.toLowerCase() === "isovolumetric" ? "isochoric" : match[1]!.toLowerCase()) as ProcessKind);
    if (cycle && kinds.length >= 2) {
      const states = [cycle[1], cycle[2], cycle[3], cycle[4]].filter((state): state is string => Boolean(state)).map((state) => state.toUpperCase());
      for (let index = 0; index < states.length - 1 && index < kinds.length; index += 1) {
        found.push({ kind: kinds[index]!, from: states[index]!, to: states[index + 1]!, grows: null });
      }
    }
  }
  return found;
}

function intersect(kindA: ProcessKind, through: { V: number; P: number }, kindB: ProcessKind, anchor: { V: number; P: number }): { V: number; P: number } | null {
  const constant = (kind: ProcessKind, state: { V: number; P: number }): number =>
    kind === "isobaric" ? state.P : kind === "isochoric" ? state.V : kind === "isothermal" ? state.P * state.V : state.P * state.V ** GAMMA;
  const a = constant(kindA, through);
  const b = constant(kindB, anchor);
  const pair = [kindA, kindB].sort().join("+");
  switch (pair) {
    case "isobaric+isochoric": return kindA === "isobaric" ? { V: b, P: a } : { V: a, P: b };
    case "isobaric+isothermal": return kindA === "isobaric" ? { V: b / a, P: a } : { V: a / b, P: b };
    case "isochoric+isothermal": return kindA === "isochoric" ? { V: a, P: b / a } : { V: b, P: a / b };
    case "adiabatic+isobaric": return kindA === "isobaric" ? { V: (b / a) ** (1 / GAMMA), P: a } : { V: (a / b) ** (1 / GAMMA), P: b };
    case "adiabatic+isochoric": return kindA === "isochoric" ? { V: a, P: b / a ** GAMMA } : { V: b, P: a / b ** GAMMA };
    case "adiabatic+isothermal": {
      const isoC = kindA === "isothermal" ? a : b;
      const adiC = kindA === "adiabatic" ? a : b;
      const V = (adiC / isoC) ** (1 / (GAMMA - 1));
      return { V, P: isoC / V };
    }
    default: return null;
  }
}

function pvCycle(context: GeneratorContext) {
  const processes = parseProcesses(text(context, "processes", context.question));
  if (processes.length < 2) return null;
  const states = new Map<string, { V: number; P: number }>();
  const first = processes[0]!;
  states.set(first.from, { V: 2, P: 2 });
  const closed = processes.at(-1)!.to === first.from;
  const lastIndex = closed ? processes.length - 1 : processes.length;
  for (let index = 0; index < lastIndex; index += 1) {
    const process = processes[index]!;
    const start = states.get(process.from);
    if (!start) return null;
    if (states.has(process.to)) continue;
    const grows = process.grows ?? (index % 2 === 0);
    const factor = grows ? 1.9 : 1 / 1.9;
    const next = process.kind === "isobaric" ? { V: start.V * factor, P: start.P }
      : process.kind === "isochoric" ? { V: start.V, P: start.P * factor }
        : process.kind === "isothermal" ? { V: start.V * factor, P: start.P / factor }
          : { V: start.V * factor, P: start.P / factor ** GAMMA };
    if (closed && index === lastIndex - 1) {
      const closing = processes[lastIndex]!;
      const solved = intersect(process.kind, start, closing.kind, states.get(first.from)!);
      if (!solved || solved.V <= 0 || solved.P <= 0) return null;
      states.set(process.to, solved);
    } else {
      states.set(process.to, next);
    }
  }
  const values = [...states.values()];
  const vMax = Math.max(...values.map((state) => state.V));
  const pMax = Math.max(...values.map((state) => state.P));
  const scene = new SceneBuilder(context.question, `P–V diagram built from the ${processes.length} named processes`, "pv_cycle");
  scene.axes("axes", 0, 1.25 * vMax, 0, 1.25 * pMax, "P-V axes", "P-V");
  for (const [label, state] of states) scene.point(label, { x: state.V, y: state.P }, `state ${label}`, label);
  processes.forEach((process, index) => {
    const start = states.get(process.from);
    const end = states.get(process.to);
    if (!start || !end) return;
    const id = `proc${index + 1}`;
    if (process.kind === "isobaric" || process.kind === "isochoric") {
      scene.segment(id, process.from, process.to, `process ${process.from}${process.to}: ${process.kind}`, process.kind);
    } else {
      const constant = process.kind === "isothermal" ? start.P * start.V : start.P * start.V ** GAMMA;
      const expression = process.kind === "isothermal" ? `${constant}/x` : `${constant}/x^${GAMMA}`;
      scene.curve(id, expression, Math.min(start.V, end.V), Math.max(start.V, end.V), `process ${process.from}${process.to}: ${process.kind}`, process.kind, 33);
      const midV = (start.V + end.V) / 2;
      scene.assert(`${id}_law`, "function_value", [id], { x: Number(midV.toFixed(6)), y: Number((process.kind === "isothermal" ? constant / midV : constant / midV ** GAMMA).toFixed(6)) });
    }
    scene.point(`${id}_dir`, { x: (start.V + end.V) / 2, y: (start.P + end.P) / 2 }, "process midpoint");
    const dx = end.V - start.V;
    const dy = end.P - start.P;
    const norm = Math.hypot(dx, dy) || 1;
    scene.vector(`${id}_arrow`, `${id}_dir`, { direction: { x: dx / norm, y: dy / norm }, length: 0.12 * Math.max(vMax, pMax) }, "direction of the process");
  });
  scene.assert("states_labelled", "label_attached", [first.from], true);
  scene.labelled("axes");
  return scene.build();
}

/* ------------------------------------------------------------------------- */

function functionGraph(context: GeneratorContext) {
  const expressions = (context.slots.expressions as string[] | undefined) ?? explicitFunctions(context.question);
  if (!expressions?.length) return null;
  const xMin = num(context, "xMin", -3);
  const xMax = num(context, "xMax", xMin + 6);
  if (xMax <= xMin) return null;
  const range = sampleRange(expressions, xMin, xMax, 25);
  if (!range) return null;
  const k = displayFactor(xMax - xMin, range.yMin, range.yMax);
  const span = Math.max(range.yMax - range.yMin, 1e-6) * k;
  const scene = new SceneBuilder(context.question, "graph of the stated function", "function_graph");
  scene.axes("axes", xMin - 0.1 * (xMax - xMin), xMax + 0.1 * (xMax - xMin), range.yMin * k - 0.1 * span, range.yMax * k + 0.15 * span, "coordinate axes");
  expressions.forEach((expression, index) => {
    scene.curve(`curve${index + 1}`, scaled(expression, k), xMin, xMax, "curve", `y=${compactExpression(expression)}`, 65);
    const x = xMin + (xMax - xMin) * (0.35 + 0.2 * index);
    const y = evaluate(expression, x);
    if (y !== null) scene.assert(`curve${index + 1}_value`, "function_value", [`curve${index + 1}`], { x: Number(x.toFixed(6)), y: Number((y * k).toFixed(6)) });
  });
  scene.labelled("curve1");
  return scene.build();
}

function tangentToCurve(context: GeneratorContext) {
  const expression = text(context, "expression");
  const x0 = maybeNum(context, "x0");
  if (!expression || x0 === null) return null;
  const y0 = evaluate(expression, x0);
  if (y0 === null) return null;
  const half = 1.6;
  const range = sampleRange([expression], x0 - half, x0 + half, 25);
  if (!range) return null;
  const k = displayFactor(2 * half, range.yMin, range.yMax);
  const span = Math.max(range.yMax - range.yMin, 1e-6) * k;
  const scene = new SceneBuilder(context.question, `curve with its tangent at x=${fmt(x0)}`, "tangent_to_curve");
  scene.axes("axes", x0 - half - 0.5, x0 + half + 0.5, range.yMin * k - 0.1 * span, range.yMax * k + 0.15 * span, "coordinate axes");
  scene.curve("curve", scaled(expression, k), x0 - half, x0 + half, "curve", `y=${compactExpression(expression)}`, 81);
  scene.point("P", { x: x0, y: y0 * k }, "point of tangency", `(${fmt(x0)}, ${fmt(y0)})`);
  scene.tangent("tangent", "curve", x0, "tangent at P", "tangent", Math.min(2.2, half * 0.7));
  scene.assert("p_on_curve", "function_value", ["curve"], { x: Number(x0.toFixed(6)), y: Number((y0 * k).toFixed(6)) });
  scene.assert("p_on_tangent", "on", ["P", "tangent"]);
  scene.labelled("P", "tangent");
  return scene.build();
}

function areaBetweenCurves(context: GeneratorContext) {
  const expressions = ((context.slots.expressions as string[] | undefined) ?? explicitFunctions(context.question)).slice(0, 2);
  if (expressions.length === 0) return null;
  const [f, g = "0"] = expressions as [string, string?];
  const difference = (x: number): number | null => {
    const a = evaluate(f, x);
    const b = evaluate(g, x);
    return a === null || b === null ? null : a - b;
  };
  let xMin = maybeNum(context, "xMin");
  let xMax = maybeNum(context, "xMax");
  if (xMin === null || xMax === null) {
    const roots: number[] = [];
    let previous = difference(-6);
    for (let x = -6 + 0.05; x <= 6 && roots.length < 4; x += 0.05) {
      const current = difference(x);
      if (previous !== null && current !== null && Math.sign(previous) !== Math.sign(current)) {
        let lo = x - 0.05;
        let hi = x;
        for (let step = 0; step < 40; step += 1) {
          const mid = (lo + hi) / 2;
          const value = difference(mid);
          if (value === null) break;
          if (Math.sign(value) === Math.sign(previous)) lo = mid; else hi = mid;
        }
        roots.push((lo + hi) / 2);
      }
      previous = current;
    }
    if (roots.length < 2) return null;
    xMin = roots[0]!;
    xMax = roots[1]!;
  }
  if (xMax <= xMin) return null;
  const mid = (xMin + xMax) / 2;
  const upperIsF = (difference(mid) ?? 0) >= 0;
  const upper = upperIsF ? f : g;
  const lower = upperIsF ? g : f;
  const pad = (xMax - xMin) * 0.35;
  const range = sampleRange([f, g], xMin - pad * 0.8, xMax + pad * 0.8, 17);
  if (!range) return null;
  const k = displayFactor(xMax - xMin + 1.6 * pad, range.yMin, range.yMax);
  const span = Math.max(range.yMax - range.yMin, 1e-6) * k;
  const scene = new SceneBuilder(context.question, "region enclosed between the curves with its intersections", "area_between_curves");
  scene.axes("axes", xMin - pad, xMax + pad, range.yMin * k - 0.1 * span, range.yMax * k + 0.15 * span, "coordinate axes");
  scene.curve("upper", scaled(upper, k), xMin - pad * 0.8, xMax + pad * 0.8, "upper curve", `y=${compactExpression(upper)}`, 65);
  scene.curve("lower", scaled(lower, k), xMin - pad * 0.8, xMax + pad * 0.8, "lower curve", `y=${compactExpression(lower)}`, 65);
  scene.region("region", "upper", "lower", "enclosed region", xMin, xMax);
  const yA = evaluate(f, xMin);
  const yB = evaluate(f, xMax);
  const near = (value: number): number => (Math.abs(value) < 1e-9 ? 0 : value);
  if (yA !== null) scene.point("A", { x: xMin, y: yA * k }, "intersection", `(${fmt(near(xMin))}, ${fmt(near(yA))})`);
  if (yB !== null) scene.point("B", { x: xMax, y: yB * k }, "intersection", `(${fmt(near(xMax))}, ${fmt(near(yB))})`);
  if (yA !== null) scene.assert("a_on_upper", "function_value", ["upper"], { x: Number(xMin.toFixed(6)), y: Number(((evaluate(upper, xMin) ?? yA) * k).toFixed(6)) });
  if (yB !== null) scene.assert("b_on_lower", "function_value", ["lower"], { x: Number(xMax.toFixed(6)), y: Number(((evaluate(lower, xMax) ?? yB) * k).toFixed(6)) });
  scene.labelled("upper", "lower");
  return scene.build();
}

export const GRAPH_GENERATORS: GeneratorTable = {
  vt_graph: vtGraph,
  xt_graph: xtGraph,
  fx_graph_area: fxGraphArea,
  wave_profile: waveProfile,
  standing_wave: standingWave,
  pv_cycle: pvCycle,
  function_graph: functionGraph,
  tangent_to_curve: tangentToCurve,
  area_between_curves: areaBetweenCurves,
};
