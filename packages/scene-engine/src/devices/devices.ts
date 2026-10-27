/**
 * Semiconductor device definitions: named terminals, glyph geometry and
 * connectivity and polarity assertions. Pure and dependency free so a gate
 * can prove the rules before any compiler wiring exists. A device whose
 * terminals are missing, unwired, shorted together or reversed fails closed:
 * the assertion list names every problem and the caller must draw nothing.
 */

export interface Pt { x: number; y: number }

export type DeviceKind = "bjt_npn" | "bjt_pnp" | "diode" | "zener" | "opamp" | "capacitor" | "capacitor_polarised";

export interface TerminalSpec { name: string; label: string }

export interface DeviceSpec {
  kind: DeviceKind;
  label: string;
  terminals: readonly TerminalSpec[];
  /** Terminal pairs that must never sit on the same node. */
  distinctPairs: readonly (readonly [string, string])[];
}

const pair = (a: string, b: string) => [a, b] as const;

export const DEVICE_SPECS: Readonly<Record<DeviceKind, DeviceSpec>> = {
  bjt_npn: { kind: "bjt_npn", label: "NPN transistor", terminals: [{ name: "base", label: "B" }, { name: "collector", label: "C" }, { name: "emitter", label: "E" }], distinctPairs: [pair("base", "collector"), pair("base", "emitter"), pair("collector", "emitter")] },
  bjt_pnp: { kind: "bjt_pnp", label: "PNP transistor", terminals: [{ name: "base", label: "B" }, { name: "collector", label: "C" }, { name: "emitter", label: "E" }], distinctPairs: [pair("base", "collector"), pair("base", "emitter"), pair("collector", "emitter")] },
  diode: { kind: "diode", label: "Diode", terminals: [{ name: "anode", label: "A" }, { name: "cathode", label: "K" }], distinctPairs: [pair("anode", "cathode")] },
  zener: { kind: "zener", label: "Zener diode", terminals: [{ name: "anode", label: "A" }, { name: "cathode", label: "K" }], distinctPairs: [pair("anode", "cathode")] },
  opamp: { kind: "opamp", label: "Operational amplifier", terminals: [{ name: "inverting", label: "−" }, { name: "noninverting", label: "+" }, { name: "output", label: "OUT" }, { name: "supply_positive", label: "+Vs" }, { name: "supply_negative", label: "−Vs" }], distinctPairs: [pair("noninverting", "output"), pair("supply_positive", "supply_negative"), pair("supply_positive", "output"), pair("supply_negative", "output")] },
  capacitor: { kind: "capacitor", label: "Capacitor", terminals: [{ name: "plate_a", label: "A" }, { name: "plate_b", label: "B" }], distinctPairs: [pair("plate_a", "plate_b")] },
  capacitor_polarised: { kind: "capacitor_polarised", label: "Polarised capacitor", terminals: [{ name: "positive", label: "+" }, { name: "negative", label: "−" }], distinctPairs: [pair("positive", "negative")] },
};

export interface DeviceInstance {
  kind: DeviceKind;
  /** Terminal name to the circuit node it is wired to. Null or absent means unwired. */
  terminalNodes: Readonly<Record<string, string | null | undefined>>;
  /** Nodes that carry at least one wire or component lead. */
  wiredNodes: ReadonlySet<string>;
  /** Declared emitter arrow for a BJT: out of the base for NPN, into it for PNP. */
  emitterArrow?: "out" | "in";
  /** Declared forward direction for a diode or zener, anode to cathode. */
  forwardFrom?: string;
}

export interface DeviceIssue { code: string; message: string }

export function assertDevice(instance: DeviceInstance): DeviceIssue[] {
  const spec = DEVICE_SPECS[instance.kind];
  const issues: DeviceIssue[] = [];
  for (const terminal of spec.terminals) {
    const node = instance.terminalNodes[terminal.name];
    if (node == null || node === "") issues.push({ code: "terminal_unwired", message: `${spec.label} terminal ${terminal.name} is not assigned to a node` });
    else if (!instance.wiredNodes.has(node)) issues.push({ code: "terminal_unwired", message: `${spec.label} terminal ${terminal.name} sits on node ${node}, which has no wire` });
  }
  for (const [a, b] of spec.distinctPairs) {
    const na = instance.terminalNodes[a]; const nb = instance.terminalNodes[b];
    if (na != null && na !== "" && na === nb) issues.push({ code: "terminals_shorted", message: `${spec.label} terminals ${a} and ${b} share node ${na}` });
  }
  if (instance.kind === "bjt_npn" || instance.kind === "bjt_pnp") {
    const expected = instance.kind === "bjt_npn" ? "out" : "in";
    if (instance.emitterArrow !== expected) issues.push({ code: "polarity_reversed", message: `${spec.label} emitter arrow must point ${expected}, got ${instance.emitterArrow ?? "none"}` });
  }
  if (instance.kind === "diode" || instance.kind === "zener") {
    if (instance.forwardFrom !== "anode") issues.push({ code: "polarity_reversed", message: `${spec.label} forward direction must start at the anode, got ${instance.forwardFrom ?? "none"}` });
  }
  if (instance.kind === "capacitor_polarised") {
    const pos = instance.terminalNodes.positive; const neg = instance.terminalNodes.negative;
    if (pos != null && pos === neg) issues.push({ code: "polarity_reversed", message: "Polarised capacitor positive and negative terminals coincide" });
  }
  return issues;
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const len = (a: Pt): number => Math.hypot(a.x, a.y);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };

