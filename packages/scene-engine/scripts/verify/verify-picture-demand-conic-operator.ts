/**
 * Picture demand gate: a conic drawn with the engine's own conic operator is a
 * conic, and charged spheres hung on threads may show their tension and weight.
 *
 * The fixture holds recorded planner candidates that main (aeb3eb11e) rejected
 * with picture_demand_unmet in a replay of 8,601 lab runs. Each document is
 * the validated scene the exact check receives. Cases:
 *
 * - conic_operator: drawn with conic, conic_anchor, conic_directrix,
 *   conic_asymptotes or conic_tangent and no plotted curve. Now passes.
 * - conic_operator_exempt: the same, but the stem places a point on an
 *   ellipse by its parameter angle. Judged figures put the point at the wrong
 *   angle, so the demand still fails.
 * - parametric_curve, function_curve_x_times_x: the conic is drawn by a
 *   general parametric curve, or as a function written x*x. Still fails.
 * - rail_circuit: a magnetic stem forbids the resistor chain. Still fails.
 * - photoelectric_levels: a photoelectric stem forbids bohr_levels. Still fails.
 * - thread_spheres: an electrostatic stem whose spheres hang on threads. Now passes.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-picture-demand-conic-operator.ts
 */
import { readFileSync } from "node:fs";
import { CONIC_OPERATORS } from "../../src/compile/conicGeometry";
import { demandRejection, pictureFeatures, sceneDemand } from "../../src/synthesize/sceneDemand";
import { validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";

type Case =
  | "conic_operator"
  | "conic_operator_exempt"
  | "parametric_curve"
  | "function_curve_x_times_x"
  | "rail_circuit"
  | "photoelectric_levels"
  | "thread_spheres";

interface Row {
  id: string;
  case: Case;
  topic: string;
  question: string;
  mainRejection: string;
  document: SceneDocument;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/picture-demand-drops.json", import.meta.url), "utf8"),
) as { rows: Row[] };

const failures: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

const EXPECTED: Record<Case, string | null> = {
  conic_operator: null,
  conic_operator_exempt: "missing plotted_conic",
  parametric_curve: "missing plotted_conic",
  function_curve_x_times_x: "missing conic",
  rail_circuit: "contradicted by resistor_chain",
  photoelectric_levels: "contradicted by bohr_levels",
  thread_spheres: null,
};
const MINIMUM: Record<Case, number> = {
  conic_operator: 20,
  conic_operator_exempt: 3,
  parametric_curve: 3,
  function_curve_x_times_x: 1,
  rail_circuit: 2,
  photoelectric_levels: 2,
  thread_spheres: 3,
};

const counts = new Map<Case, number>();
const conicTopics = new Set<string>();
for (const row of fixture.rows) {
  counts.set(row.case, (counts.get(row.case) ?? 0) + 1);
  const label = `${row.id} ${row.case} (${row.topic})`;
  // The recorded document is still a valid scene for this engine, so the
  // gate measures the demand and nothing else.
  const validated = validateSceneDocument(structuredClone(row.document) as unknown as Record<string, unknown>);
  check(validated.document && validated.report.valid, `${label}: the recorded document no longer validates`);
  check(row.mainRejection.length > 0, `${label}: the fixture must record main's rejection`);

  const operators = new Set(row.document.constructions.map((construction) => construction.operator));
  const features = pictureFeatures(row.document);
  const rejection = demandRejection(row.document, sceneDemand(row.question, null));
  const expected = EXPECTED[row.case];
  if (expected === null) {
    check(rejection === null, `${label}: must now meet the picture demand, got "${rejection}"`);
  } else {
    check(rejection === expected, `${label}: must still fail with "${expected}", got "${rejection}"`);
  }

  if (row.case === "conic_operator" || row.case === "conic_operator_exempt") {
    // Each row exercises the new reading: the conic comes only from the
    // operator family, never from a plotted curve.
    check(CONIC_OPERATORS.some((operator) => operators.has(operator)), `${label}: must draw with the conic operator family`);
    check(features.has("conic") && !features.has("plotted_conic"), `${label}: the conic operator reads as conic and not as plotted_conic`);
    if (row.case === "conic_operator") conicTopics.add(row.topic);
    else check(sceneDemand(row.question).requires.includes("plotted_conic"), `${label}: a parameter angle stem must ask for a plotted conic`);
  }
  if (row.case === "parametric_curve") {
    check(operators.has("parametric_curve") || operators.has("polar_curve"), `${label}: must draw a parametric or polar curve`);
    check(!features.has("conic"), `${label}: a parametric or polar curve is not read as a conic`);
  }
  if (row.case === "thread_spheres") {
    check(features.has("suspended_body"), `${label}: the figure shows the tension or the weight`);
    check(!sceneDemand(row.question).forbids.includes("suspended_body"), `${label}: threads count as suspension`);
  }
}
for (const [name, minimum] of Object.entries(MINIMUM) as [Case, number][]) {
  check((counts.get(name) ?? 0) >= minimum, `fixture: at least ${minimum} ${name} rows, found ${counts.get(name) ?? 0}`);
}
check(conicTopics.size >= 6, `fixture: conic operator rows from at least 6 topics, found ${conicTopics.size}`);

/* Stem readings the fixture does not pin. */
const PARABOLA_PARAMETER = "On the parabola y^2 = 8x the parametric point is (a t^2, 2 a t) with a = 2. Find the point for t = 1.";
check(sceneDemand(PARABOLA_PARAMETER).requires.includes("conic")
  && !sceneDemand(PARABOLA_PARAMETER).requires.includes("plotted_conic"),
  "a parabola's parameter t is not an angle: the conic operator still meets it");
check(sceneDemand("Find the point P(θ) on the hyperbola x^2/16 - y^2/9 = 1 where the tangent is parallel to y = x.").requires.includes("plotted_conic"),
  "P(θ) on a hyperbola asks for a plotted conic");
check(sceneDemand("For the ellipse x^2/25 + y^2/9 = 1, find the tangent at θ = π/4.").requires.includes("plotted_conic"),
  "at θ = π/4 on an ellipse asks for a plotted conic");
// A trig function of θ reads as the parameter. Reading too much only keeps
// today's rule (a plotted conic), so this stem now asks for one.
check(sceneDemand("Show that sin(θ) and cos(θ) satisfy the ellipse x^2 + y^2/4 = 1 after scaling.").requires.includes("plotted_conic"),
  "sin(θ) on an ellipse reads as the parameter and keeps today's rule");
check(sceneDemand("For the ellipse x^2/25 + y^2/16 = 1, find the eccentricity, the foci and the directrices.").requires.includes("conic"),
  "eccentricity is not an eccentric angle");

/*
 * Wordings that place a point by its parameter angle (PR #190 review). Each
 * keeps today's rule and asks for a plotted conic. The first group is every
 * stem the review lists; the second gives each reading a stem that only that
 * reading catches, so dropping any one of them turns this gate red.
 */
const PARAMETER_ANGLE_STEMS: [string, string][] = [
  // The review's failing cases (reworded recorded stems; the tutor gate runs them through the selection).
  ["review pd30", "parametric form of a point on an ellipse"],
  ["review pd30", "a point on an ellipse written as (a cos θ, b sin θ)"],
  ["review pd30 Hinglish", "ellipse pe point ke coordinates (a cos θ, b sin θ) form mein samjhao"],
  ["review pd33", "what is the angle θ in the point (a cos θ, b sin θ) of an ellipse"],
  ["review pd32 where", "An ellipse is given by x = 6 cos θ, y = 2 sin θ. Find the points P and Q where θ = pi/6 and θ = -pi/6, and the length of the chord PQ."],
  ["review pd32 corresponding to", "An ellipse is given by x = 6 cos θ, y = 2 sin θ. Find the points P and Q corresponding to θ = pi/6 and θ = -pi/6, and the length of the chord PQ."],
  ["review pd32 LaTeX", "An ellipse is given by x = 6 cos \\theta, y = 2 sin \\theta. Find the points P and Q at \\theta = \\pi/6 and \\theta = -\\pi/6, and the length of the chord PQ."],
  // The review's further stems.
  ["review", "Find the equation of the tangent to the ellipse x^2/a^2 + y^2/b^2 = 1 at the point (a cos θ, b sin θ)."],
  ["review", "Find the normal to the hyperbola x^2/16 - y^2/9 = 1 at the point (4 sec θ, 3 tan θ)."],
  ["review Hinglish", "Hyperbola x^2/16 - y^2/9 = 1 par θ = π/3 wala point plot karo."],
  ["review Hinglish", "ellipse x^2/25 + y^2/9 = 1 pe theta = 60 degree wala point kaise nikale?"],
  ["review", "P(α) and Q(β) are points on the ellipse x^2/25 + y^2/9 = 1. Find the chord PQ when α = π/3 and β = π/6."],
  ["review", "Write the ellipse x^2/9 + y^2/4 = 1 in parametric form and mark the point corresponding to θ = π/6."],
  ["review", "The parametric equations of an ellipse are x = 5 cos θ, y = 3 sin θ. Mark the point where θ = π/4."],
  ["review", "Find the point on the ellipse x^2/25 + y^2/9 = 1 corresponding to θ = 2π/3."],
  ["review", "Find the point on the ellipse x^2/25 + y^2/9 = 1 whose parameter is π/3."],
  ["review", "Find the normal to the ellipse x^2/25 + y^2/16 = 1 at the point θ = π/4."],
  ["review", "Find the normal to the ellipse x^2/25 + y^2/16 = 1 at the point 'θ' = π/4."],
  ["review LaTeX", "Find the tangent to the ellipse $\\frac{x^2}{25}+\\frac{y^2}{9}=1$ at $\\theta=\\pi/4$."],
  ["review LaTeX", "P(\\theta) is a point on the hyperbola \\frac{x^2}{16}-\\frac{y^2}{9}=1. Find the tangent at P."],
  ["review", "The ellipse is x = 3 cos t, y = 2 sin t. Find the tangent at t = π/3."],
  ["review curve named by its equation", "Find the tangent at the point with eccentric angle π/4 on x^2/25 + y^2/9 = 1 and also find the foci."],
  ["review misspelling", "Find the point on the ellipse x^2/25 + y^2/9 = 1 with excentric angle 60°."],
  ["review", "Points P(θ1) and Q(θ2) lie on the ellipse x^2/16 + y^2/9 = 1 with θ1 = π/4 and θ2 = 3π/4. Draw the chord PQ."],
  ["review", "Points P(θ₁) and Q(θ₂) lie on the ellipse x^2/16 + y^2/9 = 1 with θ₁ - θ₂ = π/2."],
  ["review optional", "On the rectangular hyperbola xy = c^2 the point (ct, c/t) has t = 2 with c = 4. Find the tangent there."],
  // One stem per reading that no other reading catches.
  ["only eccentric angle, curve named by its equation", "Find the points on x^2/25 + y^2/9 = 1 with eccentric angles π/6 and π/3, and its foci and directrices."],
  ["only excentric angle", "Find the point on the ellipse x^2/25 + y^2/9 = 1 whose excentric angle is 60°."],
  ["only auxiliary circle", "Draw the auxiliary circle of the ellipse x^2/25 + y^2/9 = 1 and mark the point on it above the focus."],
  ["only parametric form", "parametric form of a point on a hyperbola"],
  ["only parametric equations", "Write the parametric equations of the hyperbola x^2/9 - y^2/4 = 1."],
  ["only parametric representation", "Give the parametric representation of the ellipse x^2/9 + y^2/4 = 1."],
  ["only where", "Find the tangent to the ellipse x^2/16 + y^2/9 = 1 where θ = π/3."],
  ["only for", "Find the point on the hyperbola x^2/9 - y^2/4 = 1 for θ = π/3."],
  ["only when", "Find the tangent to the ellipse x^2/25 + y^2/9 = 1 when θ = π/6."],
  ["only corresponding to", "Find the tangent to the ellipse x^2/25 + y^2/9 = 1 corresponding to θ = 2π/3."],
  ["only par", "Ellipse x^2/25 + y^2/9 = 1 par θ = π/4 wala point dikhao."],
  ["only pe", "ellipse x^2/25 + y^2/9 = 1 pe theta = 60 degree wala point batao"],
  ["only a LaTeX dollar and backslash", "Find the tangent to the ellipse x^2/25 + y^2/9 = 1 at $\\theta=\\pi/4$."],
  ["only a LaTeX P(\\theta)", "Let P(\\theta) lie on the ellipse x^2/25 + y^2/9 = 1. Find the tangent at P."],
  ["only a variant Greek letter", "P(ϑ) is a point on the ellipse x^2/25 + y^2/9 = 1. Find the tangent at P."],
  ["only a LaTeX var letter", "Find the tangent to the ellipse x^2/25 + y^2/9 = 1 at $\\varphi=\\pi/4$."],
  ["only α and β", "P(α) and Q(β) are points on the ellipse x^2/25 + y^2/9 = 1 such that the chord PQ subtends a right angle at the centre."],
  ["only alpha and beta spelled", "P(alpha) and Q(beta) lie on the ellipse x^2/25 + y^2/9 = 1. Find the chord PQ."],
  ["only a subscript", "Points P(θ_1) and Q(θ_2) on the ellipse x^2/16 + y^2/9 = 1 subtend a right angle at the centre."],
  ["only parameter is", "Find the point on the hyperbola x^2/16 - y^2/9 = 1 whose parameter is π/6."],
  ["only a trig function of θ", "Find the tangent to the hyperbola x^2/a^2 - y^2/b^2 = 1 at the point (a sec θ, b tan θ)."],
  ["only a trig function of θ, unspaced", "Find the tangent to the ellipse at (acosθ, bsinθ)."],
  ["only a trig function of t", "The ellipse x = 3 cos t, y = 2 sin t: find its foci."],
  ["only a trig function of t, unspaced before", "Find the foci of the ellipse (acos t, bsin t)."],
  ["only at t with an angle", "Find the tangent to the ellipse x^2/9 + y^2/4 = 1 at t = π/3."],
  ["only the point θ", "Find the normal to the hyperbola x^2/16 - y^2/9 = 1 at the point θ = π/3."],
  ["only a quoted name", "Find the tangent to the hyperbola x^2/16 - y^2/9 = 1 at 'θ' = π/3."],
  ["only the point 'θ'", "Find the normal to the hyperbola x^2/16 - y^2/9 = 1 at the point 'θ' = π/3."],
  ["only (ct, c/t)", "On the rectangular hyperbola xy = 16 the point (4t, 4/t) has t = 2. Find the tangent there."],
  ["only no curve word, not a parabola", "Find the foci of x^2/25 + y^2/9 = 1 and the tangent at θ = π/4."],
];
for (const [reading, stem] of PARAMETER_ANGLE_STEMS) {
  const requires = sceneDemand(stem).requires;
  check(requires.includes("plotted_conic") && !requires.includes("conic"),
    `${reading}: "${stem}" places a point by its parameter angle and asks for a plotted conic, got ${JSON.stringify(requires)}`);
}

/* Stems that are not a parameter angle point keep the conic operator. */
const NOT_PARAMETER_ANGLE_STEMS: [string, string][] = [
  ["a polar angle from the centre", "A point moves on the ellipse x^2/9 + y^2/4 = 1 so that OP makes an angle θ = π/4 with the x-axis. Find P."],
  ["a tangent's inclination", "Find the tangent to the ellipse x^2/25 + y^2/9 = 1 that makes an angle θ = 45° with the x axis."],
  ["a parabola's point P(t)", "On the parabola y^2 = 8x find the point P(t) with t = 2 and the tangent at P."],
  ["a time, not an angle", "A satellite moves on an ellipse; at t = 2 s find its speed."],
  ["cost is not cos t", "Find the minimum cost of fencing an ellipse x^2/9 + y^2/4 = 1 at cost 5."],
  ["constant t is not tan t", "The constant t in the ellipse x^2/9 + y^2/4 = 1 equation."],
  ["an alpha particle's path", "The path of an alpha particle near a nucleus is a hyperbola. Find its eccentricity."],
];
for (const [reading, stem] of NOT_PARAMETER_ANGLE_STEMS) {
  const requires = sceneDemand(stem).requires;
  check(requires.includes("conic") && !requires.includes("plotted_conic"),
    `${reading}: "${stem}" is not a parameter angle point, got ${JSON.stringify(requires)}`);
}
check(sceneDemand("Two point charges hang on a string near a long straight wire carrying current.").forbids.includes("suspended_body"),
  "the magnetic veto on suspended_body is unchanged by the thread exemption");
check(sceneDemand("Two point charges of 2 μC are 3 cm apart. Find the Coulomb force.").forbids.includes("suspended_body"),
  "an electrostatic stem with no suspension still forbids suspended_body");
check(sceneDemand("A current carrying wire hangs from two threads in a magnetic field.").forbids.includes("suspended_body"),
  "threads do not lift the magnetic veto");
// Only a thread counts as suspension: threading and threaded do not hang anything.
for (const stem of [
  "Find the electric flux threading a closed surface that encloses point charges of 2 μC and -3 μC.",
  "A bead of charge q is threaded on a smooth vertical circular ring, and a point charge Q sits at the bottom of the ring. Find the equilibrium angle.",
  "An electron is threaded through a uniform electric field between plates. Find the deflection using Coulomb.",
]) {
  check(sceneDemand(stem).forbids.includes("suspended_body"), `"${stem}" is not hung on a thread and still forbids suspended_body`);
}
check(!sceneDemand("A charged sphere hangs on a thread in a uniform horizontal electric field and the thread makes 37° with the vertical. Find the charge using Coulomb's law.").forbids.includes("suspended_body")
  && !sceneDemand("Two point charges hang from threads of length 50 cm attached to the same point. Find the angle between the threads using Coulomb's law.").forbids.includes("suspended_body"),
  "a thread or threads still count as suspension");

const summary = [...counts.entries()].map(([name, count]) => `${name}=${count}`).join(" ");
console.log(`verify-picture-demand-conic-operator: rows=${fixture.rows.length} (${summary}) conic topics=${conicTopics.size}`);
if (failures.length > 0) {
  console.error(`verify-picture-demand-conic-operator: FAILED (${failures.length})`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("verify-picture-demand-conic-operator: ok");
