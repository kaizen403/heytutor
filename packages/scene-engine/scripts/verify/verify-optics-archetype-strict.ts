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
  imageDistancesFromStem,
  imageNatureFromStem,
  namesSeveralOpticalElements,
  objectDistanceNamesObject,
  opticsArchetypePlanAgreement,
  opticsArchetypeStrictEligibility,
  opticsConfigurationIssue,
  type SceneDocument,
} from "../../src";
import { OPTICS_ARCHETYPE_FIXTURES, REVIEW2_FIXTURES, type OpticsFixture } from "./fixtures/optics-archetype-strict";
import { checkOpticsSpanLayout } from "../lib/opticsSpanLayout";

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

/** The honest plan for a figure: its own u and f as given magnitudes, v derived. */
function figurePlan(document: SceneDocument) {
  return plan(["u", "f", "v"].flatMap((id): Array<[string, number, string | null]> => {
    const row = document.quantities.find((item) => item.id === id);
    return row && typeof row.value === "number" ? [[id, Math.abs(row.value), String(row.unit)]] : [];
  }));
}

/**
 * Measured spans: u, f and v each get one dimension bar whose ends are the
 * element centre and the figure's own object, focus or image point, whose
 * text is the hand value in the question's unit, and which the compiled
 * layout keeps clear of the rays, the element, the other spans and labels.
 */
function assertSpans(id: string, draw: Draw, document: SceneDocument, renderScene: Parameters<typeof checkOpticsSpanLayout>[1]) {
  const lens = draw.archetype === "thin_lens";
  const element = lens ? "O" : "P";
  const expected = cartesian(draw);
  const text = (key: string, value: number) => `${key}=${Number(value.toPrecision(3))} ${draw.unit}`;
  const spans = [
    { id: "dim_u", key: "u", text: text("u", draw.u), element, point: "O_base", x: expected.u },
    { id: "dim_f", key: "f", text: text("f", draw.f), element, point: lens ? (draw.kind === "convex" ? "F2" : "F1") : "F", x: expected.f },
    { id: "dim_v", key: "v", text: text("v", draw.v), element, point: "I_base", x: expected.v },
  ];
  const dimensions = document.entities.filter((entity) => entity.kind === "dimension");
  assert.deepEqual(dimensions.map((entity) => entity.id).sort(), ["dim_f", "dim_u", "dim_v"], `${id}: u, f and v spans`);
  for (const span of spans) {
    assert.equal(dimensions.find((entity) => entity.id === span.id)?.label, span.text, `${id}: ${span.key} span text`);
    const make = document.constructions.find((construction) => construction.operator === "dimension" && construction.outputs.includes(span.id));
    assert.equal(make?.inputs.start, span.element, `${id}: ${span.key} span starts at the element`);
    assert.equal(make?.inputs.end, span.point, `${id}: ${span.key} span ends at ${span.point}`);
    const end = document.constructions.find((construction) => construction.operator === "point" && construction.outputs.includes(span.point))?.inputs;
    const start = document.constructions.find((construction) => construction.operator === "point" && construction.outputs.includes(span.element))?.inputs;
    // World lengths are centimetres, Cartesian, element at the origin: the span ends where the value says, on its side.
    close(Number(end?.x), span.x * CM[draw.unit], `${id}: ${span.key} span end x`);
    assert.equal(Number(end?.y), 0, `${id}: ${span.key} span end is on the axis`);
    assert.deepEqual([start?.x, start?.y], [0, 0], `${id}: ${span.key} span starts at the element centre`);
  }
  const layout = checkOpticsSpanLayout(document, renderScene, spans);
  assert.deepEqual(layout.problems, [], `${id}: span layout`);
}

/** A value read from neither the question nor the plan gets no span; v needs both u and f. */
function assertSpansOnlyForVerifiedValues(id: string, document: SceneDocument, sources: Record<string, string>) {
  if (!["thin_lens", "spherical_mirror"].includes(String(document.source.archetype))) return;
  const read = (key: string) => sources[key] === "stem" || sources[key] === "plan";
  const verified = { u: read("u"), f: read("f"), v: read("u") && read("f") };
  for (const [key, ok] of Object.entries(verified)) {
    const span = document.entities.find((entity) => entity.id === `dim_${key}`);
    assert.equal(Boolean(span), ok, `${id}: ${key} span ${ok ? "drawn for a verified value" : "absent for an unverified value"}`);
  }
}

