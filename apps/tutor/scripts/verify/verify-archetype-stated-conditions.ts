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
