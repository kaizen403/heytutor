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
