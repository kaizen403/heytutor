/**
 * A projectile or river figure never draws a stock condition in place of one
 * the stem states.
 *
 * The level ground projectile measures its angle from the horizontal, launches
 * from level ground and computed H and R with g = 9.8; the river triangle drew
 * an upstream heading unless a shortest time was asked. So "heading
 * perpendicular to the banks" drew an upstream heading, "30 degrees with the
 * vertical" drew H = 5.1 m where the true H is 15 m, "Take g = 10" and
 * "g = 1.6" kept 9.8, and "from the top of a tower of height h" drew a level
 * ground launch, all on the no ProblemIR path (the fast figure with null
 * authority, and production without ProblemIR). Each repro here must decline
 * or draw the true value, on synthesizeFamilyScene, the fast figure and
 * selectProductionScene. Controls that state only "above the horizontal", no
 * g, or a ground launch keep their exact figure.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  reconcileTurnPlanV3ExplicitArithmetic,
  synthesizeFamilyScene,
  validateTurnPlanV3,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";

type Quantity = TurnPlanV3["givens"][number];
const given = (symbol: string, value: number, unit: string, sourceText = `${symbol} = ${value} ${unit}`): Quantity =>
  ({ id: symbol.replace(/[^a-z0-9_]/gi, "") || "q", symbol, value, unit, provenance: "given", sourceText }) as Quantity;
const derived = (symbol: string, value: number, unit: string): Quantity =>
  ({ id: symbol, symbol, value, unit, provenance: "derived", dependsOn: [], sourceText: `${symbol} = ${value} ${unit}` }) as Quantity;
function plan(question: string, givens: Quantity[] = [], derivedValues: Quantity[] = []): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, givens, unknowns: [], derived: derivedValues,
    qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  } as TurnPlanV3;
}

const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/fast-figure-authority.json"), "utf8")) as {
  cases: Array<{ id: string; question: string; turnPlan: TurnPlanV3 }>;
};
const captured = (id: string) => {
  const entry = fixture.cases.find((item) => item.id === id);
  assert.ok(entry, `fixture ${id} is missing`);
  return entry;
};

interface Drawn { path: string; tier: string; labels: string[]; document: SceneDocument }

function labelsOf(primitives: ReadonlyArray<{ kind: string; text?: string }>): string[] {
  return primitives.flatMap((primitive) => (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text ? [primitive.text] : []);
}

/** Every no ProblemIR path a live turn can take to this figure. */
function drawnOnEveryPath(question: string, turnPlan: TurnPlanV3): Drawn[] {
  const reconciled = reconcileTurnPlanV3ExplicitArithmetic({ ...turnPlan, question }).plan as TurnPlanV3;
  assert.ok(validateTurnPlanV3(reconciled, question).plan, `${question}: the plan must validate, or a null figure proves nothing`);
  const drawn: Drawn[] = [];
  const family = synthesizeFamilyScene({ question, turnPlan: reconciled, problemIR: null });
  if (family) drawn.push({ path: "synthesizeFamilyScene", tier: family.tier, labels: labelsOf(family.renderScene.primitives), document: family.document });
  const families = inferSceneCapabilities(question, { lawIds: reconciled.lawIds, problemIR: null, turnPlan: reconciled }).families;
  const fast = selectFastVerifiedRepresentation({ question, turnPlan: reconciled, problemIR: null, families });
  if (fast) drawn.push({ path: "fast figure", tier: fast.tier, labels: labelsOf(fast.renderScene.primitives), document: fast.sceneDocument });
  for (const fastRepresentation of [fast, null]) {
    const production = selectProductionScene({
      question, turnPlan: reconciled, problemIR: null, candidateValidation: null, fastRepresentation,
      exactFigureSource: "planner", solverAuthorityBlocked: false, requiredRetryEnabled: true,
    }).representation;
    if (production) {
      drawn.push({ path: `selectProductionScene (fast ${fastRepresentation ? "given" : "null"})`, tier: production.tier,
        labels: labelsOf(production.renderScene.primitives), document: production.sceneDocument });
    }
  }
  return drawn;
}

