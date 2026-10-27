/**
 * Scene builders for the electronics topics that the existing two terminal
 * symbols can already prove: a diode clipper and a capacitor diode clamper.
 * A BJT has three named terminals and no three terminal symbol exists yet,
 * so its builder declines (null) rather than letting a stock resistor
 * network stand in. Callers must teach text only on null.
 */
import type { SceneDocument } from "../types";
import { assertDevice, type DeviceInstance } from "./devices";

function loopDocument(question: string, reason: string, rightSymbol: string, rightRole: string, rightLabel: string, bottomSymbol?: string): SceneDocument {
  const points = [
    { id: "tl", x: 0, y: 2 }, { id: "tr", x: 5, y: 2 },
    { id: "br", x: 5, y: 0 }, { id: "bl", x: 0, y: 0 },
    ...(bottomSymbol ? [{ id: "bm", x: 2.5, y: 0 }] : []),
  ];
  const ids = [...points.map((p) => p.id), "source", "device", "top", "bottom", ...(bottomSymbol ? ["load"] : [])];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason },
    source: { question, representationTier: "qualitative_verified", nonMetric: true },
    quantities: [],
    entities: [
      ...points.map((p) => ({ id: p.id, kind: "point" as const, role: "node" })),
      { id: "source", kind: "component", role: "source", label: "Vin" },
      { id: "device", kind: "component", role: rightRole, label: rightLabel },
      { id: "top", kind: "connector", role: "wire" },
      { id: "bottom", kind: "connector", role: "wire" },
      ...(bottomSymbol ? [{ id: "load", kind: "component" as const, role: "resistor", label: "R" }] : []),
    ],
    constructions: [
      ...points.map((p) => ({ id: `make_${p.id}`, operator: "point", inputs: { x: p.x, y: p.y, coordinateSpace: "world" }, outputs: [p.id] })),
      { id: "make_source", operator: "symbol", inputs: { symbol: "ac_source", start: "bl", end: "tl" }, outputs: ["source"] },
      { id: "make_device", operator: "symbol", inputs: { symbol: rightSymbol, start: "tr", end: "br" }, outputs: ["device"] },
      { id: "make_top", operator: "connect", inputs: { start: "tl", end: "tr" }, outputs: ["top"] },
      ...(bottomSymbol
        ? [
            { id: "make_load", operator: "symbol", inputs: { symbol: bottomSymbol, start: "br", end: "bm" }, outputs: ["load"] },
            { id: "make_bottom", operator: "connect", inputs: { start: "bm", end: "bl" }, outputs: ["bottom"] },
          ]
        : [
            { id: "make_bottom", operator: "connect", inputs: { start: "br", end: "bl" }, outputs: ["bottom"] },
          ]),
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "circuit", entityIds: ids, dependsOn: [], narrationCue: reason }],
    teachingTimeline: [],
  } as unknown as SceneDocument;
}

/**
 * Shunt diode clipper: the source drives the load through a series resistor,
 * and the diode sits directly across the output terminals, clipping the
 * output at its forward drop. The diode terminals always match the load
 * terminals; anything else is not the circuit described.
 */
export function diodeClipperScene(question: string): { document: SceneDocument; device: DeviceInstance } {
  const reason = "shunt diode clipper: series source path with the diode across the output";
  const device: DeviceInstance = { kind: "diode", terminalNodes: { anode: "tr", cathode: "br" }, wiredNodes: new Set(["tl", "tr", "br", "bl"]), forwardFrom: "anode" };
  const points = [
    { id: "tl", x: 0, y: 2 }, { id: "tr", x: 5, y: 2 },
    { id: "br", x: 5, y: 0 }, { id: "bl", x: 0, y: 0 },
  ];
  const ids = [...points.map((p) => p.id), "source", "series", "load", "diode", "bottom"];
  const document = {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason },
    source: { question, representationTier: "qualitative_verified", nonMetric: true },
    quantities: [],
    entities: [
      ...points.map((p) => ({ id: p.id, kind: "point" as const, role: "node" })),
      { id: "source", kind: "component", role: "source", label: "Vin" },
      { id: "series", kind: "component", role: "resistor", label: "R" },
      { id: "load", kind: "component", role: "resistor", label: "RL" },
      { id: "diode", kind: "component", role: "diode", label: "D" },
      { id: "bottom", kind: "connector", role: "wire" },
    ],
    constructions: [
      ...points.map((p) => ({ id: `make_${p.id}`, operator: "point", inputs: { x: p.x, y: p.y, coordinateSpace: "world" }, outputs: [p.id] })),
      { id: "make_source", operator: "symbol", inputs: { symbol: "ac_source", start: "bl", end: "tl" }, outputs: ["source"] },
      { id: "make_series", operator: "symbol", inputs: { symbol: "resistor", start: "tl", end: "tr" }, outputs: ["series"] },
      { id: "make_load", operator: "symbol", inputs: { symbol: "resistor", start: "tr", end: "br" }, outputs: ["load"] },
      { id: "make_diode", operator: "symbol", inputs: { symbol: "diode", start: "tr", end: "br" }, outputs: ["diode"] },
      { id: "make_bottom", operator: "connect", inputs: { start: "br", end: "bl" }, outputs: ["bottom"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "circuit", entityIds: ids, dependsOn: [], narrationCue: reason }],
    teachingTimeline: [],
  } as unknown as SceneDocument;
  return { document, device };
}

/** The load sits across the output terminals, and the diode sits across it too. */
export function clipperLoadTerminals(document: SceneDocument): { load: [string, string]; diode: [string, string] } {
  const byOutput = new Map(document.constructions.map((c) => [String(c.outputs[0]), c]));
  const load = byOutput.get("load")!;
  const diode = byOutput.get("diode")!;
  return {
    load: [String((load.inputs as Record<string, unknown>).start), String((load.inputs as Record<string, unknown>).end)],
    diode: [String((diode.inputs as Record<string, unknown>).start), String((diode.inputs as Record<string, unknown>).end)],
  };
}

export function clamperScene(question: string): { document: SceneDocument; device: DeviceInstance } {
  const device: DeviceInstance = { kind: "capacitor", terminalNodes: { plate_a: "tr", plate_b: "br" }, wiredNodes: new Set(["tl", "tr", "br", "bl"]) };
  return { document: loopDocument(question, "clamper series capacitor path (the diode branch needs its own proven shunt figure)", "capacitor", "capacitor", "C"), device };
}

/** No proven three terminal symbol exists, so a transistor figure declines. */
export function bjtScene(_question: string): null { return null; }

export function deviceIssues(device: DeviceInstance): string[] {
  return assertDevice(device).map((issue) => issue.code);
}
