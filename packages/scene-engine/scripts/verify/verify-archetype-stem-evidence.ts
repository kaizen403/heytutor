/**
 * A plan law strengthens a figure the stem names; it never names one alone.
 *
 * Production 21 Oct: an emitter follower question whose plan listed
 * "Kirchhoff voltage law" scored the two loop network archetype on the law
 * alone, and the board drew two batteries and three resistors. Recorded lab
 * plans showed the same pattern 248 times in 5,592 questions: transistors and
 * diodes as two loop networks, friction as two point charges ("Coulomb's law
 * of friction"), bubbles as spherical refraction, beats as a double slit.
 *
 * The stems below are written for this gate; none is a student question.
 */
import { detectArchetype, synthesizeFamilyScene, type TurnPlanV3 } from "../../src";

let checks = 0;
function check(condition: unknown, message: string): void {
  checks += 1;
  if (!condition) throw new Error(message);
}

function plan(question: string, lawIds: string[]): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3",
    question,
    givens: [],
    unknowns: [],
    derived: [],
    qualitativeClaims: [],
    lawIds,
    assumptions: [],
    visualRequirement: "optional",
  };
}

function detected(question: string, lawIds: string[] = []): string | null {
  return detectArchetype(question, lawIds.length ? { turnPlan: plan(question, lawIds), problemIR: null } : undefined)?.id ?? null;
}

// Law alone: no archetype.
const lawOnly: Array<[string, string[]]> = [
  ["Explain the voltage gain of an emitter follower", ["small-signal analysis", "Kirchhoff voltage law"]],
  ["Explain clipping and clamping circuits with waveforms", ["Kirchhoff voltage law", "diode equation"]],
  ["Explain a zener diode as a voltage regulator", ["KVL", "zener breakdown"]],
  ["Explain static and kinetic friction", ["Coulomb's law of friction", "Newton's second law"]],
  ["Explain excess pressure inside drops and bubbles", ["Laplace pressure", "spherical surface tension"]],
  ["Explain the dual nature of radiation", ["Einstein photoelectric equation", "de Broglie relation"]],
  ["Explain beats in sound", ["superposition", "Young interference condition"]],
  ["Explain gravitational potential energy in a central field", ["Newton's law of gravitation", "orbital speed"]],
];
for (const [question, lawIds] of lawOnly) {
  check(detected(question, lawIds) === null, `law alone named a figure for "${question}": ${detected(question, lawIds)}`);
}

// Stem cues still match, and the law still strengthens them.
check(detected("Using Kirchhoff's laws, find the current in each branch of the two loop circuit", ["Kirchhoff voltage law"]) === "two_loop_network", "a Kirchhoff two loop stem lost its figure");
check(detected("A projectile is launched at 30 degrees with speed 20 m/s. Find its range.", ["projectile motion"]) === "projectile", "a projectile stem lost its figure");

// A meniscus stem whose only lens cue came from its lensmaker law draws no
// lens: the lens maker drew biconvex, and with that law match refused the
// thin lens read "concave surface" as diverging.
const lensRequired = (question: string, lawIds: string[]) => ({ ...plan(question, lawIds), visualRequirement: "required" as const });
for (const stem of [
  "Draw a converging meniscus-shaped lens with one concave surface and one convex surface.",
  "Draw a converging meniscus lens with one concave surface and one convex surface.",
  "Explain a diverging meniscus lens",
  "A thin meniscus lens of glass, n = 1.5, has surfaces of radius 10 cm and 30 cm. Find its focal length.",
]) {
  check(!["thin_lens", "lens_maker"].includes(detected(stem, ["lensmaker equation"]) ?? ""), `"${stem}" detected a lens`);
  const figure = synthesizeFamilyScene({ question: stem, turnPlan: lensRequired(stem, ["lensmaker equation"]) });
  check(!figure?.document.entities.some((entity) => /\blens\b/i.test(entity.role ?? "")), `"${stem}" drew a lens`);
}

// A stem matched only through its plan's laws gets no deterministic figure at all.
const bubble = "An air bubble of radius 0.10 mm is just below the surface of water of surface tension 0.072 N/m. Find the excess pressure inside it.";
const bubbleLaws = ["Laplace pressure", "spherical surface tension"];
check(detected(bubble, bubbleLaws) === null, "a law only bubble stem detected an archetype");
check(synthesizeFamilyScene({ question: bubble, turnPlan: plan(bubble, bubbleLaws) }) === null, "a law only bubble stem drew a family figure");

console.log(`archetype stem evidence verification passed (${checks} checks)`);
