import type { SceneDocument, TurnPlanV3 } from "../../../src/index";

/** Synthetic operator contracts; no recorded questions or inferred gas constants. */
export function conceptualPvDocument(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", source: { nonMetric: true, representationTier: "qualitative_verified" },
    visualDecision: { mode: "scene", reason: "Synthetic named thermodynamic process" }, quantities: [],
    entities: [{ id: "plot", kind: "polyline", role: "P-V process plot" }],
    constructions: [{ id: "make_plot", operator: "pv_process", inputs: {
      mode: "conceptual", states: [{ id: "A", pressure: 1, volume: 1 }, { id: "B", pressure: 1, volume: 2 }],
      processes: [{ kind: "isobar", from: "A", to: "B" }],
    }, outputs: ["plot"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["plot"],
    revealGroups: [{ id: "all", entityIds: ["plot"], dependsOn: [], narrationCue: "Follow the named process" }], teachingTimeline: [],
  };
}
export function physicalPvDocument(): SceneDocument {
  const document = conceptualPvDocument(); document.source = {};
  document.quantities = [
    { id: "pa", value: 200, unit: "kPa" }, { id: "va", value: 1, unit: "L" },
    { id: "pb", value: 100, unit: "kPa" }, { id: "pc", value: 50, unit: "kPa" },
    { id: "vend", value: 2, unit: "L" }, { id: "gamma", value: 2, unit: "1" },
  ];
  document.constructions[0]!.inputs = {
    mode: "physical", pressureUnit: "kPa", volumeUnit: "L",
    states: [{ id: "A", pressure: "pa", volume: "va" }, { id: "B", pressure: "pb", volume: "vend" }, { id: "C", pressure: "pc", volume: "vend" }],
    processes: [{ kind: "isotherm", from: "A", to: "B" }, { kind: "adiabat", from: "A", to: "C", gamma: "gamma" }],
  };
  return document;
}
export function pvTurnPlan(document: SceneDocument, question: string): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question,
    givens: document.quantities.map((quantity) => {
      if (typeof quantity.value !== "number" || typeof quantity.unit !== "string") throw new Error("Synthetic PV plan needs numeric, unitful givens");
      return { id: quantity.id, symbol: quantity.id, value: quantity.value, unit: quantity.unit, provenance: "given" };
    }),
    unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  };
}
