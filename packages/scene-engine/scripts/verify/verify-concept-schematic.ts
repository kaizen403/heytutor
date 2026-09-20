/**
 * Concept explain questions must compile a teaching schematic from the turn
 * plan, not a canned P–V rectangle and not an empty board.
 */
import {
  buildConceptSchematic,
  CONCEPT_SCHEMATIC_FAMILY,
  synthesizeFamilyScene,
  synthesizeLastResortScene,
  type TurnPlanV3,
} from "../../src";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function plan(question: string, extras: Partial<TurnPlanV3> = {}): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3",
    question,
    givens: extras.givens ?? [],
    unknowns: extras.unknowns ?? [],
    derived: extras.derived ?? [],
    qualitativeClaims: extras.qualitativeClaims ?? [],
    lawIds: extras.lawIds ?? [],
    assumptions: extras.assumptions ?? [],
    visualRequirement: extras.visualRequirement ?? "optional",
  };
}

const thermoQuestion = "can u explain me laws of thermodynamics";
const thermoPlan = plan(thermoQuestion, {
  qualitativeClaims: [
    {
      id: "c0",
      claim: "Zeroth Law: If two systems are each in thermal equilibrium with a third system, they are in thermal equilibrium with each other; this defines temperature.",
      expected: "Zeroth law establishes thermal equilibrium and temperature as a measurable property.",
      relatedEntityHints: ["system A", "system B", "system C (thermometer)"],
    },
    {
      id: "c1",
      claim: "First Law: Energy is conserved. The change in internal energy of a system equals heat added minus work done by the system: ΔU = Q − W.",
      expected: "Energy can change form (heat, work, internal energy) but is never created or destroyed.",
      relatedEntityHints: ["internal energy U", "heat Q", "work W"],
    },
    {
      id: "c2",
      claim: "Second Law: The entropy of an isolated system never decreases; heat flows spontaneously from hot to cold, and no heat engine can be 100% efficient.",
      expected: "Processes have a natural direction; entropy of the universe increases.",
      relatedEntityHints: ["entropy S", "heat engine", "hot reservoir", "cold reservoir"],
    },
  ],
  lawIds: [
    "zeroth-law-of-thermodynamics",
    "first-law-of-thermodynamics",
    "second-law-of-thermodynamics",
  ],
});

const schematic = buildConceptSchematic(thermoQuestion, thermoPlan);
assert(schematic, "thermo explain plan must compile a teaching schematic");
assert(schematic.visualDecision.mode === "scene", "thermo schematic must be a scene");
assert(schematic.source.conceptSchematic === true, "thermo schematic must be marked as a teaching schematic");
const labels = schematic.entities.map((entity) => entity.label).filter(Boolean);
assert(labels.includes("A") && labels.includes("B"), "zeroth law must label systems A and B");
assert(labels.includes("Q") && labels.includes("W"), "first law must label heat Q and work W");
assert(
  labels.some((label) => /hot/i.test(label ?? ""))
    && labels.some((label) => /cold/i.test(label ?? "")),
  "second law must label the hot and cold reservoirs",
);
assert(
  !schematic.entities.some((entity) => /P-V|axes/i.test(`${entity.role} ${entity.label ?? ""}`)),
  "an explain-the-laws schematic must not stamp P–V axes",
);
assert(schematic.revealGroups.length >= 2, "the laws must reveal in stages, not as one dump");

const synthesized = synthesizeFamilyScene({
  question: thermoQuestion,
  turnPlan: thermoPlan,
});
assert(synthesized, "family synthesis must pick up the teaching schematic");
assert(
  synthesized.family === CONCEPT_SCHEMATIC_FAMILY,
  `thermo explain synthesized ${synthesized.family}, not a teaching schematic`,
);
assert(synthesized.nonMetric, "the teaching schematic is qualitative");
assert(
  synthesized.renderScene.primitives.some((primitive) =>
    primitive.kind === "label" && typeof primitive.text === "string" && primitive.text.trim().length > 0),
  "the teaching schematic must carry readable labels",
);

const lastResort = synthesizeLastResortScene({
  question: thermoQuestion,
  turnPlan: thermoPlan,
});
assert(lastResort, "last-resort must still compile the teaching schematic");
assert(
  lastResort.family === CONCEPT_SCHEMATIC_FAMILY,
  `last-resort drew ${lastResort.family} instead of the teaching schematic`,
);

const noPlan = synthesizeLastResortScene({ question: thermoQuestion });
assert(!noPlan, "without a plan, last-resort must not invent a P–V rectangle for 'thermodynamics'");

const nonePlan = plan(thermoQuestion, {
  visualRequirement: "none",
  qualitativeClaims: thermoPlan.qualitativeClaims,
});
assert(
  !buildConceptSchematic(thermoQuestion, nonePlan),
  "visualRequirement none must keep the board empty",
);

const proseOnly = plan(thermoQuestion, {
  qualitativeClaims: [{
    id: "c1",
    claim: "Zeroth Law: If two systems are each in thermal equilibrium with a third system, they are in thermal equilibrium with each other. First law: ΔU = Q − W. Heat flows from hot to cold through a heat engine.",
    expected: true,
  }],
});
assert(
  buildConceptSchematic(thermoQuestion, proseOnly),
  "claim prose must still ground a schematic when relatedEntityHints are missing",
);

const numericPv = "An ideal gas is taken through a cyclic process ABCA on a P-V diagram. Find the work done.";
const pvScene = synthesizeFamilyScene({
  question: numericPv,
  families: ["state_plot"],
  turnPlan: plan(numericPv, {
    visualRequirement: "required",
    givens: [
      { id: "p1", symbol: "P1", value: 1e5, unit: "Pa", provenance: "given" },
      { id: "p2", symbol: "P2", value: 2e5, unit: "Pa", provenance: "given" },
      { id: "v1", symbol: "V1", value: 0.002, unit: "m^3", provenance: "given" },
      { id: "v2", symbol: "V2", value: 0.004, unit: "m^3", provenance: "given" },
    ],
  }),
});
assert(pvScene, "a named P–V cycle with pressures still compiles as a state plot");
assert(
  pvScene.family !== CONCEPT_SCHEMATIC_FAMILY,
  "a numbered P–V process must not be replaced by the concept schematic",
);

console.log("concept schematic verification passed");
