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
check("image of a coordinate point in a line, mirror law hint", leaves("Find the image of the point (1, 2) in the line x + y = 5.", ["mirror-image-formula"]));
check("reflection of a named point in a line, mirror law hint", leaves("Find the reflection of the point A(3, -2) in the line y = x.", ["mirror-image-formula"]));
check("image of a coordinate point in a line, lens law hint", leaves("Find the image of the point (1, 2) in the line x + y = 5.", ["lens-formula"]));
check("image of a coordinate point in a line, lens maker law hint", leaves("Find the image of the point (1, 2) in the line x + y = 5.", ["lens-maker-formula"]));

if (failures.length) {
  console.error(`verify-optics-stem-element: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`verify-optics-stem-element: ${passed} checks passed (${kept} recorded optics stems kept, ${left} mirror image stems left optics)`);
