/**
 * The concept schematic draws thermal relations: bodies joined in thermal
 * contact, heat and work arrows on a system, a heat engine between
 * reservoirs. In production it drew "systems A, B, C in thermal contact" for
 * a biology lesson on life processes and for an aviation lesson, because any
 * plan claim with the word "system" became a box. Each mark must now be
 * licensed by its own claim stating the relation it draws.
 *
 * The plans below are written for this gate; none is a student question.
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

type Claim = TurnPlanV3["qualitativeClaims"][number];

function plan(question: string, claims: Array<[string, string, string[]?]>, extras: Partial<TurnPlanV3> = {}): TurnPlanV3 {
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
    lawIds: extras.lawIds ?? [],
    assumptions: [],
    visualRequirement: extras.visualRequirement ?? "optional",
  };
}

function noFigure(label: string, question: string, turnPlan: TurnPlanV3): void {
  assert(!buildConceptSchematic(question, turnPlan), `${label}: the concept schematic must not draw`);
  const family = synthesizeFamilyScene({ question, turnPlan });
  assert(family?.family !== CONCEPT_SCHEMATIC_FAMILY, `${label}: family synthesis drew the concept schematic`);
  const lastResort = synthesizeLastResortScene({ question, turnPlan });
  assert(lastResort?.family !== CONCEPT_SCHEMATIC_FAMILY, `${label}: last resort drew the concept schematic`);
}

// Organ systems are not bodies in thermal contact.
noFigure("organ systems", "Teach me life processes for class 10", plan("Teach me life processes for class 10", [
  ["The digestive system breaks food into simple molecules that the villi absorb.", "Digestion ends in the small intestine.", ["villi", "small intestine"]],
  ["The respiratory system exchanges oxygen and carbon dioxide in the alveoli.", "Gas exchange happens by diffusion.", ["alveoli"]],
  ["The circulatory system carries blood through a double circulation.", "The heart has four chambers.", ["heart"]],
  ["The excretory system filters blood in the nephron.", "Urine forms in the nephron.", ["nephron"]],
], { lawIds: ["Double circulation pathway"], visualRequirement: "required" }));

noFigure("reproductive systems", "Explain human reproduction", plan("Explain human reproduction", [
  ["The male reproductive system produces sperm in the testes.", "Labelled diagram of the male system.", []],
  ["The female reproductive system produces ova in the ovaries; fertilisation happens in the oviduct.", "Labelled diagram of the female system.", []],
], { visualRequirement: "required" }));

noFigure("navigation systems", "Explain metrology in aviation", plan("Explain metrology in aviation", [
  ["Aircraft instruments, engines and navigation systems are calibrated against standards.", "Traceability links each instrument to a national standard.", []],
  ["Pressure systems and temperature readings must be measured accurately.", "Altimeters and fuel gauges rely on calibration.", []],
]));

noFigure("search engine and number system", "How does a search engine index pages", plan("How does a search engine index pages", [
  ["A search engine crawls pages and stores them in an index.", "The engine ranks results by relevance.", ["search engine", "index"]],
  ["The binary number system uses base two; each system has a radix.", "Binary, denary and hexadecimal are number systems.", ["system A", "system B"]],
]));

noFigure("work and heat without a balance", "Explain how the heart works", plan("Explain how the heart works", [
  ["The heart works as a double pump; muscles do work and release heat.", "Blood is pumped through two circuits.", ["heart", "work W", "heat Q"]],
  ["Body heat is lost through the skin by sweating.", "Sweating cools the body.", ["skin"]],
]));

noFigure("solar and immune systems", "Teach the solar system", plan("Teach the solar system", [
  ["The solar system has eight planets orbiting the Sun.", "Inner planets are rocky.", ["system A", "Sun"]],
  ["The immune system defends the body; a second system, the lymphatic system, drains fluid.", "Lymph nodes filter lymph.", ["system B", "lymph nodes"]],
]));

noFigure("combustion engine without reservoirs", "How does a petrol engine work", plan("How does a petrol engine work", [
  ["A petrol engine has four strokes: intake, compression, power and exhaust.", "The spark plug ignites the mixture.", ["engine", "piston"]],
  ["The crankshaft turns the up and down motion into rotation.", "The flywheel smooths the motion.", ["crankshaft"]],
]));

// Real thermodynamic relations still draw.
const zerothQuestion = "State the zeroth law of thermodynamics";
const zeroth = buildConceptSchematic(zerothQuestion, plan(zerothQuestion, [
  ["If two systems are each in thermal equilibrium with a third system, they are in thermal equilibrium with each other.", "This defines temperature.", ["system A", "system B", "system C (thermometer)"]],
]));
assert(zeroth, "zeroth law with systems in thermal equilibrium must still draw");
assert(zeroth.entities.some((entity) => entity.role === "thermal contact"), "zeroth law must draw the thermal contact");

const firstQuestion = "Explain the first law of thermodynamics";
const first = buildConceptSchematic(firstQuestion, plan(firstQuestion, [
  ["The change in internal energy of a system equals heat added minus work done by the system.", "ΔU = Q − W, where W is the expansion work done by the gas.", []],
  ["Energy is conserved in every process.", "Energy is never created or destroyed.", []],
]));
assert(first, "a first law energy balance must still draw Q and W");
const firstLabels = first.entities.map((entity) => entity.label);
assert(firstLabels.includes("Q") && firstLabels.includes("W"), "the energy balance must label Q and W");
assert(!first.entities.some((entity) => entity.role === "thermal contact"), "an energy balance alone must not draw thermal contact");

const engineQuestion = "Explain the second law using a heat engine";
const engine = buildConceptSchematic(engineQuestion, plan(engineQuestion, [
  ["A heat engine takes heat from a hot reservoir, does work and rejects heat to a cold reservoir.", "No heat engine is 100% efficient.", ["heat engine", "hot reservoir", "cold reservoir"]],
]));
assert(engine, "a heat engine between reservoirs must still draw");
assert(engine.entities.some((entity) => entity.role === "hot reservoir"), "the heat engine must draw its hot reservoir");

// A system named in a thermal claim does not license a system named elsewhere.
const mixedQuestion = "Explain heat and the digestive system";
const mixed = buildConceptSchematic(mixedQuestion, plan(mixedQuestion, [
  ["The digestive system and the nervous system work together.", "Organ systems cooperate.", ["system A", "system B"]],
  ["The change in internal energy equals heat added minus work done.", "ΔU = Q − W", ["heat Q", "work W"]],
]));
assert(mixed, "the licensed energy balance must still draw");
assert(!mixed.entities.some((entity) => entity.role === "thermal contact"), "organ systems must not be drawn in thermal contact");

console.log("concept schematic evidence verification passed (7 refusals, 4 thermal figures)");