let checks = 0;
const failures: string[] = [];
function check(name: string, run: () => void): void {
  try {
    run();
    checks += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${(error as Error).message}`);
  }
}

/** The value a label such as "H=15 m" states, or null. */
function labelValue(labels: string[], symbol: string): number | null {
  const label = labels.find((text) => new RegExp(`^${symbol}=`).test(text));
  return label ? Number(label.slice(symbol.length + 1).replace(/[^\d.]/g, "")) : null;
}
const near = (value: number | null, truth: number) => value !== null && Math.abs(value - truth) <= 0.01 * truth + 0.051;

/** Declined everywhere, or every drawn figure states the true H and R. */
function declinesOrTrue(question: string, turnPlan: TurnPlanV3, truth: { H?: number; R: number }): void {
  for (const figure of drawnOnEveryPath(question, turnPlan)) {
    const H = labelValue(figure.labels, "H"); const R = labelValue(figure.labels, "R");
    // A horizontal launch has no apex above the launch point to dimension.
    assert.ok((truth.H === undefined ? H === null : near(H, truth.H)) && near(R, truth.R),
      `${figure.path} drew ${figure.tier} ${JSON.stringify(figure.labels)}; true H=${truth.H ?? "none"} m, R=${truth.R} m`);
  }
}
function declines(question: string, turnPlan: TurnPlanV3): void {
  const drawn = drawnOnEveryPath(question, turnPlan);
  assert.equal(drawn.length, 0, drawn.map((figure) => `${figure.path} drew ${figure.tier} ${JSON.stringify(figure.labels)}`).join("; "));
}
const assertionIds = (document: SceneDocument) => new Set(document.assertions.map((assertion) => assertion.id));

/* 1. River: a stated perpendicular heading is drawn perpendicular, or not at all. */

const river = captured("river_numeric");
const riverGivens = [given("v_b", 5, "m/s", "5 m/s in still water"), given("w", 100, "m", "100 m wide"), given("v_r", 3, "m/s", "flowing at 3 m/s")];
function perpendicularOrNone(question: string, turnPlan: TurnPlanV3): void {
  for (const figure of drawnOnEveryPath(question, turnPlan)) {
    const ids = assertionIds(figure.document);
    assert.ok(ids.has("boat_perp") && !ids.has("straight_across") && !figure.labels.some((label) => label.startsWith("α")),
      `${figure.path} drew an upstream heading ${JSON.stringify(figure.labels)} for a perpendicular heading`);
  }
}
check("river: \"heading perpendicular to the banks\" never draws an upstream heading (captured plan)", () =>
  perpendicularOrNone(river.question, plan(river.question, riverGivens, [derived("t", 20, "s"), derived("d", 60, "m")])));
check("river: \"heading perpendicular to the banks\" with givens only", () => perpendicularOrNone(river.question, plan(river.question, riverGivens)));
check("river: the perpendicular heading is drawn (the fix does not just decline)", () => {
  const drawn = drawnOnEveryPath(river.question, plan(river.question, riverGivens));
  assert.ok(drawn.some((figure) => figure.path === "synthesizeFamilyScene"), "the family figure declined");
});
const POINTED = "A boat moves at 5 m/s in still water. It crosses a 100 m wide river flowing at 3 m/s, keeping his boat pointed straight across. Where does he land?";
check("river: \"keeping his boat pointed straight across\" is a perpendicular heading", () => perpendicularOrNone(POINTED, plan(POINTED, riverGivens)));
const SLOW = "A boat moves at 3 m/s in still water. It crosses a 100 m wide river flowing at 5 m/s. Find the minimum drift.";
check("river: a slow boat with no time request declines (the upstream cue would be false)", () =>
  declines(SLOW, plan(SLOW, [given("v_b", 3, "m/s", "3 m/s in still water"), given("w", 100, "m", "100 m wide"), given("v_r", 5, "m/s", "flowing at 5 m/s")])));
const OBLIQUE = "A boat moves at 5 m/s in still water across a river flowing at 3 m/s. It heads at 30 degrees upstream from the bank. Find its resultant velocity.";
check("river: a stated oblique heading the figure does not read declines", () =>
  declines(OBLIQUE, plan(OBLIQUE, [given("v_b", 5, "m/s", "5 m/s in still water"), given("v_r", 3, "m/s", "flowing at 3 m/s")])));
const OBLIQUE_PATH = "A boat moves at 5 m/s in still water across a river flowing at 3 m/s. It heads at 30 degrees upstream from the bank. How much longer is its path than the shortest path?";
check("river: an angle inside a stated upstream heading is not dropped for the shortest path heading", () =>
  declines(OBLIQUE_PATH, plan(OBLIQUE_PATH, [given("v_b", 5, "m/s", "5 m/s in still water"), given("v_r", 3, "m/s", "flowing at 3 m/s")])));
const NO_HEADING = "A boat moves at 5 m/s in still water. It crosses a 100 m wide river flowing at 3 m/s. How far downstream does it land?";
check("river: no stated heading and no request draws no upstream heading", () =>
  declines(NO_HEADING, plan(NO_HEADING, riverGivens)));

const SYMBOLIC_OBLIQUE = "A boat heads upstream at 30 degrees to the bank while crossing a river. Draw the velocity triangle.";
check("river: a stated heading with no speeds is not drawn at another angle", () => declines(SYMBOLIC_OBLIQUE, plan(SYMBOLIC_OBLIQUE)));
const FROM_FLOW = "A boat crosses a wide river. The boat speed in still water is 4 m/s and the river current is 2 m/s. The heading is 150 degrees to the direction of the river. Draw the crossing velocity triangle.";
check("river: a heading stated from the current is drawn at that angle, not upstream at α", () => {
  const family = drawnOnEveryPath(FROM_FLOW, plan(FROM_FLOW, [given("vb", 4, "m/s", "4 m/s"), given("vc", 2, "m/s", "2 m/s"), given("theta", 150, "degree", "150 degrees")]))
    .find((figure) => figure.path === "synthesizeFamilyScene");
  assert.ok(family && family.document.constructions.some((step) => step.inputs.headingDeg === 150), "the 150 degree heading was not drawn");
});

/* 2. Projectile: an angle measured from the vertical is never drawn from the horizontal. */

const symbolic = captured("derive_symbolic");
const symbolicPlan = (question: string) => plan(question);
for (const [name, from, to] of [
  ["theta to the vertical", "at angle theta on level ground", "at angle theta to the vertical on level ground"],
  ["alpha with the vertical", "at angle theta on level ground", "at angle alpha with the vertical on level ground"],
  ["theta with the normal", "at angle theta on level ground", "at angle theta with the normal on level ground"],
  ["theta below the horizontal", "at angle theta on level ground", "at angle theta below the horizontal on level ground"],
] as const) {
  const question = symbolic.question.replace(from, to);
  check(`projectile: "${name}" declines (the angle mark would be from the horizontal)`, () => declines(question, symbolicPlan(question)));
}
const VERTICAL = "A ball is projected at 20 m/s at 30 degrees with the vertical from level ground. Find the time of flight. Take g = 10 m/s^2.";
check("projectile: 30 degrees with the vertical declines or draws the true H = 15 m", () =>
  declinesOrTrue(VERTICAL, plan(VERTICAL, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees with the vertical"), given("g", 10, "m/s^2", "Take g = 10 m/s^2")], [derived("T", 3.464, "s")]),
    { H: 15, R: 34.64 }));

/* 3. Projectile: a stated g is read into H and R, or the figure declines. */

const G10 = "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. Find the time of flight. Take g = 10 m/s^2.";
const g10Plan = plan(G10, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees"), given("g", 10, "m/s^2", "Take g = 10 m/s^2")], [derived("T", 2, "s")]);
check("projectile: Take g = 10 gives H = 5 m and R = 34.64 m", () => declinesOrTrue(G10, g10Plan, { H: 5, R: 34.64 }));
check("projectile: Take g = 10 still draws (read, not only declined)", () => {
  const family = drawnOnEveryPath(G10, g10Plan).find((figure) => figure.path === "synthesizeFamilyScene");
  assert.ok(family && family.tier === "exact_verified", "the exact family figure declined");
});
const G16 = G10.replace("g = 10", "g = 1.6");
check("projectile: g = 1.6 gives H = 31.25 m and R = 216.5 m", () =>
  declinesOrTrue(G16, plan(G16, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees"), given("g", 1.6, "m/s^2", "g = 1.6 m/s^2")], [derived("T", 12.5, "s")]),
    { H: 31.25, R: 216.51 }));
const CGS = "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. Take g = 1000 cm/s^2. Find the range.";
check("projectile: a g in a unit the reader does not convert (1000 cm/s^2) is never used as m/s^2", () =>
  declinesOrTrue(CGS, plan(CGS, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees")]), { H: 5, R: 34.64 }));
const FEET = "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. Take g = 32 ft/s^2. Find the range.";
check("projectile: g = 32 ft/s^2 is never used as m/s^2", () =>
  declinesOrTrue(FEET, plan(FEET, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees")]), { H: 5.13, R: 35.51 }));
const MOON = "A ball is projected at 20 m/s at 30 degrees above the horizontal on the Moon. Find the range.";
check("projectile: an unread g (on the Moon) declines a figure with numbers", () =>
  declines(MOON, plan(MOON, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees")])));
const PLAN_G = "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. Find the range. Use gravity 10 metres per second per second.";
check("projectile: a plan g far from 9.8 with no g read declines or is true", () =>
  declinesOrTrue(PLAN_G, plan(PLAN_G, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees"), given("g", 10, "m/s^2", "gravity 10")]), { H: 5, R: 34.64 }));

/* 4. Projectile: a stated launch height is drawn, or the figure declines. */

const TOWER_H = symbolic.question.replace("at angle theta on level ground", "at angle theta from the top of a tower of height h");
check("projectile: a symbolic tower of height h is drawn as a tower, or declined", () => {
  for (const figure of drawnOnEveryPath(TOWER_H, symbolicPlan(TOWER_H))) {
    assert.ok(figure.document.entities.some((entity) => entity.id === "tower") && figure.labels.includes("h"),
      `${figure.path} drew a level ground launch ${JSON.stringify(figure.labels)}`);
    assert.ok(!figure.labels.some((label) => /^[HR]=/.test(label)), `${figure.path} put a number on a display height`);
  }
});
const TOWER_20 = "A ball is projected at 20 m/s at 30 degrees above the horizontal from the top of a 20 m tower. Find the range.";
check("projectile: a 20 m tower gives H = 25.1 m and R = 56.9 m", () =>
  declinesOrTrue(TOWER_20, plan(TOWER_20, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees"), given("h", 20, "m", "20 m tower")]), { H: 25.1, R: 56.88 }));
check("projectile: a 20 m tower is drawn (read, not only declined)", () => {
  const family = drawnOnEveryPath(TOWER_20, plan(TOWER_20, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees")])).find((figure) => figure.path === "synthesizeFamilyScene");
  assert.ok(family && family.labels.includes("20 m"), `the tower figure ${JSON.stringify(family?.labels)}`);
});
const CLIFF = "A stone is thrown horizontally at 10 m/s from the top of a cliff. Describe its path and find where it lands.";
check("projectile: a horizontal launch from an unread height declines a figure with numbers", () =>
  declines(CLIFF, plan(CLIFF, [given("u", 10, "m/s", "10 m/s")])));
const BALCONY = "A ball is thrown at 20 m/s at 30 degrees above the horizontal from a balcony. Find the range.";
check("projectile: a balcony with no height declines", () => declines(BALCONY, plan(BALCONY, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees")])));
const FOOT = "A ball is thrown horizontally at 10 m/s from the top of a 20 m tower and hits the ground some distance from the foot of the tower. Find the distance.";
check("projectile: \"from the foot of the tower\" is not a landing height; the 20 m tower draws R = 20.2 m", () => {
  declinesOrTrue(FOOT, plan(FOOT, [given("u", 10, "m/s", "10 m/s")]), { R: 20.2 });
  assert.ok(drawnOnEveryPath(FOOT, plan(FOOT, [given("u", 10, "m/s", "10 m/s")])).some((figure) => figure.labels.includes("20 m")), "the tower figure declined");
});
const ROOF = "A ball is projected at 20 m/s at 30 degrees above the horizontal from the ground and lands on the roof of a building 5 m high. Find the time of flight.";
check("projectile: landing on a raised roof declines (not a launch height, not level ground)", () =>
  declines(ROOF, plan(ROOF, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees")])));
const numeric = captured("projectile_numeric");
check("projectile: a derived H in the plan is never a launch height", () => {
  const turnPlan = plan(numeric.question, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees"), given("g", 10, "m/s^2", "Take g = 10 m/s^2")],
    [derived("T", 2, "s"), derived("H", 5, "m"), derived("R", 34.64, "m")]);
  for (const figure of drawnOnEveryPath(numeric.question, turnPlan)) {
    assert.ok(!figure.document.entities.some((entity) => entity.id === "tower"), `${figure.path} drew a tower ${JSON.stringify(figure.labels)}`);
  }
  declinesOrTrue(numeric.question, turnPlan, { H: 5, R: 34.64 });
});

/* 5. Projectile: a height is a launch height only when the launch starts on that body. */

const launchGivens = [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees")];
// A ground launch at 20 m/s and 30° with g = 9.8: H = 5.10 m, R = 35.35 m.
const GROUND = { H: 5.1, R: 35.35 };
for (const question of [
  "A ball is projected at 20 m/s at 30 degrees above the horizontal from the foot of a 20 m tower. Find the range.",
  "A ball is thrown from the ground at 20 m/s at 30 degrees above the horizontal to hit the top of a 20 m tower. Find the time.",
  "A ball is projected at 20 m/s at 30 degrees above the horizontal from a point 10 m from the base of a 20 m tower. Find the range.",
  "A boy standing on a 20 m tower watches a ball projected from the ground at 20 m/s at 30 degrees above the horizontal. Find the range.",
  "A ball is projected from the ground at 20 m/s at 30 degrees above the horizontal. A man standing on a 20 m tower watches it. Find the range.",
  "A ball is projected at 20 m/s at 30 degrees above the horizontal from the ground near a 20 m high cliff. Find the range.",
  "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. A bird sits on a 20 m tower nearby. Find the range.",
  "A ball is projected at 20 m/s at 30 degrees above the horizontal from the ground over a 20 m tall building. Find the range.",
  "A ball is projected at 20 m/s at 30° to the horizontal from ground level, 20 m above sea level. Find the range.",
  "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground towards a building 20 m high. Find the range.",
  "A ball is projected at 20 m/s at 30 degrees above the horizontal from a point on level ground 50 m from a 20 m high building. Find the range.",
  "A ball is projected at 20 m/s at 30 degrees above the horizontal towards the top of a 20 m tower. Find the range.",
  "A projectile is launched on level ground at 20 m/s at 30 degrees above the horizontal. An observer watches it from a 20 m tower. Find the range.",
  "A projectile is launched at 20 m/s at 30 degrees above the horizontal and an observer watches it from a 20 m tower. Find the range.",
]) {
  check(`projectile: a nearby height is not the launch height: "${question.slice(0, 90)}"`, () => {
    declinesOrTrue(question, plan(question, launchGivens), GROUND);
    for (const figure of drawnOnEveryPath(question, plan(question, launchGivens))) {
      assert.ok(!figure.document.entities.some((entity) => entity.id === "tower"), `${figure.path} drew a launch tower ${JSON.stringify(figure.labels)}`);
    }
  });
}
const PLATFORM = "A ball is projected at 20 m/s at 30° above horizontal from a tower of height 20 m. It lands 25 m from the tower foot on a 5 m high platform. Find the time.";
check("projectile: another stated height (a 5 m landing platform) declines the 20 m tower launch", () => declines(PLATFORM, plan(PLATFORM, launchGivens)));
const FRONTED = "From the top of a 20 m tower, a ball is projected at 20 m/s at 30 degrees above the horizontal. Find the range.";
check("projectile: a fronted \"From the top of a 20 m tower,\" still draws H = 25.1 m, R = 56.9 m", () => {
  declinesOrTrue(FRONTED, plan(FRONTED, launchGivens), { H: 25.1, R: 56.88 });
  assert.ok(drawnOnEveryPath(FRONTED, plan(FRONTED, launchGivens)).some((figure) => figure.path === "synthesizeFamilyScene" && figure.labels.includes("20 m")), "the tower figure declined");
});
const TOWER_45 = "A stone is thrown horizontally at 10 m/s from a 45 m high tower. Take g = 10 m/s^2. Find where it lands.";
check("projectile: a launch from a 45 m high tower still draws R = 30 m", () => {
  const turnPlan = plan(TOWER_45, [given("u", 10, "m/s", "10 m/s")]);
  declinesOrTrue(TOWER_45, turnPlan, { R: 30 });
  assert.ok(drawnOnEveryPath(TOWER_45, turnPlan).some((figure) => figure.path === "synthesizeFamilyScene" && figure.labels.includes("45 m")), "the tower figure declined");
});

/* 6. Projectile: a declined launch never falls through to a vertical drop or another sketch. */

const isDropSketch = (document: SceneDocument) => document.entities.some((entity) => entity.role === "drop" || entity.role === "release point");
function noFallThrough(question: string, turnPlan: TurnPlanV3, truth?: { H?: number; R: number }): void {
  for (const figure of drawnOnEveryPath(question, turnPlan)) {
    assert.ok(!isDropSketch(figure.document), `${figure.path} drew a vertical drop ${JSON.stringify(figure.labels)} for an angled launch`);
    assert.ok(figure.document.entities.some((entity) => entity.id === "tower"), `${figure.path} drew no launch tower ${JSON.stringify(figure.labels)}`);
  }
  if (truth) declinesOrTrue(question, turnPlan, truth);
  else {
    for (const figure of drawnOnEveryPath(question, turnPlan)) {
      assert.ok(!figure.labels.some((label) => /^[HR]=/.test(label)), `${figure.path} put a number on an unread height ${JSON.stringify(figure.labels)}`);
    }
  }
}
const TOWER_IS = "A ball is projected at 20 m/s at 30 degrees above the horizontal from the top of a tower. The tower is 20 m high. Find the range.";
check("projectile: \"the tower is 20 m high\" never draws a vertical drop", () => noFallThrough(TOWER_IS, plan(TOWER_IS, launchGivens), { H: 25.1, R: 56.88 }));
const TOWER_SYMBOL = "A ball is projected at 20 m/s at 30 degrees above the horizontal from the top of a tower of height h. Find the range.";
check("projectile: a tower of height h with numbers never draws a vertical drop", () => noFallThrough(TOWER_SYMBOL, plan(TOWER_SYMBOL, launchGivens)));
for (const question of [
  "A ball is projected at 20 m/s at 30 degrees below the horizontal from the top of a tower 40 m high. Find the range.",
  "A ball is projected at 20 m/s at 30 degrees to the vertical from the top of a building 20 m high. Find the range.",
  "A ball is thrown at 20 m/s at 30 degrees above the horizontal from the top of a building. Find the range.",
]) {
  check(`projectile: a declined launch declines everywhere: "${question.slice(0, 80)}"`, () => declines(question, plan(question, launchGivens)));
}

/* 7. Projectile: a g stated for another body, or a ratio of gravities, is not the local g. */

const gravityCases: Array<[string, { H: number; R: number } | null]> = [
  // g = 5: H = 100/10 = 10 m, R = 346.4/5 = 69.28 m.
  ["A ball is projected at 20 m/s at 30 degrees above the horizontal on a planet where the acceleration due to gravity is half of that on Earth. Take g = 10 m/s^2. Find the range.", { H: 10, R: 69.28 }],
  ["A ball is projected at 20 m/s at 30 degrees above the horizontal. Take g = 10 m/s^2 for Earth; the ball is thrown on Jupiter. Find the range.", null],
  // g = 9.8/6: H = 30.61 m, R = 212.1 m.
  ["On the Moon, a ball is projected at 20 m/s at 30 degrees above the horizontal. On Earth g = 9.8 m/s^2 and the Moon's gravity is one sixth of Earth's. Find the range.", { H: 30.61, R: 212.1 }],
  // g = 19.6: H = 2.55 m, R = 17.67 m.
  ["A ball is projected at 20 m/s at 30 degrees above the horizontal on a planet whose gravity is twice that of Earth (g = 9.8 m/s^2). Find the range.", { H: 2.55, R: 17.67 }],
  ["A ball is projected at 20 m/s at 30 degrees above the horizontal at a place where the acceleration due to gravity is twice its usual value g = 9.8 m/s^2. Find the range.", { H: 2.55, R: 17.67 }],
];
for (const [question, truth] of gravityCases) {
  check(`projectile: another body's g is not read as the local g: "${question.slice(0, 90)}"`, () =>
    truth ? declinesOrTrue(question, plan(question, launchGivens), truth) : declines(question, plan(question, launchGivens)));
}
// A g written as an expression is read whole or not at all: 2 × 9.8 is 19.6, never 2.
for (const question of [
  "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. Take g = 2 × 9.8. Find the range.",
  "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. Take g = 2 x 9.8. Find the range.",
  "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. Take g = 2*9.8. Find the range.",
]) {
  check(`projectile: a g expression is never cut to its first factor: "${question.slice(83, 110)}"`, () =>
    declinesOrTrue(question, plan(question, launchGivens), { H: 2.55, R: 17.67 }));
}
// g = 9.8/6 = 1.633: H = 30.61 m, R = 212.1 m.
const G_EARTH = "A ball is projected at 20 m/s at 30 degrees above the horizontal. Find the range. Take g = 10 m/s² (on Earth).";
check("projectile: a bracket after a whole g (\"(on Earth)\") still reads g = 10", () => {
  declinesOrTrue(G_EARTH, plan(G_EARTH, launchGivens), { H: 5, R: 34.64 });
  assert.ok(drawnOnEveryPath(G_EARTH, plan(G_EARTH, launchGivens)).some((figure) => figure.path === "synthesizeFamilyScene"), "declined");
});
const G_RATIO = "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. Take g = 9.8/6. Find the range.";
check("projectile: g = 9.8/6 is never read as 9.8", () => declinesOrTrue(G_RATIO, plan(G_RATIO, launchGivens), { H: 30.61, R: 212.1 }));
const MOON_G = "On the Moon, where the acceleration due to gravity is 1.6 m/s^2, a ball is projected at 20 m/s at 30 degrees above the horizontal. Find the range.";
check("projectile: \"On the Moon, where g is 1.6 m/s^2\" still draws H = 31.25 m, R = 216.5 m", () => {
  declinesOrTrue(MOON_G, plan(MOON_G, launchGivens), { H: 31.25, R: 216.51 });
  assert.ok(drawnOnEveryPath(MOON_G, plan(MOON_G, launchGivens)).some((figure) => figure.path === "synthesizeFamilyScene"), "the Moon figure declined");
});

