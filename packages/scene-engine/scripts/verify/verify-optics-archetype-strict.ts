/**
 * The optics-figures branch owns this gate. No model or network calls.
 *
 * The engine's thin lens and spherical mirror figure, against values worked by
 * hand (fixtures/optics-archetype-strict.ts): the question's own unit, the kind
 * from the sign of a power or focal length, one optical element, a scale the
 * board can show; the plan agreement that the save applies to that figure;
 * and the strict eligibility rule that lets strict draw it.
 */
import assert from "node:assert/strict";
import {
  attemptArchetypeScene,
  namesSeveralOpticalElements,
  opticsArchetypePlanAgreement,
  opticsArchetypeStrictEligibility,
  type SceneDocument,
} from "../../src";
import { OPTICS_ARCHETYPE_FIXTURES, type OpticsFixture } from "./fixtures/optics-archetype-strict";

const CM = { cm: 1, mm: 0.1, m: 100 } as const;
const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= 1e-6 * Math.max(1, Math.abs(expected)), `${what}: ${actual} is not ${expected}`);

function quantity(document: SceneDocument, id: string): { value: number; unit: string } {
  const row = document.quantities.find((item) => item.id === id);
  assert.ok(row && typeof row.value === "number", `quantity ${id} is written`);
  return { value: row.value as number, unit: String(row.unit) };
}

type Draw = Extract<OpticsFixture, { draw: unknown }>["draw"];

/** Cartesian signed values the generator must write, from the hand values. */
function cartesian(draw: Draw) {
  const lens = draw.archetype === "thin_lens";
  const f = lens ? (draw.kind === "convex" ? draw.f : -draw.f) : (draw.kind === "concave" ? -draw.f : draw.f);
  const v = lens ? (draw.real ? draw.v : -draw.v) : (draw.real ? -draw.v : draw.v);
  return { u: -draw.u, f, v };
}

function plan(rows: Array<[string, number, string | null]>) {
  return {
    givens: rows.filter(([id]) => id !== "v" && id !== "m").map(([id, value, unit]) => ({ id, symbol: id, value, unit })),
    derived: rows.filter(([id]) => id === "v" || id === "m").map(([id, value, unit]) => ({ id, symbol: id, value, unit, provenance: "derived" })),
  };
}

