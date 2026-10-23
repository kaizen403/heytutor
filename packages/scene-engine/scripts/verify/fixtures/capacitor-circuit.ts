import type { SceneDocument, TurnPlanV3 } from "../../../src/index";

export const capacitorQuestion = "Sketch a closed electrical circuit containing one battery and one capacitor.";
export const capacitorPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question: capacitorQuestion,
  givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [],
  assumptions: [], visualRequirement: "required",
};

/** Public synthetic circuit: the capacitor's point IDs are its outer terminals. */
export function capacitorCircuit(): SceneDocument {
  const points = [
    { id: "A", x: 0, y: 2 }, { id: "B", x: 0, y: 0 },
    { id: "C", x: 4, y: 2 }, { id: "D", x: 4, y: 0 },
  ];
  const ids = [...points.map(({ id }) => id), "battery", "capacitor", "top", "bottom"];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "A synthetic two-terminal capacitor loop" },
    source: { question: capacitorQuestion, representationTier: "qualitative_verified", nonMetric: true },
    quantities: [],
    entities: [
      ...points.map(({ id }) => ({ id, kind: "point" as const, role: "node" })),
      { id: "battery", kind: "component", role: "source", label: "E" },
      { id: "capacitor", kind: "component", role: "capacitor", label: "C" },
      { id: "top", kind: "connector", role: "wire" },
      { id: "bottom", kind: "connector", role: "wire" },
    ],
    constructions: [
      ...points.map(({ id, x, y }) => ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] })),
      { id: "make_battery", operator: "symbol", inputs: { symbol: "battery", start: "A", end: "B" }, outputs: ["battery"] },
      { id: "make_capacitor", operator: "symbol", inputs: { symbol: "capacitor", start: "C", end: "D" }, outputs: ["capacitor"] },
      { id: "make_top", operator: "connect", inputs: { start: "A", end: "C" }, outputs: ["top"] },
      { id: "make_bottom", operator: "connect", inputs: { start: "B", end: "D" }, outputs: ["bottom"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "circuit", entityIds: ids, dependsOn: [], narrationCue: "circuit" }], teachingTimeline: [],
  };
}

export function freeCapacitorPlates(): SceneDocument {
  const document = capacitorCircuit();
  document.entities = document.entities.filter(({ id }) => id !== "capacitor");
  document.entities.push({ id: "plate1", kind: "segment", role: "capacitor plate" }, { id: "plate2", kind: "segment", role: "capacitor plate" });
  document.constructions = document.constructions.filter(({ id }) => id !== "make_capacitor");
  document.constructions.push(
    { id: "make_plate1", operator: "segment", inputs: { start: [3, 1.2], end: [5, 1.2] }, outputs: ["plate1"] },
    { id: "make_plate2", operator: "segment", inputs: { start: [3, 0.8], end: [5, 0.8] }, outputs: ["plate2"] },
  );
  document.requiredEntityIds = document.requiredEntityIds.filter((id) => id !== "capacitor");
  document.requiredEntityIds.push("plate1", "plate2");
  document.revealGroups[0]!.entityIds = [...document.requiredEntityIds];
  return document;
}

/**
 * A capacitor drawn twice: `symbol capacitor` already draws both plates, and
 * free segments wired to circuit terminals draw them again.
 * K: plates hang off the symbol's own terminals.
 * N: the symbol spans the plate ends, so each plate starts on a terminal.
 * recorded: the shape of a recorded repair response (plates top and bottom,
 * symbol capacitor down the left side, battery wired to the plate corners).
 */
/** Plates drawn as rectangles centred on the capacitor symbol's terminals. */
export function capacitorRectanglePlates(withGapDimension = false): SceneDocument {
  const document = capacitorCircuit();
  document.entities.push({ id: "plateT", kind: "rectangle", role: "capacitor plate" }, { id: "plateB", kind: "rectangle", role: "capacitor plate" });
  document.constructions.push(
    { id: "make_plateT", operator: "rectangle", inputs: { center: "C", width: 3, height: 0.12 }, outputs: ["plateT"] },
    { id: "make_plateB", operator: "rectangle", inputs: { center: "D", width: 3, height: 0.12 }, outputs: ["plateB"] },
  );
  if (withGapDimension) {
    document.entities.push({ id: "gap", kind: "dimension", role: "plate separation" });
    document.constructions.push({ id: "make_gap", operator: "dimension", inputs: { start: "C", end: "D" }, outputs: ["gap"] });
  }
  return document;
}

export function capacitorDrawnTwice(kind: "K" | "N" | "recorded"): SceneDocument {
  const layouts = {
    K: {
      points: [["A", 0, 2], ["B", 0, 0], ["C", 4, 2], ["D", 4, 0], ["E", 6, 2], ["F", 6, 0]],
      symbols: [["battery", "battery", "A", "B"], ["capacitor", "capacitor", "C", "D"]],
      connects: [["top", "A", "C"], ["bottom", "B", "D"]],
      segments: [["plate1", "C", "E"], ["plate2", "D", "F"]],
    },
    N: {
      points: [["A", 0, 2], ["B", 0, 0], ["P1", 3, 1.2], ["P2", 5, 1.2], ["P3", 3, 0.8], ["P4", 5, 0.8]],
      symbols: [["battery", "battery", "A", "B"], ["capacitor", "capacitor", "P1", "P3"]],
      connects: [["top", "A", "P1"], ["bottom", "B", "P3"]],
      segments: [["plate1", "P1", "P2"], ["plate2", "P3", "P4"]],
    },
    recorded: {
      points: [["tl", 2, 2], ["tr", 6, 2], ["bl", 2, 0], ["br", 6, 0], ["bt", 0, 2], ["bb", 0, 0]],
      symbols: [["capacitor", "capacitor", "tl", "bl"], ["battery", "battery", "bt", "bb"]],
      connects: [["wire_top", "bt", "tl"], ["wire_bottom", "bb", "bl"]],
      segments: [["top", "tl", "tr"], ["bottom", "bl", "br"]],
    },
  } as const;
  const layout = layouts[kind];
  const ids = [
    ...layout.points.map(([id]) => id), ...layout.symbols.map(([id]) => id),
    ...layout.connects.map(([id]) => id), ...layout.segments.map(([id]) => id),
  ];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "A synthetic capacitor loop with free plates beside the symbol" },
    source: { question: capacitorQuestion, representationTier: "qualitative_verified", nonMetric: true },
    quantities: [],
    entities: [
      ...layout.points.map(([id]) => ({ id, kind: "point" as const, role: "node" })),
      ...layout.symbols.map(([id, symbol]) => ({ id, kind: "component" as const, role: symbol === "battery" ? "source" : "capacitor", label: symbol === "battery" ? "E" : "C" })),
      ...layout.connects.map(([id]) => ({ id, kind: "connector" as const, role: "wire" })),
      ...layout.segments.map(([id]) => ({ id, kind: "segment" as const, role: "capacitor plate" })),
    ],
    constructions: [
      ...layout.points.map(([id, x, y]) => ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] })),
      ...layout.symbols.map(([id, symbol, start, end]) => ({ id: `make_${id}`, operator: "symbol", inputs: { symbol, start, end }, outputs: [id] })),
      ...layout.connects.map(([id, start, end]) => ({ id: `make_${id}`, operator: "connect", inputs: { start, end }, outputs: [id] })),
      ...layout.segments.map(([id, start, end]) => ({ id: `make_${id}`, operator: "segment", inputs: { start, end }, outputs: [id] })),
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "circuit", entityIds: ids, dependsOn: [], narrationCue: "circuit" }], teachingTimeline: [],
  };
}
