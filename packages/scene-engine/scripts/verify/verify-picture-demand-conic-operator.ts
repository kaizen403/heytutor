/**
 * Picture demand gate: a conic drawn with the engine's own conic operator is a
 * conic, and every other demand the recorded drops faced still holds.
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
 * - thread_spheres: an electrostatic stem whose spheres hang on threads. The
 *   veto on suspended_body still fails it.
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
  thread_spheres: "contradicted by suspended_body",
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
    check(sceneDemand(row.question).forbids.includes("suspended_body"), `${label}: the electrostatic veto forbids suspended_body`);
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
check(sceneDemand("Show that sin(θ) and cos(θ) satisfy the ellipse x^2 + y^2/4 = 1 after scaling.").requires.includes("conic"),
  "sin(θ) is not a named parameter point");
check(sceneDemand("For the ellipse x^2/25 + y^2/16 = 1, find the eccentricity, the foci and the directrices.").requires.includes("conic"),
  "eccentricity is not an eccentric angle");
check(sceneDemand("Two point charges of 2 μC are 3 cm apart. Find the Coulomb force.").forbids.includes("suspended_body"),
  "an electrostatic stem with no suspension still forbids suspended_body");

const summary = [...counts.entries()].map(([name, count]) => `${name}=${count}`).join(" ");
console.log(`verify-picture-demand-conic-operator: rows=${fixture.rows.length} (${summary}) conic topics=${conicTopics.size}`);
if (failures.length > 0) {
  console.error(`verify-picture-demand-conic-operator: FAILED (${failures.length})`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("verify-picture-demand-conic-operator: ok");