/* 8. Projectile: a vertical axis, a vertical line, the y-axis or a slope is not the horizontal. */

// 30° to the vertical is 60° elevation: H = 15.31 m, R = 35.35 m.
for (const question of [
  "A ball is projected at 20 m/s at 30 degrees to the vertical axis. Find the range.",
  "A ball is projected at 20 m/s at 30° to the vertical line. Find the range.",
  "A ball is projected at 20 m/s at 30° to the y-axis. Find the range.",
]) {
  check(`projectile: "${question.slice(29, 60)}" is not drawn from the horizontal`, () => declinesOrTrue(question, plan(question, launchGivens), { H: 15.31, R: 35.35 }));
}
for (const question of [
  "A ball is projected at 20 m/s at 30° to the horizontal down a slope. Find the range.",
  "A ball is projected at 20 m/s at 30° to the horizontal on a hill. Find the range.",
]) {
  check(`projectile: a launch "${question.slice(56, 75)}" draws no level ground and no incline block`, () => declines(question, plan(question, launchGivens)));
}

/* Controls: an exact figure that states only what the figure reads is unchanged. */

const LEVEL = "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. Find the range.";
check("control: above the horizontal, no g, ground launch keeps exact H = 5.1 m, R = 35.3 m", () => {
  const family = drawnOnEveryPath(LEVEL, plan(LEVEL, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees")])).find((figure) => figure.path === "synthesizeFamilyScene");
  assert.ok(family, "declined");
  assert.equal(family.tier, "exact_verified");
  assert.deepEqual(family.labels.filter((label) => /^[uθHR]=/.test(label)), ["u=20 m/s", "θ=30°", "H=5.1 m", "R=35.3 m"]);
  assert.ok(!family.document.entities.some((entity) => entity.id === "tower"));
});
check("control: the captured symbolic derivation keeps its qualitative figure", () => {
  const drawn = drawnOnEveryPath(symbolic.question, symbolicPlan(symbolic.question));
  const family = drawn.find((figure) => figure.path === "synthesizeFamilyScene");
  assert.ok(family && family.tier === "qualitative_verified" && family.labels.includes("θ"), JSON.stringify(family?.labels));
  assert.ok(drawn.some((figure) => figure.path.startsWith("selectProductionScene")), "production declined the symbolic figure");
});
const VERTICAL_COMPONENT = "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. Find the vertical component of its velocity and the range.";
check("control: \"the vertical component\" is a quantity, not an angle reference", () => {
  const family = drawnOnEveryPath(VERTICAL_COMPONENT, plan(VERTICAL_COMPONENT, [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", "30 degrees")])).find((figure) => figure.path === "synthesizeFamilyScene");
  assert.ok(family && family.tier === "exact_verified", "declined");
});
const PATH = "A boat moves at 5 m/s in still water across a 100 m wide river flowing at 3 m/s. In which direction should it head to reach the point directly opposite?";
check("control: a shortest path request keeps the upstream heading at α = 36.9°", () => {
  const family = drawnOnEveryPath(PATH, plan(PATH, riverGivens)).find((figure) => figure.path === "synthesizeFamilyScene");
  assert.ok(family && assertionIds(family.document).has("straight_across") && family.labels.includes("α=36.9°"), JSON.stringify(family?.labels));
});
const QUICK = "A boat moves at 5 m/s in still water across a 100 m wide river flowing at 3 m/s. Find the shortest time to cross.";
check("control: a shortest time request keeps the perpendicular heading", () => {
  const family = drawnOnEveryPath(QUICK, plan(QUICK, riverGivens)).find((figure) => figure.path === "synthesizeFamilyScene");
  assert.ok(family && assertionIds(family.document).has("boat_perp"), JSON.stringify(family?.labels));
});

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${checks + failures.length} checks failed`);
  process.exit(1);
}
console.log(`\nverify-archetype-stated-conditions: ${checks} checks passed`);
