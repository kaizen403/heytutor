/**
 * The concept schematic is gone from the board. It drew thermal relations
 * (bodies in thermal contact, Q into and W out of a system, a heat engine
 * between reservoirs) from words in the plan. In production it put "systems
 * A, B, C in thermal contact" on a biology lesson and on an aviation lesson,
 * and an independent review of a stricter version still found wrong figures:
 * Q drawn in when heat is released, Q drawn for an adiabatic process, a
 * refrigerator drawn as an engine, the zeroth law chained A to B to C. Its
 * arrows and layout were fixed whatever the claim said, so no claim evidence
 * can make it honest. Explain plans now teach in words unless a real family
 * or the planner draws them.
 *
 * The plans below are written for this gate; none is a student question.
 */
import { synthesizeFamilyScene, synthesizeLastResortScene, type TurnPlanV3 } from "../../src";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Claim = TurnPlanV3["qualitativeClaims"][number];

function plan(question: string, claims: Array<[string, string, string[]?]>, visualRequirement: TurnPlanV3["visualRequirement"] = "optional"): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3",
    question,
    givens: [],
    unknowns: [],
    derived: [],
    qualitativeClaims: claims.map(([claim, expected, hints], index): Claim => ({
      id: `c${index}`,
      claim,
      expected,
      ...(hints ? { relatedEntityHints: hints } : {}),
    })),
    lawIds: [],
    assumptions: [],
    visualRequirement,
  };
}

const plans: Array<[string, TurnPlanV3]> = [
  ["thermodynamics laws", plan("can u explain me laws of thermodynamics", [
    ["If two systems are each in thermal equilibrium with a third system, they are in thermal equilibrium with each other.", "This defines temperature.", ["system A", "system B", "system C (thermometer)"]],
    ["The change in internal energy of a system equals heat added minus work done by the system.", "ΔU = Q − W", ["internal energy U", "heat Q", "work W"]],
    ["No heat engine working between a hot reservoir and a cold reservoir is 100% efficient.", "Heat flows from hot to cold.", ["heat engine", "hot reservoir", "cold reservoir"]],
  ], "required")],
  ["organ systems", plan("Teach me life processes", [
    ["The digestive system breaks food into simple molecules.", "Digestion ends in the small intestine.", ["villi"]],
    ["The circulatory system and the respiratory system work together.", "The heart pumps blood.", ["heart"]],
  ], "required")],
  ["navigation systems", plan("Explain metrology in aviation", [
    ["Aircraft engines and navigation systems are calibrated against standards.", "Traceability links each instrument to a standard.", []],
  ])],
  ["respiration releases heat", plan("Why does respiration warm the body", [
    ["Respiration in the cell releases heat; the internal energy of the body system rises unless heat is lost.", "Heat flows out through the skin.", ["system A", "heat Q"]],
  ])],
  ["refrigerator", plan("How does a refrigerator work", [
    ["A refrigerator moves heat from a cold reservoir to a hot reservoir using work.", "COP = Qc / W", ["refrigerator", "cold reservoir", "hot reservoir"]],
  ])],
  ["adiabatic first law", plan("Explain an adiabatic expansion", [
    ["In an adiabatic process Q = 0, so the change in internal energy equals minus the work done by the gas.", "ΔU = −W", ["heat Q", "work W"]],
  ])],
];

for (const [label, turnPlan] of plans) {
  for (const [path, result] of [
    ["family synthesis", synthesizeFamilyScene({ question: turnPlan.question, turnPlan })],
    ["last resort", synthesizeLastResortScene({ question: turnPlan.question, turnPlan })],
  ] as const) {
    const roles = result?.document.entities.map((entity) => entity.role ?? "") ?? [];
    assert(!roles.includes("thermal contact"), `${label}: ${path} drew bodies in thermal contact`);
    assert(!(result?.document.source as { conceptSchematic?: boolean } | undefined)?.conceptSchematic, `${label}: ${path} drew a concept schematic`);
    assert(!roles.some((role) => /P-V|pressure axis|volume axis/i.test(role)), `${label}: ${path} stamped P-V axes on an explain plan`);
  }
}

console.log(`no concept schematic: ${plans.length} explain plans draw no thermal template on either path`);