let drawn = 0;
let declined = 0;
for (const fixture of OPTICS_ARCHETYPE_FIXTURES) {
  const attempt = attemptArchetypeScene({ question: fixture.question });
  const document = attempt.scene?.document;
  if (attempt.scene && attempt.match) assertSpansOnlyForVerifiedValues(fixture.id, attempt.scene.document, attempt.match.sources);
  if ("decline" in fixture) {
    declined++;
    if (fixture.decline === "elements") assert.ok(namesSeveralOpticalElements(fixture.question), `${fixture.id}: two elements are named`);
    if (fixture.decline === "configuration") assert.ok(opticsConfigurationIssue(fixture.question), `${fixture.id}: not one plain configuration`);
    if (fixture.decline === "unitless") assert.equal(attempt.match?.slots.conflict, "unitless", `${fixture.id}: a length with no unit`);
    if (["elements", "conflict", "configuration", "unitless"].includes(fixture.decline)) {
      assert.equal(attempt.scene, null, `${fixture.id}: no single lens or mirror figure for a ${fixture.decline} decline`);
    } else if (document) {
      assert.equal(opticsArchetypeStrictEligibility(fixture.question, document, figurePlan(document)).eligible, false, `${fixture.id}: a value the question does not state keeps strict off`);
    }
    continue;
  }
  drawn++;
  const { draw } = fixture;
  assert.ok(document, `${fixture.id}: draws (${attempt.declined ?? "no scene"})`);
  assert.equal(attempt.scene!.archetype, draw.archetype, `${fixture.id}: archetype`);
  assert.equal(attempt.scene!.tier, "exact_verified", `${fixture.id}: exact (u ${attempt.match?.slots.u} ${attempt.match?.sources.u})`);
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
  assertSpans(fixture.id, draw, document, attempt.scene!.renderScene);
  const eligibility = opticsArchetypeStrictEligibility(fixture.question, document, figurePlan(document));
  assert.ok(eligibility.eligible, `${fixture.id}: strict eligible (${eligibility.reason})`);
  // Strict binds by role: no plan, a plan without a given u or focal row, a role-free length
  // equal to one of the figure's (membership), or a plan u or f that is not the figure's, declines.
  const fRow: [string, number, string | null] = ["f", draw.f, draw.unit];
  const uRow: [string, number, string | null] = ["u", draw.u, draw.unit];
  for (const [form, rows] of [
    ["no plan", []],
    ["no focal row", [uRow]],
    ["no object distance row", [fRow]],
    ["object distance only derived", [fRow, ["v", draw.v, draw.unit]]],
    ["a role-free length equal to u", [uRow, fRow, ["d", draw.u, draw.unit]]],
    ["a role-free length equal to v", [uRow, fRow, ["x", draw.v, draw.unit]]],
    ["plan u is not the figure's", [["u", draw.u * 2, draw.unit], fRow]],
    ["plan v is not the figure's", [uRow, fRow, ["v", draw.v * 1.5, draw.unit]]],
  ] as Array<[string, Array<[string, number, string | null]>]>) {
    assert.equal(opticsArchetypeStrictEligibility(fixture.question, document, plan(rows)).eligible, false, `${fixture.id}: strict declines with ${form}`);
  }

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
assert.equal(opticsArchetypeStrictEligibility(q36.question, q36Old, plan([["P", -2, "D"], ["u", 75, "cm"], ["v", -30, "cm"]])).eligible, false, "q36: the converging figure is not the question's");

// A plan figure that only claims the archetype is not the engine's figure.
const forged = structuredClone(q36Doc);
forged.quantities = forged.quantities.map((row) => row.id === "u" ? { ...row, value: -0.75 } : row);
assert.equal(opticsArchetypeStrictEligibility(q36.question, forged, plan([["P", -2, "D"], ["u", 0.75, "cm"]])).eligible, false, "a figure whose u is not the question's is not eligible");

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

// A stock value draws no span: only the stated value is measured, and v (solved from both) is not.
for (const [question, spans] of [
  ["A convex lens has focal length 10 cm. Draw the ray diagram.", ["f=10 cm"]],
  ["An object is 20 cm from a convex lens. Draw the ray diagram.", ["u=20 cm"]],
  ["Draw the ray diagram for a concave mirror of focal length 15 cm.", ["f=15 cm"]],
  ["An object is placed 30 cm in front of a concave mirror. Draw the ray diagram.", ["u=30 cm"]],
] as const) {
  const attempt = attemptArchetypeScene({ question });
  assert.ok(attempt.scene && attempt.match, `${question}: draws`);
  assert.deepEqual(attempt.scene.document.entities.filter((entity) => entity.kind === "dimension").map((entity) => entity.label), spans, `${question}: spans`);
  assertSpansOnlyForVerifiedValues(question, attempt.scene.document, attempt.match.sources);
}

// The object distance is measured from the element (review 1): never an image distance, never from a
// screen, an object, a wall or another body.
for (const question of [
  "A concave mirror of focal length 20 cm forms an image at a distance of 60 cm from the mirror. Find the object distance.",
  "A convex lens of focal length 20 cm forms an image at a distance of 60 cm. Find the object distance.",
  "A screen is placed 90 cm from an object. A converging lens of focal length 20 cm forms a sharp image on the screen.",
  "A candle stands 1.5 m from a screen. A convex lens of focal length 0.24 m forms an image on it.",
  "A lamp is 80 cm from the wall. A convex lens of focal length 15 cm is used to form its image.",
  "The screen is 60 cm from the convex lens of focal length 20 cm. Find where the object is.",
  "A convex lens of focal length 20 cm forms an image 60 cm away from an object. Find the object distance.",
]) {
  assert.equal(attemptArchetypeScene({ question }).match?.slots.u, undefined, `u is not read: ${question}`);
}
for (const [question, u] of [
  ["A stamp collector holds a converging lens of focal length 16 cm at 12 cm from a stamp 0.8 cm wide.", 12],
  ["An object is placed at a distance of 25 cm from the pole of a concave mirror of focal length 10 cm.", 25],
  ["Concave mirror, f = 15 cm, object at 20 cm. Locate the image.", 20],
  ["A convex lens of focal length 10 cm forms an image of an object placed 15 cm away.", 15],
] as const) {
  assert.equal(attemptArchetypeScene({ question }).match?.slots.u, u, `u is read: ${question}`);
}
// A mirror plan with a power row, or any plan length the check cannot assign, refuses.
const mirrorFixture = OPTICS_ARCHETYPE_FIXTURES.find((fixture) => fixture.id === "w_converging_mirror")!;
const mirrorDoc = attemptArchetypeScene({ question: mirrorFixture.question }).scene!.document;
assert.deepEqual(opticsArchetypePlanAgreement(mirrorDoc, plan([["d_obj", 30, "cm"], ["f", 10, "cm"], ["d_img", 15, "cm"]]), mirrorFixture.question).issues, [], "d_obj and d_img are u and v");
// An id the check cannot assign is compared with every figure length: it must be one of them.
for (const [id, value, unit] of [["x1", 45, "cm"], ["D", 90, "cm"], ["u_1", 35, "cm"], ["d", 45, null], ["P", 10, "D"], ["separation", 0.45, "m"]] as Array<[string, number, string | null]>) {
  assert.ok(opticsArchetypePlanAgreement(mirrorDoc, plan([["u", 30, "cm"], ["f", 10, "cm"], [id, value, unit]]), mirrorFixture.question).issues.length > 0, `an unassigned plan row ${id} refuses`);
}
for (const [id, value, unit] of [["d", 30, "cm"], ["x1", 0.15, "m"], ["w", 2, "cm"]] as Array<[string, number, string | null]>) {
  assert.deepEqual(opticsArchetypePlanAgreement(mirrorDoc, plan([["u", 30, "cm"], ["f", 10, "cm"], [id, value, unit]]), mirrorFixture.question).issues, [], `a plan row ${id} = ${value} ${unit} is one of the figure's lengths or a height`);
}

// Review 2: every input that drew a wrong figure with strict on. For each recorded-shape plan, no
// lens or mirror figure is saved unless it is the hand truth, and strict never draws one.
let review2 = 0;
for (const fixture of REVIEW2_FIXTURES) {
  if (fixture.decline === "configuration") assert.ok(opticsConfigurationIssue(fixture.question), `${fixture.id}: not one plain configuration`);
  for (const rows of fixture.plans) {
    review2++;
    const scene = attemptArchetypeScene({ question: fixture.question, turnPlan: plan(rows) }).scene;
    if (fixture.decline === "configuration") { assert.equal(scene, null, `${fixture.id} ${JSON.stringify(rows)}: no figure`); continue; }
    if (!scene) continue;
    const doc = scene.document;
    assert.equal(opticsArchetypeStrictEligibility(fixture.question, doc, plan(rows)).eligible, false, `${fixture.id} ${JSON.stringify(rows)}: strict declines`);
    const saved = opticsArchetypePlanAgreement(doc, plan(rows), fixture.question).issues.length === 0;
    if (!saved) continue;
    const truth = fixture.truth;
    assert.ok(truth, `${fixture.id}: a saved figure has a truth`);
    const expected = cartesian({ ...truth, unit: "cm", m: 0 });
    for (const id of ["u", "f", "v"] as const) close(quantity(doc, id).value, expected[id], `${fixture.id} ${JSON.stringify(rows)}: saved ${id} is the truth`);
  }
}
// F1: a focal length window stays in its clause and never reads another quantity's number.
for (const id of ["r2_f1_focal_from_image", "r2_f1_focal_if_v"]) {
  assert.equal(attemptArchetypeScene({ question: REVIEW2_FIXTURES.find((row) => row.id === id)!.question }).match?.slots.f, undefined, `${id}: f is not read from v`);
}
for (const question of [
  "A concave mirror forms an image 60 cm away. Find the focal length; v = 60 cm and u = 30 cm.",
  "Find the focal length, and the image 60 cm from a convex lens, for an object 30 cm from the lens.",
  "Find the focal length when the image is 60 cm from a concave mirror and the object 30 cm from it.",
  "What is the focal length if u = 30 cm and v = 60 cm for a convex lens?",
  "Find the radius of curvature if v = 60 cm for an object 30 cm from a concave mirror.",
]) {
  const match = attemptArchetypeScene({ question }).match;
  assert.equal(match?.sources.f === "stem", false, `f is not read: ${question}`);
}
for (const [question, f] of [
  ["A convex lens has a focal length of 10 cm. An object is 30 cm from the lens.", 10],
  ["A convex lens of focal length f = 12 cm forms an image of an object 30 cm from the lens.", 12],
  ["A concave mirror (focal length: 15 cm) forms an image of an object 30 cm in front of it.", 15],
  ["The focal length of the lens is 20 cm. An object is 30 cm from the convex lens.", 20],
  ["A concave mirror has a radius of curvature of 40 cm. An object is 30 cm in front of it.", 20],
] as const) {
  assert.equal(attemptArchetypeScene({ question }).match?.slots.f, f, `f is read: ${question}`);
}
// F2: a receiver (wall, film, card, paper, board, detector) is where the image forms: its distance is v, never u.
for (const id of ["r2_f2_wall", "r2_f2_film", "r2_f2_card", "r2_f2_paper", "r2_f2_board", "r2_f2_detector"]) {
  const fixture = REVIEW2_FIXTURES.find((row) => row.id === id)!;
  assert.equal(attemptArchetypeScene({ question: fixture.question }).match?.slots.u, undefined, `${id}: the receiver distance is not u`);
  assert.deepEqual(imageDistancesFromStem(fixture.question).map((length) => length.cm), [fixture.truth!.v], `${id}: the receiver distance is the stated image distance`);
}
// The stem's image distance and nature: read, and held against the figure by the save check.
for (const [question, v, nature] of [
  ["A concave mirror forms a real image 60 cm in front of it. Find the focal length.", [60], { real: true }],
  ["A convex lens forms a virtual, erect and magnified image 20 cm from the lens.", [20], { real: false, inverted: false, magnified: true }],
  ["Is the image real or virtual? An object 2 cm tall stands upright 30 cm from a convex lens.", [], {}],
  ["The image is not inverted. A screen is 45 cm from the lens.", [45], {}],
  ["An object 3 cm tall forms an image 4.5 cm tall on a screen.", [], {}],
  ["The image formed by a lens of focal length 10 cm is 30 cm from the lens.", [30], {}],
] as const) {
  assert.deepEqual(imageDistancesFromStem(question).map((length) => length.cm), v, `image distance: ${question}`);
  assert.deepEqual(imageNatureFromStem(question), nature, `image nature: ${question}`);
}
// A figure whose image disagrees with the stem's distance, side or nature is refused (F1 drew u=30 f=60: v=+60, virtual).
const misreadF1 = attemptArchetypeScene({ question: "An object is placed 30 cm in front of a concave mirror. Draw the ray diagram.", turnPlan: plan([["u", 30, "cm"], ["f", 60, "cm"]]) }).scene!.document;
for (const id of ["r2_f1_focal_from_image", "r2_f1_focal_if_v"]) {
  const fixture = REVIEW2_FIXTURES.find((row) => row.id === id)!;
  assert.ok(opticsArchetypePlanAgreement(misreadF1, plan([["u", 30, "cm"], ["f", 60, "cm"]]), fixture.question).issues.some((issue) => /real|side/.test(issue)), `${id}: a virtual image figure for a real image stem refuses`);
}
const truthF1 = attemptArchetypeScene({ question: "An object is placed 30 cm in front of a concave mirror. Draw the ray diagram.", turnPlan: plan([["u", 30, "cm"], ["f", 20, "cm"]]) }).scene!.document;
assert.deepEqual(opticsArchetypePlanAgreement(truthF1, plan([["u", 30, "cm"], ["f", 20, "cm"], ["v", 60, "cm"]]), REVIEW2_FIXTURES[1]!.question).issues, [], "the true F1 figure (f = 20, real image 60 cm in front) agrees");
// The u clause names the object, or strict declines rather than guess.
assert.equal(objectDistanceNamesObject("A candle stands 36 cm in front of a convex lens of focal length 24 cm."), true);
assert.equal(objectDistanceNamesObject("A wall is 30 cm from a concave mirror of focal length 10 cm."), null);
assert.equal(objectDistanceNamesObject("It is 30 cm from a concave mirror of focal length 10 cm."), false);
assert.equal(objectDistanceNamesObject("Concave mirror, f = 15 cm, u = 20 cm."), true, "the symbol u is bound by its own name");
{
  // A u read from a clause that names no object ("it is 30 cm from") keeps strict off even with an honest plan.
  const question = "It is 30 cm from a concave mirror of focal length 10 cm. Find the image.";
  const doc = attemptArchetypeScene({ question }).scene!.document;
  assert.equal(opticsArchetypeStrictEligibility(question, doc, figurePlan(doc)).eligible, false, "strict declines a u clause that names no object");
}
// F4: a second body between, a second position, a replaced element, a distance from the focus.
for (const question of [
  "A glass cube of side 2 cm is placed between the lens and the image of an object 30 cm from a convex lens of focal length 20 cm.",
  "A thin sheet of glass is inserted in the path. An object is 30 cm from a convex lens of focal length 20 cm.",
  "An object is 30 cm from a convex lens of focal length 20 cm. A glass cube of side 3 cm lies on the axis beyond the lens.",
  "An object is 30 cm from a convex lens of focal length 20 cm. A thin film sits between the lens and the screen.",
  "An object is 30 cm from a concave mirror of focal length 20 cm. The object is then placed 15 cm from the mirror.",
  "A convex lens of focal length 20 cm images an object 30 cm away; it is replaced by another of focal length 10 cm.",
  "An object 10 cm beyond F of a concave mirror of focal length 20 cm forms an image.",
  "An object is 10 cm from the principal focus of a convex lens of focal length 20 cm.",
]) {
  assert.ok(opticsConfigurationIssue(question), `not one plain configuration: ${question}`);
  assert.equal(attemptArchetypeScene({ question }).scene, null, `no figure: ${question}`);
}
assert.equal(attemptArchetypeScene({ question: "An object is 10 cm from the mirror's focus." }).match?.slots.u, undefined, "a distance from the focus is not u");
assert.equal(attemptArchetypeScene({ question: "An object is 10 cm from the focus of the lens." }).match?.slots.u, undefined, "a distance from the lens's focus is not u");

// Element counting: one element stays one.
for (const single of ["A convex lens has focal length 10 cm. An object is 30 cm from the lens.", "A magnifying glass of power +17.5 D forms the final image at the near point, 25 cm from the eye.", "A concave mirror of focal length 15 cm forms an image of an object 20 cm in front of it."]) {
  assert.equal(namesSeveralOpticalElements(single), false, single);
}
for (const several of ["A lens and a mirror are 20 cm apart.", "Two thin lenses of focal lengths 10 cm and 20 cm are placed in contact.", "An object is 30 cm from lens A; lens B is 20 cm beyond lens A."]) {
  assert.equal(namesSeveralOpticalElements(several), true, several);
}
console.log(`verify-optics-archetype-strict: ${drawn} drawn and ${declined} declined fixtures, ${review2} review 2 input plans; plan agreement, role bound strict eligibility and the stem cross check hold`);
