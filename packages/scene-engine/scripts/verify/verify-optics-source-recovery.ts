/** Authored local lesson regressions: exact mirror inputs and a covered-slit setup. No API calls. */
import assert from "node:assert/strict";
import { attemptArchetypeScene } from "../../src/archetypes";
import { applyOpticsSourceAuthority, doubleSlitSource, mirrorSource } from "../../src/physics/opticsSourceAuthority";
import { isChemistryQuestion } from "../../src/chemistry";
import { isKineticsStem } from "../../src/chemistry/kinetics";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { validateSceneQuantityAgreement } from "../../src/contracts/contractsV3";

const mirrorQuestion = "A 4 cm tall object is placed 30 cm in front of a concave mirror with focal length 20 cm. Using the standard Cartesian sign convention, draw a ray diagram and determine the image position, nature, magnification and height.";
const filmQuestion = "In a Young double-slit experiment, the slit spacing is 0.50 mm, the screen is 2 m away and the wavelength is 500 nm. A transparent film of refractive index 1.50 and thickness 2 micrometres covers the upper slit. Using the paraxial approximation, draw the setup and find the fringe spacing, added phase difference and displacement of the tracked zero-order fringe. Is the original screen center bright or dark, and does the final unlabeled intensity pattern differ from before?";
const emptyPlan = (question: string): TurnPlanV3 => ({ schemaVersion: "turn-plan/v3", question, givens: [], derived: [], unknowns: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

for (const [question, position, expectedV] of [
  [mirrorQuestion, "between F and C", -60],
  [mirrorQuestion.replace("30 cm", "50 cm"), "beyond C", -100 / 3],
] as const) {
  const original = emptyPlan(question);
  original.qualitativeClaims = [{ id: "object_beyond_c", claim: "object_beyond_centre", expected: true }];
  const authority = applyOpticsSourceAuthority(question, original);
  assert.ok(authority);
  const region = authority.plan.qualitativeClaims.find(c => c.id === "source_mirror_object_region");
  assert.equal(region?.expected, position);
  assert.ok(!authority.plan.qualitativeClaims.some(c => c.id === "object_beyond_c"));
  near(authority.plan.derived.find(q => q.symbol === "v")!.value, expectedV);
  const attempt = attemptArchetypeScene({ question, turnPlan: authority.plan });
  assert.ok(attempt.scene, attempt.declined);
  assert.equal(attempt.scene.tier, "exact_verified");
  assert.equal(attempt.scene.document.constructions.find(c => c.id === "make_O_tip")?.inputs.y, 4);
  assert.deepEqual(validateSceneQuantityAgreement(attempt.scene.document.quantities, authority.plan), []);
  const mutation = structuredClone(attempt.scene.document);
  mutation.quantities.find(q => q.id === "u")!.value = -20;
  assert.notEqual(validateSceneQuantityAgreement(mutation.quantities, authority.plan).length, 0, "wrong-source mirror mutation must fail");
}
const malformed = emptyPlan(mirrorQuestion);
malformed.givens = [{ id: "u", symbol: "v", value: 900, unit: "cm", provenance: "given" }];
const canonical = applyOpticsSourceAuthority(mirrorQuestion, malformed)!.plan;
const ids = [...canonical.givens, ...canonical.derived].map(q => q.id);
assert.equal(new Set(ids).size, ids.length, "ambiguous planner aliases cannot produce duplicate identifiers");
assert.equal(mirrorSource(mirrorQuestion)?.objectRegion, "between F and C");
assert.equal(mirrorSource("A concave mirror of focal length 20 cm. Find the image."), null);
assert.equal(mirrorSource(mirrorQuestion.replace("20 cm", "20 cm²")), null);
assert.equal(attemptArchetypeScene({ question: mirrorQuestion.replace("20 cm", "20 cm²") }).scene, null);
assert.equal(mirrorSource(mirrorQuestion.replace("20 cm", "20 cm^2")), null);
assert.equal(doubleSlitSource(filmQuestion.replace("500 nm", "500 nm^-1")), null);
assert.ok(doubleSlitSource(filmQuestion + " The apparatus operates in vacuum."));
assert.ok(mirrorSource(mirrorQuestion.replace("draw a ray diagram and determine", "draw a ray diagram, then determine")));
assert.equal(isChemistryQuestion(filmQuestion), false, "zero-order fringe is optics");
assert.equal(isKineticsStem("A zero-order reaction has rate constant 0.02 mol/L/s. Plot concentration against time."), true);

for (const [question, shiftMm] of [
  [filmQuestion, 4],
  [filmQuestion.replace("upper slit", "lower slit"), -4],
  [filmQuestion.replace("2 micrometres", "0.5 micrometres"), 1],
  [filmQuestion.replace("0.50 mm", "0.75 mm").replace("2 micrometres", "3 micrometres"), 4],
] as const) {
  const source = doubleSlitSource(question);
  assert.ok(source?.film);
  near(source.film.shift * 1000, shiftMm);
  const plan = emptyPlan(question);
  plan.givens = [
    { id: "d", symbol: "d", value: source.d, unit: "m", provenance: "given" },
    { id: "L", symbol: "L", value: source.D, unit: "m", provenance: "given" },
  ];
  const sourcePlan = applyOpticsSourceAuthority(question, plan)!.plan;
  const repeated = applyOpticsSourceAuthority(question, sourcePlan)!.plan;
  assert.deepEqual(repeated, sourcePlan, "double-slit authority is idempotent");
  near(sourcePlan.derived.find(q => q.id === "y0")!.value, shiftMm);
  assert.equal(sourcePlan.givens.find(q => q.id === "L")!.value, source.D);
  assert.equal(sourcePlan.givens.find(q => q.id === "d")!.value, source.d);
  const attempt = attemptArchetypeScene({ question, turnPlan: sourcePlan });
  assert.ok(attempt.scene, `${attempt.declined}: ${JSON.stringify(attempt.issues)}`);
  const doc = attempt.scene.document;
  assert.deepEqual(validateSceneQuantityAgreement(doc.quantities, sourcePlan), []);
  near(Number(doc.quantities.find(q => q.id === "d")?.value), source.d * 1000);
  near(Number(doc.quantities.find(q => q.id === "y0")?.value), shiftMm);
  const filmCentre = Number(doc.constructions.find(c => c.id === "make_film_center")?.inputs.y);
  assert.equal(Math.sign(filmCentre), Math.sign(shiftMm));
  assert.ok(doc.entities.some(e => e.id === "film"));
  const y0 = Number(doc.constructions.find(c => c.id === "make_Pf")?.inputs.y);
  assert.equal(Math.sign(y0), Math.sign(shiftMm));
  if (question === filmQuestion) near(source.film.phase, 4 * Math.PI);
}
const staleFilmPlan = emptyPlan(filmQuestion);
staleFilmPlan.givens = [{ id: "L", symbol: "L", value: 3, unit: "m", provenance: "given" },
  { id: "d", symbol: "d", value: 0.009, unit: "m", provenance: "given" }];
staleFilmPlan.derived = [{ id: "beta", symbol: "β", value: 0.01, unit: "m", provenance: "derived" }];
const fixedFilm = applyOpticsSourceAuthority(filmQuestion, staleFilmPlan)!.plan;
near(fixedFilm.givens.find(q => q.id === "L")!.value, 2);
near(fixedFilm.givens.find(q => q.id === "d")!.value, 0.0005);
near(fixedFilm.derived.find(q => q.id === "beta")!.value, 0.002);
assert.equal(fixedFilm.qualitativeClaims.find(c => c.id === "source_double_slit_original_centre")!.expected, "bright maximum");
const unsupported = filmQuestion.replace("upper slit", "unspecified slit");
assert.equal(attemptArchetypeScene({ question: unsupported }).scene, null, "unknown film placement must not draw the uncovered setup");
for (const suffix of [
  " A convex lens of focal length 10 cm is inserted between the object and mirror.",
  " The object is then placed 50 cm in front of the mirror. Find the final image.",
]) {
  assert.equal(mirrorSource(mirrorQuestion + suffix), null);
  assert.equal(attemptArchetypeScene({ question: mirrorQuestion + suffix }).scene, null);
}
for (const suffix of [
  " The entire apparatus is immersed in water of refractive index 1.33; the stated wavelength is in vacuum.",
  " A second film of refractive index 1.4 and thickness 1 micrometre covers the lower slit.",
]) {
  assert.equal(doubleSlitSource(filmQuestion + suffix), null);
  assert.equal(attemptArchetypeScene({ question: filmQuestion + suffix }).scene, null);
}
console.log("optics source recovery: mirror cases, source mutation, SI slit values, film side/phase/shift, chemical-order isolation passed");