/** Two terminal glyph along the start to end axis, in the compiler glyph style. */
export function twoTerminalGlyph(kind: "diode" | "zener" | "capacitor" | "capacitor_polarised", start: Pt, end: Pt): Pt[][] {
  const d = unit(sub(end, start)); const n = { x: -d.y, y: d.x }; const span = len(sub(end, start));
  const at = (t: number, off = 0): Pt => add(add(start, mul(d, t * span)), mul(n, off * span));
  if (kind === "capacitor" || kind === "capacitor_polarised") {
    const plates: Pt[][] = [[at(0), at(0.43)], [at(0.43, -0.17), at(0.43, 0.17)], [at(0.57, -0.17), at(0.57, 0.17)], [at(0.57), at(1)]];
    if (kind === "capacitor_polarised") {
      // A plus mark on the positive (start) side; plain capacitors stay unmarked.
      const c = at(0.22);
      const arm = 0.05 * span;
      plates.push([add(c, { x: -arm, y: 0 }), add(c, { x: arm, y: 0 })], [add(c, { x: 0, y: -arm }), add(c, { x: 0, y: arm })]);
    }
    return plates;
  }
  const cathode = kind === "zener" ? [at(0.64, -0.17), at(0.68, -0.11), at(0.68, 0.11), at(0.72, 0.17)] : [at(0.68, -0.17), at(0.68, 0.17)];
  return [[at(0), at(0.32)], [at(0.32, -0.16), at(0.32, 0.16), at(0.68), at(0.32, -0.16)], cathode, [at(0.68), at(1)]];
}

/**
 * BJT glyph: the collector and emitter leads meet a base bar, the base lead
 * joins the middle of the bar, and the emitter arrow sits on the emitter
 * lead, pointing out for NPN and in for PNP.
 */
export function bjtGlyph(kind: "bjt_npn" | "bjt_pnp", base: Pt, collector: Pt, emitter: Pt): Pt[][] {
  const barX = (base.x + collector.x) / 2;
  const collectorIn = { x: barX, y: collector.y - Math.sign(collector.y - emitter.y) * Math.abs(collector.y - emitter.y) * 0.15 };
  const emitterIn = { x: barX, y: emitter.y + Math.sign(collector.y - emitter.y) * Math.abs(collector.y - emitter.y) * 0.15 };
  const barMid = mul(add(collectorIn, emitterIn), 0.5);
  const paths: Pt[][] = [[base, barMid], [collector, collectorIn], [emitter, emitterIn], [collectorIn, emitterIn]];
  const leadDir = unit(sub(emitter, emitterIn));
  const arrowAt = add(emitterIn, mul(leadDir, len(sub(emitter, emitterIn)) * 0.5));
  const back = mul(leadDir, (kind === "bjt_npn" ? -1 : 1) * 0.12 * (len(sub(emitter, emitterIn)) || 1));
  const side = mul({ x: -leadDir.y, y: leadDir.x }, 0.06 * (len(sub(emitter, emitterIn)) || 1));
  paths.push([add(add(arrowAt, back), side), arrowAt, add(add(arrowAt, back), mul(side, -1))]);
  return paths;
}

/**
 * Op amp glyph: triangle from the two input terminals to the output, with a
 * minus mark at the inverting input and a plus mark at the noninverting
 * input, so swapping the inputs changes the ink.
 */
export function opampGlyph(inverting: Pt, noninverting: Pt, output: Pt): Pt[][] {
  const mid = mul(add(inverting, noninverting), 0.5);
  const mark = (at: Pt, plus: boolean): Pt[][] => {
    const arm = Math.max(0.12, len(sub(output, at)) * 0.06);
    const centre = add(at, mul(unit(sub(at, output)), arm * 1.4));
    const h: Pt[] = [add(centre, { x: -arm, y: 0 }), add(centre, { x: arm, y: 0 })];
    return plus ? [h, [add(centre, { x: 0, y: -arm }), add(centre, { x: 0, y: arm })]] : [h];
  };
  return [[inverting, noninverting, output, inverting], [inverting, mid], [noninverting, mid], ...mark(inverting, false), ...mark(noninverting, true)];
}