let drawn = 0;
let declined = 0;
for (const fixture of OPTICS_ARCHETYPE_FIXTURES) {
  const attempt = attemptArchetypeScene({ question: fixture.question });
  const document = attempt.scene?.document;
  if ("decline" in fixture) {
    declined++;
    if (fixture.decline === "elements") assert.ok(namesSeveralOpticalElements(fixture.question), `${fixture.id}: two elements are named`);
    if (fixture.decline === "elements" || fixture.decline === "conflict") {
      assert.equal(attempt.scene, null, `${fixture.id}: no single lens or mirror figure for a ${fixture.decline} decline`);
    } else if (document) {
      assert.equal(opticsArchetypeStrictEligibility(fixture.question, document).eligible, false, `${fixture.id}: a value the question does not state keeps strict off`);
    }
    continue;
  }
  drawn++;
  const { draw } = fixture;
  assert.ok(document, `${fixture.id}: draws (${attempt.declined ?? "no scene"})`);
  assert.equal(attempt.scene!.archetype, draw.archetype, `${fixture.id}: archetype`);
  assert.equal(attempt.scene!.tier, "exact_verified", `${fixture.id}: exact`);
  assert.equal(namesSeveralOpticalElements(fixture.question), false, `${fixture.id}: one element`);
  const expected = cartesian(draw);
  for (const id of ["u", "f", "v"] as const) {
    const row = quantity(document, id);
    assert.equal(row.unit, draw.unit, `${fixture.id}: ${id} is written in the question's unit`);
    close(row.value, expected[id], `${fixture.id}: ${id}`);
  }
  const u = quantity(document, "u").value;
  const v = quantity(document, "v").value;
  close(draw.archetype === "thin_lens" ? v / u : -v / u, draw.m, `${fixture.id}: magnification`);
  const spans = document.entities.filter((entity) => entity.kind === "dimension").map((entity) => entity.label ?? "");
  assert.ok(spans.includes(`u=${Number(draw.u.toPrecision(3))} ${draw.unit}`), `${fixture.id}: u span ${JSON.stringify(spans)}`);
  for (const span of spans) assert.match(span, new RegExp(`^[ufv](?:=\\d+(?:\\.\\d+)? ${draw.unit})?$`), `${fixture.id}: span ${span} speaks the question's unit`);
  const eligibility = opticsArchetypeStrictEligibility(fixture.question, document);
  assert.ok(eligibility.eligible, `${fixture.id}: strict eligible (${eligibility.reason})`);

  // The save agreement: every honest plan form agrees, every wrong one refuses.
  const unit = draw.unit;
  const realPositiveV = draw.real ? draw.v : -draw.v;
  const realPositiveF = draw.archetype === "thin_lens" ? expected.f : -expected.f;
  const otherUnit = unit === "cm" ? "m" : "cm";
  const inOther = (value: number) => value * CM[unit] / CM[otherUnit];
  const honest: Array<[string, Array<[string, number, string | null]>]> = [
    ["unsigned", [["u", draw.u, unit], ["f", draw.f, unit], ["v", draw.v, unit]]],
    ["real is positive", [["u", draw.u, unit], ["f", realPositiveF, unit], ["v", realPositiveV, unit], ["m", draw.m, null]]],
    ["cartesian", [["u", expected.u, unit], ["f", expected.f, unit], ["v", expected.v, unit], ["m", draw.m, null]]],
    ["cartesian in another unit", [["u", inOther(expected.u), otherUnit], ["f", inOther(expected.f), otherUnit], ["v", inOther(expected.v), otherUnit]]],
    ["d_o and d_i", [["d_o", draw.u, unit], ["d_i", realPositiveV, unit], ["f", realPositiveF, unit]]],
    ["question only", []],
  ];
  for (const [form, rows] of honest) {
    const agreement = opticsArchetypePlanAgreement(document, plan(rows), fixture.question);
    assert.ok(agreement.applies, `${fixture.id} ${form}: applies`);
    assert.deepEqual(agreement.issues, [], `${fixture.id} ${form}: agrees`);
  }
  const wrong: Array<[string, Array<[string, number, string | null]>]> = [
    ["image distance off by 10%", [["u", draw.u, unit], ["f", draw.f, unit], ["v", draw.v * 1.1, unit]]],
    ["focal length off", [["u", draw.u, unit], ["f", draw.f * 1.5, unit]]],
    ["value in the wrong unit", [["u", draw.u, unit === "m" ? "cm" : "m"], ["f", draw.f, unit]]],
    ["image on the other side (cartesian)", [["u", expected.u, unit], ["f", expected.f, unit], ["v", -expected.v, unit]]],
    ["image on the other side (real is positive)", [["u", draw.u, unit], ["f", realPositiveF, unit], ["v", -realPositiveV, unit]]],
    ["the other kind of element (cartesian)", [["u", expected.u, unit], ["f", -expected.f, unit]]],
    ["magnification sign", [["u", expected.u, unit], ["f", expected.f, unit], ["m", -draw.m, null]]],
    ["length with no unit", [["u", draw.u, null], ["f", draw.f, unit]]],
  ];
  for (const [form, rows] of wrong) {
    // An all positive plan is read as magnitudes: a side flip there is not a written sign.
    if (form.includes("other side") && rows.every(([, value]) => value >= 0)) continue;
    // Mirror magnitudes beside one signed image distance fit one convention or the other.
    if (form === "image on the other side (real is positive)" && draw.archetype === "spherical_mirror" && rows.every(([id, value]) => id === "v" || value >= 0)) continue;
    const agreement = opticsArchetypePlanAgreement(document, plan(rows), fixture.question);
    assert.ok(agreement.issues.length > 0, `${fixture.id} ${form}: refuses`);
  }
}

// Power in a plan: a −2.0 D plan says diverging; the same magnitude as +2.0 D refuses.
const q36 = OPTICS_ARCHETYPE_FIXTURES.find((fixture) => fixture.id === "q36")!;
const q36Doc = attemptArchetypeScene({ question: q36.question }).scene!.document;
assert.deepEqual(opticsArchetypePlanAgreement(q36Doc, plan([["P", -2, "D"], ["u", -75, "cm"], ["v", -30, "cm"]]), q36.question).issues, []);
assert.ok(opticsArchetypePlanAgreement(q36Doc, plan([["P", 2, "D"], ["u", -75, "cm"], ["v", -30, "cm"]]), q36.question).issues.length > 0, "q36: +2.0 D names the other lens");
// The old figure: converging, v = 150 cm. It must never agree with the q36 truth.
const q36Old = structuredClone(q36Doc);
q36Old.quantities = q36Old.quantities.map((row) => row.id === "f" ? { ...row, value: 50 } : row.id === "v" ? { ...row, value: 150 } : row);
assert.ok(opticsArchetypePlanAgreement(q36Old, plan([["P", -2, "D"], ["u", -75, "cm"], ["v", -30, "cm"]]), q36.question).issues.length > 0, "q36: the converging figure refuses");
assert.equal(opticsArchetypeStrictEligibility(q36.question, q36Old).eligible, false, "q36: the converging figure is not the question's");

// A plan figure that only claims the archetype is not the engine's figure.
const forged = structuredClone(q36Doc);
forged.quantities = forged.quantities.map((row) => row.id === "u" ? { ...row, value: -0.75 } : row);
assert.equal(opticsArchetypeStrictEligibility(q36.question, forged).eligible, false, "a figure whose u is not the question's is not eligible");

// Plan values in metres read in metres (q10 drew u=0.75 cm before).
const q10 = OPTICS_ARCHETYPE_FIXTURES.find((fixture) => fixture.id === "q10")!;
const q10Plan = attemptArchetypeScene({ question: q10.question, turnPlan: plan([["u", 0.75, "m"], ["P", -4, "D"]]) }).scene!.document;
assert.equal(quantity(q10Plan, "u").unit, "m");
close(quantity(q10Plan, "u").value, -0.75, "q10 plan u");
close(quantity(q10Plan, "f").value, -0.25, "q10 plan f");

