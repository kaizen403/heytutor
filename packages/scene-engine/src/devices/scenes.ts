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

export function diodeClipperScene(question: string): { document: SceneDocument; device: DeviceInstance } {
  const device: DeviceInstance = { kind: "diode", terminalNodes: { anode: "tr", cathode: "br" }, wiredNodes: new Set(["tl", "tr", "br", "bl"]), forwardFrom: "anode" };
  return { document: loopDocument(question, "diode clipper: source, series path and a diode shunt", "diode", "diode", "D", "resistor"), device };
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
