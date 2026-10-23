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

// "Elastic" is a material property unless a collision is in the stem.
check(detected("Explain elastic potential energy stored in a stretched wire") === null, "elastic potential energy cued a collision");
check(detected("Explain stress, strain and the elastic limit") === null, "the elastic limit cued a collision");
check(detected("Explain collisions in two dimensions", ["conservation of momentum"]) !== "collision_line", "a two dimensional collision drew the line collision");
check(detected("Explain oblique collisions of two balls") !== "collision_line", "an oblique collision drew the line collision");

// Stem cues still match, and the law still strengthens them.
check(detected("Explain elastic collisions in one dimension") === "collision_line", "plural collisions lost the line collision");
check(detected("Two balls undergo a perfectly inelastic collision") === "collision_line", "an inelastic collision of two balls lost its figure");
check(detected("Using Kirchhoff's laws, find the current in each branch of the two loop circuit", ["Kirchhoff voltage law"]) === "two_loop_network", "a Kirchhoff two loop stem lost its figure");
check(detected("where images form in concave and convex mirrors") === "spherical_mirror", "plural mirrors lost the spherical mirror");
check(detected("A thin meniscus lens of glass, n = 1.5, has surfaces of radius 10 cm and 30 cm. Find its focal length.", ["lensmaker equation"]) === "lens_maker", "a meniscus lens with the lensmaker law lost the lens maker figure");
check(detected("A projectile is launched at 30 degrees with speed 20 m/s. Find its range.", ["projectile motion"]) === "projectile", "a projectile stem lost its figure");

// Plural mirrors cue only curved mirrors; flat mirror setups match nothing.
for (const stem of [
  "How does a periscope use two mirrors?",
  "Explain the uses of plane mirrors in daily life",
  "Why are kaleidoscope mirrors set at 60 degrees?",
  "Why is one of the mirrors in a laser partially reflecting?",
  "Two facing mirrors in a salon make many images. Why?",
  "Explain lateral inversion in plane mirrors",
  "Optical isomers are mirror images of each other",
]) check(detected(stem) !== "spherical_mirror", `"${stem}" drew a spherical mirror`);
check(detected("Why are convex mirrors used as rear view mirrors?") === "spherical_mirror", "convex rear view mirrors lost the spherical mirror");

// A liquid's meniscus is not a lens.
for (const stem of [
  "Why is the meniscus of water concave and that of mercury convex?",
  "Read the volume in a measuring cylinder at the bottom of the meniscus",
  "A capillary tube forms a hemispherical meniscus of radius 0.1 mm. Find the rise.",
  "Explain surface tension and the angle of contact at a meniscus",
]) check(detected(stem) !== "lens_maker", `"${stem}" drew a lens`);

// Collisions that are not two bodies on a line draw no two body figure.
for (const stem of [
  "Explain collision theory of reaction rates",
  "How do hash tables resolve collisions?",
  "Why do airbags protect passengers in collisions?",
  "What is the mean free path between molecular collisions in a gas?",
  "A 3 kg ball hits a 2 kg ball at rest; the first moves off at 40 degrees after the collision. Find the speeds.",
  "A car going north collides with a van going eastward at a junction.",
  "In collisions of pucks on ice, momentum is conserved along x and y.",
]) {
  check(detected(stem) !== "collision_line", `"${stem}" detected the line collision`);
  check(synthesizeFamilyScene({ question: stem })?.document.entities.every((entity) => !/^line of (?:impact|motion)$/.test(entity.role ?? "")) ?? true, `"${stem}" drew a collision line`);
}
check(synthesizeFamilyScene({ question: "A 2 kg ball moving at 3 m/s collides head-on with a 1 kg ball at rest and they stick together." })?.document.entities.some((entity) => /^line of (?:impact|motion)$/.test(entity.role ?? "")), "a head-on collision lost its collision line");

console.log(`archetype stem evidence verification passed (${checks} checks)`);