// Recorded plan shapes (lab runs, 9 to 27 Oct): magnitudes given beside signed derived values agree; a wrong derived v refuses.
const planOf = (givens: Array<[string, number, string | null]>, derived: Array<[string, number, string | null]>) => ({
  givens: givens.map(([id, value, unit]) => ({ id, symbol: id, value, unit })),
  derived: derived.map(([id, value, unit]) => ({ id, symbol: id, value, unit, provenance: "derived" })),
});
const recorded: Array<[string, ReturnType<typeof planOf>, boolean]> = [
  ["q31", planOf([["h", 7.5, "cm"], ["d_o", 104, "cm"], ["f", 26, "cm"]], [["v", -34.666666666666664, "cm"], ["m", 1 / 3, null]]), false],
  ["q41", planOf([["R", 32, "cm"], ["h_o", 3, "cm"], ["d_o", 48, "cm"]], [["v", -24, "cm"], ["f", -16, "cm"]]), true],
  ["q76", planOf([["f", 12, "cm"], ["H", 2, "cm"], ["d_o", 8, "cm"]], [["v", -24, "cm"], ["u", -8, "cm"]]), true],
  ["q43", planOf([["R", 0.72, "m"], ["d_o", 0.24, "m"], ["h", 0.02, "m"]], [["v", 0.72, "m"], ["m", 3, null], ["f", -0.36, "m"]]), true],
  ["q41", planOf([["R", 32, "cm"], ["d_o", 48, "cm"]], [["v", -24, "cm"], ["f", 16, "cm"]]), false],
];
for (const [id, recordedPlan, agrees] of recorded) {
  const fixture = OPTICS_ARCHETYPE_FIXTURES.find((row) => row.id === id)!;
  const doc = attemptArchetypeScene({ question: fixture.question }).scene!.document;
  const issues = opticsArchetypePlanAgreement(doc, recordedPlan, fixture.question).issues;
  assert.equal(issues.length === 0, agrees, `${id} recorded plan ${agrees ? "agrees" : "refuses"}: ${issues.join("; ")}`);
}

// Scale: an object 800 focal lengths away is a dot on the axis, so the figure declines.
const q29 = OPTICS_ARCHETYPE_FIXTURES.find((fixture) => fixture.id === "q29")!;
assert.equal(attemptArchetypeScene({ question: q29.question, turnPlan: plan([["u", 64, "m"], ["f", 8, "cm"]]) }).scene, null, "q29: no figure at 800 focal lengths");

// An unread object distance never draws at a stock value beside a stated focal length.
const q29Stem = attemptArchetypeScene({ question: q29.question }).scene;
if (q29Stem) assert.ok(opticsArchetypePlanAgreement(q29Stem.document, plan([["f", 8, "cm"]]), q29.question).issues.length > 0, "q29: stock u beside a stated f refuses");
// A pin height above the axis is not an object distance (q49 read u=2.4 cm).
const q49 = OPTICS_ARCHETYPE_FIXTURES.find((fixture) => fixture.id === "q49")!;
assert.notEqual(attemptArchetypeScene({ question: q49.question }).match?.slots.u, 2.4, "q49: a height above the axis is not u");

// Mixed units draw in centimetres, converted exactly; a placement after "an image of an object" is the object's.
for (const [question, u, f] of [
  ["An object is placed 0.2 m from a concave mirror of focal length 10 cm. Draw the ray diagram.", -20, -10],
  ["An object is placed 300 mm from a convex lens of focal length 10 cm. Draw the ray diagram.", -30, 10],
  ["A convex lens of focal length 10 cm forms an image of an object placed 15 cm away. Draw the ray diagram.", -15, 10],
] as const) {
  const doc = attemptArchetypeScene({ question }).scene!.document;
  assert.equal(quantity(doc, "u").unit, "cm", question);
  close(quantity(doc, "u").value, u, `${question} u`);
  close(quantity(doc, "f").value, f, `${question} f`);
}
assert.equal(attemptArchetypeScene({ question: "A concave mirror forms a real image 60 cm in front of it. Find the focal length." }).match?.slots.u, undefined, "an image distance is never read as u");

// Element counting: one element stays one.
for (const single of ["A convex lens has focal length 10 cm. An object is 30 cm from the lens.", "A magnifying glass of power +17.5 D forms the final image at the near point, 25 cm from the eye.", "A concave mirror of focal length 15 cm forms an image of an object 20 cm in front of it."]) {
  assert.equal(namesSeveralOpticalElements(single), false, single);
}
for (const several of ["A lens and a mirror are 20 cm apart.", "Two thin lenses of focal lengths 10 cm and 20 cm are placed in contact.", "An object is 30 cm from lens A; lens B is 20 cm beyond lens A."]) {
  assert.equal(namesSeveralOpticalElements(several), true, several);
}
console.log(`verify-optics-archetype-strict: ${drawn} drawn and ${declined} declined fixtures, plan agreement and strict eligibility hold`);
