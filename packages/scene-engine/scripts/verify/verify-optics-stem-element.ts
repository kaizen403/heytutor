/**
 * A lens or mirror stem names the optical element (Harness 4, 17 Oct 2026).
 *
 * Round p5 (maths, image of a point in a plane): "The point B(5, 2, 8) is the
 * mirror image of A(-1, 8, 2) in a plane" and "mirror image of a point in a
 * plane explained" were detected as spherical_mirror, so final selection
 * dropped seven valid planner figures of the plane (judged 5 right, 2
 * partial, 0 wrong) as planner optics on an optics stem, and the archetype
 * layer offered a mirror ray diagram for a coordinate geometry question.
 *
 * The rule: the spherical_mirror cue set vetoes a stem whose only mirror is a
 * "mirror image", and the spherical_mirror, thin_lens and lens_maker cue sets
 * veto the image or reflection of a point in a plane or a line. A mirror named
 * as an element (concave, convex, spherical, a mirror of focal length 15 cm,
 * an object 20 cm in front of a mirror) is untouched, and so is every plane
 * mirror stem.
 *
 * Both sides are pinned: the maths stems leave the optics archetypes with and
 * without their recorded plan hints, and 152 recorded lens and mirror stems
 * (fixtures/optics-stem-element.json, lecture-lab runs and repo data sets,
 * none held out) keep main's archetype. Each veto has a case only it catches.
 *
 * PR #189 review: neither veto applies when the stem names a lens or a mirror
 * element (a qualified mirror names one even in "concave mirror image
 * formation", and "a convex lens forms the image of a point P in a plane"
 * keeps thin_lens), and a decimal coordinate such as (1.5, 2) reaches the
 * line or plane after it.
 *
 * PR #189 coordinator review: a spherical mirror stem that says "mirror image"
 * and gives mirror facts (a focal length, the pole, a magnification, a ray
 * diagram, F and C, an object distance, u, v or f set to a number) keeps
 * spherical_mirror; "real" is not such a fact. A bare mirror names the element
 * only with such a fact, and a line mirror, a mirror line or a line that acts
 * as a mirror is never one: a stem giving that line with its equation leaves
 * optics.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-optics-stem-element.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectArchetype } from "../../src/archetypes/detect";

interface FixtureStem {
  question: string;
  source: string;
  archetype: string | null;
  lawIds?: string[];
  hintedArchetype?: string | null;
  leavesOptics?: true;
}

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/optics-stem-element.json"), "utf8")) as { stems: FixtureStem[] };
const LENS_OR_MIRROR = new Set(["spherical_mirror", "thin_lens", "lens_maker"]);

const failures: string[] = [];
let passed = 0;
function check(name: string, problem: string | null): void {
  if (problem) { failures.push(`${name}: ${problem}`); console.log(`FAIL ${name}: ${problem}`); }
  else passed += 1;
}
const detect = (question: string, lawIds?: readonly string[] | null) =>
  detectArchetype(question, lawIds ? { turnPlan: { lawIds } } : undefined)?.id ?? null;
const leaves = (question: string, lawIds?: readonly string[] | null): string | null => {
  const id = detect(question, lawIds);
  return id !== null && LENS_OR_MIRROR.has(id) ? `still detected as ${id}` : null;
};
const keeps = (question: string, expected: string | null, lawIds?: readonly string[] | null): string | null => {
  const id = detect(question, lawIds);
  return id === expected ? null : `detected as ${id}, main detects ${expected}`;
};

// 1. Every recorded p5 maths stem, plain and with each recorded plan's law ids.
const P5 = {
  h5a: "Find the image of the point P(2, -1, 7) in the plane x + 2y - 2z + 5 = 0, and the length PP′ where P′ is the image.",
  h5b: "The point B(5, 2, 8) is the mirror image of A(-1, 8, 2) in a plane. Find the equation of the plane and the distance of A from it.",
  h5u: "mirror image of a point in a plane explained",
};
const P5_LAW_IDS: Record<keyof typeof P5, string[][]> = {
  h5a: [
    ["reflection across plane ax+by+cz+d=0: P′=P−2(ax_P+by_P+cz_P+d)(a,b,c)/(a²+b²+c²)", "distance between two points in three-dimensional space"],
    ["reflection-across-plane", "point-to-plane-distance"],
    ["reflection-across-plane", "euclidean-distance-3d"],
    ["reflection-in-a-plane", "distance-formula-3d"],
    // Not recorded: a plan that names a mirror law must not pull the stem to the mirror figure either.
    ["mirror-image-of-a-point"],
  ],
  h5b: [
    ["reflection-perpendicular-bisector", "three-dimensional-distance-formula"],
    ["midpoint formula", "perpendicular-bisector property of a reflection plane", "point-to-plane distance formula"],
    ["reflection-perpendicular-bisector", "point-to-plane-distance"],
  ],
  h5u: [
    ["reflection-across-a-plane", "vector-projection"],
    ["orthogonal projection onto a plane", "reflection across a plane"],
    ["reflection-across-plane", "orthogonal-projection"],
    ["reflection-across-plane", "point-normal-form-of-plane"],
  ],
};
for (const [key, question] of Object.entries(P5) as Array<[keyof typeof P5, string]>) {
  check(`p5 ${key} plain`, leaves(question));
  for (const lawIds of P5_LAW_IDS[key]) check(`p5 ${key} with ${lawIds.join(", ")}`, leaves(question, lawIds));
}
// The point-in-a-plane stem keeps its own figure.
check("p5 h5a keeps space_point_plane", keeps(P5.h5a, "space_point_plane"));

// 2. Recorded lens and mirror stems keep main's archetype; the mirror image stems leave.
let kept = 0;
let left = 0;
for (const stem of fixture.stems) {
  const name = `recorded (${stem.source}) ${stem.question.slice(0, 70)}`;
  if (stem.leavesOptics) {
    left += 1;
    check(`${name} leaves optics`, leaves(stem.question));
    if (stem.lawIds) check(`${name} leaves optics with plan hints`, leaves(stem.question, stem.lawIds));
    continue;
  }
  kept += 1;
  check(name, keeps(stem.question, stem.archetype));
  if (stem.lawIds) check(`${name} with plan hints`, keeps(stem.question, stem.hintedArchetype ?? null, stem.lawIds));
}
check("fixture keeps a wide optics set", kept >= 140 && fixture.stems.filter((stem) => stem.archetype === "spherical_mirror" && !stem.leavesOptics).length >= 30
  && fixture.stems.filter((stem) => stem.archetype === "thin_lens").length >= 60 ? null : `only ${kept} kept stems`);
check("fixture has the recorded mirror image stems", left === 3 ? null : `${left} stems leave optics, expected 3`);

// 3. Mirror and lens wordings that name the element stay optics (main's archetype, pinned).
const ELEMENT_WORDINGS: Array<[string, string | null]> = [
  ["A mirror of focal length 15 cm forms an image of an object placed 30 cm from it. Find the image distance.", "spherical_mirror"],
  ["An object is placed 20 cm in front of a mirror of focal length 10 cm. Find the position of the image.", "spherical_mirror"],
  ["An object 20 cm in front of a mirror forms a real image 60 cm in front of it. Find the focal length.", "spherical_mirror"],
  ["A converging beam falls on a convex mirror so that the point object is 10 cm behind the mirror. Find the image.", "spherical_mirror"],
  ["A spherical mirror has a radius of curvature of 30 cm. An object is placed 10 cm from it. Find the image.", "spherical_mirror"],
  ["A mirror with radius of curvature 40 cm forms an image of an object placed 30 cm from it.", "spherical_mirror"],
  ["A concave mirror forms the mirror image of an object placed 30 cm from it. Its focal length is 10 cm.", "spherical_mirror"],
  ["Find the image of a point object placed 25 cm in front of a concave mirror of focal length 10 cm.", "spherical_mirror"],
  ["A convex lens of focal length 20 cm forms an image of an object placed 30 cm from it.", "thin_lens"],
  ["Find the image of a point object placed 15 cm from a converging lens of focal length 10 cm.", "thin_lens"],
  // Plane mirror stems keep their existing behaviour (the cue set already vetoes them).
  ["An object is placed 10 cm in front of a plane mirror. How far is the image from the object?", null],
  ["A point object is placed 15 cm in front of a plane mirror. Find the image of the point object in the plane mirror.", null],
];
for (const [question, expected] of ELEMENT_WORDINGS) check(`element wording ${question.slice(0, 60)}`, keeps(question, expected));

// 4. Each veto has a case only it catches (main detects every one as a lens or mirror figure).
check("mirror image of a figure, no mirror named", leaves("Draw the mirror image of triangle ABC in the y-axis."));
check("mirror image of a figure with a mirror law hint", leaves("Draw the mirror image of triangle ABC in the y-axis.", ["mirror-image-reflection"]));
// Greptile (c3ab6741e): a named geometry point such as C(1, 2) or F (3, 4) is not a focus position.
for (const question of [
  "A triangle has a vertex at C(1, 2). Draw its mirror image in the y-axis.",
  "The quadrilateral has corners at A(0, 0), B(4, 0) and C(4, 3) and a vertex at F (3, 4). Draw its mirror image in the x-axis.",
]) {
  check(`geometry point is not a focus ${question.slice(0, 50)}`, leaves(question));
  check(`geometry point is not a focus ${question.slice(0, 50)} with a mirror law hint`, leaves(question, ["mirror formula 1/v + 1/u = 1/f", "magnification m = -v/u"]));
}
check("image of a coordinate point in a line, mirror law hint", leaves("Find the image of the point (1, 2) in the line x + y = 5.", ["mirror-image-formula"]));
check("reflection of a named point in a line, mirror law hint", leaves("Find the reflection of the point A(3, -2) in the line y = x.", ["mirror-image-formula"]));
check("image of a coordinate point in a line, lens law hint", leaves("Find the image of the point (1, 2) in the line x + y = 5.", ["lens-formula"]));
check("image of a coordinate point in a line, lens maker law hint", leaves("Find the image of the point (1, 2) in the line x + y = 5.", ["lens-maker-formula"]));

// 5. PR #189 review (Greptile): a named optical element keeps its figure, and a decimal point is not a sentence end.
// 5a. A qualified mirror names the element even when "image" follows it (main's archetype, pinned).
const QUALIFIED_MIRROR_IMAGE: Array<[string, string | null]> = [
  ["Explain concave mirror image formation", "spherical_mirror"],
  ["Explain convex mirror image formation.", "spherical_mirror"],
  ["Describe the nature of a convex mirror image.", "spherical_mirror"],
  ["Spherical mirror image formation for an object beyond C", "spherical_mirror"],
  ["Draw concave mirror images for an object at F, between F and C, and beyond C.", "spherical_mirror"],
  ["Explain parabolic mirror image formation", "spherical_mirror"],
  ["Explain concave-mirror image formation with a ray diagram", "spherical_mirror"],
  // The plane mirror stays vetoed by its own cue, as on main.
  ["Explain plane mirror image formation", null],
];
for (const [question, expected] of QUALIFIED_MIRROR_IMAGE) check(`qualified mirror image ${question.slice(0, 60)}`, keeps(question, expected));
// 5b. A lens or a mirror element with an image plane is optics, not a coordinate point reflection (main's archetype, pinned).
const ELEMENT_WITH_IMAGE_PLANE: Array<[string, string]> = [
  ["A convex lens forms the image of a point P in a plane perpendicular to its principal axis. Draw the rays.", "thin_lens"],
  ["A converging lens of focal length 10 cm forms the image of the point P in the plane of the screen 30 cm away.", "thin_lens"],
  ["A concave lens forms the image of a point P in a plane perpendicular to its principal axis.", "thin_lens"],
  ["A biconvex lens with radii 20 cm and 30 cm forms the image of a point P in a plane perpendicular to its axis.", "lens_maker"],
  ["A concave mirror forms the image of a point P in a plane perpendicular to its principal axis. Draw the rays.", "spherical_mirror"],
  ["A convex mirror forms the image of a point A in a plane perpendicular to its principal axis.", "spherical_mirror"],
];
for (const [question, expected] of ELEMENT_WITH_IMAGE_PLANE) check(`element with image plane ${question.slice(0, 60)}`, keeps(question, expected));
// 5c. Decimal and negative coordinates leave optics like the integer ones (main detects each as a lens or mirror figure).
const DECIMAL_POINTS: Array<[string, string[]]> = [
  ["Find the image of the point (1.5, 2) in the line x + y = 5.", ["mirror-image-formula"]],
  ["Find the image of the point (1.5, 2) in the line x + y = 5.", ["lens-formula"]],
  ["Find the image of the point (-2.5, 3.25) in the line 2x - y = 1.", ["lens-formula"]],
  ["Find the reflection of the point P(-1.5, -0.5) in the line y = x.", ["mirror-image-formula"]],
  ["Find the image of the point (0.5, -1.5, 2) in the plane x + y + z = 3.", ["lens-maker-formula"]],
  ["Find the image of the point (−1, −2) in the line x − y = 4.", ["mirror-image-formula"]],
];
for (const [question, lawIds] of DECIMAL_POINTS) check(`point reflection ${question.slice(0, 50)} with ${lawIds.join(", ")}`, leaves(question, lawIds));

// 6. PR #189 coordinator review. 6a and 6b run plain and with a mirror law hint; main detects each of them as spherical_mirror.
const MIRROR_LAW_HINT = ["mirror formula 1/v + 1/u = 1/f", "magnification m = -v/u"];
// 6a. A spherical mirror stem that says "mirror image" and gives mirror facts (a focal length, the pole, a
// magnification, a ray diagram, F and C, an object distance, u, v or f set to a number) is still a mirror stem.
const MIRROR_IMAGE_WITH_MIRROR_FACTS = [
  "Draw a ray diagram for the mirror image of an object placed between F and C.",
  "If the mirror image is formed at 20 cm when the object is at 30 cm, find the focal length.",
  "The mirror image of an object placed 30 cm away is formed at 60 cm on the same side. Find the focal length.",
  "The mirror image is magnified 3 times. If the object is 10 cm away, find the focal length.",
  "A real mirror image, 3 times the size of the object, is formed 45 cm from the pole. Find the focal length.",
  "mirror image formed is virtual and erect, magnification +2, object distance 10 cm, find focal length",
  "Find the position of the mirror image of an object kept 15 cm in front of the pole when f = 10 cm.",
  "u = -30 cm, f = -20 cm, find v for the mirror image",
  "Object distance 25 cm, mirror image distance 50 cm, find the radius of curvature.",
  "object placed 20 cm in front of mirror image formed at 60 cm find focal length",
  // Only the object distance is given.
  "object at 30 cm from mirror image at 60 cm find f",
  "mirror image ka focal length nikalo, object 20 cm par hai aur image 60 cm par",
  // Greptile (cf98ca446): a position against F, C or 2F, or an object or source placed in front of a mirror, is a mirror fact.
  "Describe the mirror image of an object placed beyond C.",
  "Describe the mirror image of an object placed at F.",
  "Where is the mirror image of an object placed at the centre of curvature?",
  "Describe the mirror image of an object placed between F and the pole.",
  "Find the mirror image of a point source placed in front of a mirror.",
  "A candle stands in front of a mirror. Describe its mirror image.",
];
for (const question of MIRROR_IMAGE_WITH_MIRROR_FACTS) {
  check(`mirror image with mirror facts ${question.slice(0, 60)}`, keeps(question, "spherical_mirror"));
  check(`mirror image with mirror facts ${question.slice(0, 60)} with a mirror law hint`, keeps(question, "spherical_mirror", MIRROR_LAW_HINT));
}
// 6b. A line given as the mirror is the reflection line of coordinate geometry, and a bare mirror is an element only
// in a stem that gives mirror facts. "real" is not a mirror fact.
const NOT_A_MIRROR_ELEMENT = [
  "Find the image of the point (-8, 12) with respect to the line mirror 4x + 7y + 13 = 0.",
  "If the line y = x acts as a mirror, find the image of the point (2, 5).",
  "line mirror x+y=1 me point (2,3) ki image nikalo",
  "The image of the point (1, 2) in the line mirror y = x is",
  "Find image of point (3,-1) wrt line mirror x - y = 2",
  // "line mirror" with no equation is still the line of a point reflection.
  "Find the image of the point P(2, 3) in the line mirror AB.",
  // A bare mirror in a stem with no mirror facts.
  "Find the image of the point (2, 3) in the line x + y = 1, treating the line as a mirror.",
  // A line given as the mirror is no element even where the stem carries a mirror fact word.
  "Find the image of the curve y = x^2 in the line mirror y = x and the radius of curvature of the image at the origin.",
  "Reflect the point (u, v) in the mirror line y = x, where u = 2 and v = 5.",
  "If the line y = x acts as a mirror, find the image of the point (u, 1) when u = 3.",
  // A recorded JEE stem, and one only the mirror image rule catches: "real numbers" is not a real image.
  "Let 𝛼, 𝛽, 𝛾, 𝛿 be real numbers such that 𝛼 2 + 𝛽 2 + 𝛾 2 ≠ 0 and 𝛼 + 𝛾 = 1. Suppose the point\n          (3, 2, −1) is the mirror image of the point (1, 0, −1) with respect to the plane 𝛼𝑥 + 𝛽𝑦 + 𝛾𝑧 = 𝛿.\n          Then which of the following statements is/are TRUE?\n\n          (A) 𝛼 + 𝛽 = 2                                      (B) 𝛿 − 𝛾 = 3\n\n          (C) 𝛿 + 𝛽 = 4                                      (D) 𝛼 + 𝛽 + 𝛾 = 𝛿",
  "If a and b are real numbers and the curve y = ax^2 + b is the mirror image of y = x^2 in the line y = 1, find a and b.",
];
for (const question of NOT_A_MIRROR_ELEMENT) {
  check(`not a mirror element ${question.slice(0, 60)}`, leaves(question));
  check(`not a mirror element ${question.slice(0, 60)} with a mirror law hint`, leaves(question, MIRROR_LAW_HINT));
}
// 6c. A bare mirror in a stem with mirror facts names the element, so a point reflection there stays optics.
check("bare mirror with a focal length keeps the image of a point", keeps("A mirror of focal length 10 cm forms the image of the point P(0, 2) in the plane of the screen.", "spherical_mirror"));
check("bare mirror with a focal length keeps the image of a point, mirror law hint",
  keeps("A mirror of focal length 10 cm forms the image of the point P(0, 2) in the plane of the screen.", "spherical_mirror", MIRROR_LAW_HINT));
// 6d. "with respect to" names the line of a point reflection (the stem says no "mirror image").
check("image of a point with respect to a line, mirror law hint", leaves("Find the image of the point (1, 2) with respect to the line x + y = 5.", MIRROR_LAW_HINT));
// 6e. A point object or source is optics; a point charge is electrostatics (main and 24255cb09 kept the mirror archetype on it).
check("image of the point source in the plane of the screen, lens law hint",
  keeps("Find the image of the point source formed in the plane of the screen.", "thin_lens", ["thin lens formula 1/v - 1/u = 1/f"]));
check("image of the point object in the plane of the screen, mirror law hint",
  keeps("Find the image of the point object formed in the plane of the screen.", "spherical_mirror", MIRROR_LAW_HINT));
check("image of the point charge in a plane conductor, mirror law hint",
  leaves("Find the image of the point charge q in the plane conductor.", MIRROR_LAW_HINT));

if (failures.length) {
  console.error(`verify-optics-stem-element: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`verify-optics-stem-element: ${passed} checks passed (${kept} recorded optics stems kept, ${left} mirror image stems left optics)`);
