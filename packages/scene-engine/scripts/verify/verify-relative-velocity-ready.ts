/**
 * physics|2|relative-velocity readiness gate (constant velocity, one line).
 *
 * Expected values below are hand computed from each stem (x_A(t)=xA0+vA t,
 * x_B(t)=xB0+vB t, vAB=vA-vB, t=(xB0-xA0)/vAB), independently of the source
 * parser. The twelve "stated frame" stems and their values are the frozen
 * HEY-91 authored cohort (oracles.json, arithmetic checked by its own python
 * checker); the "textbook" stems are added here with values worked by hand.
 * Every scene goes through synthesizeFamilyScene, the call the tutor's
 * representation fallback makes.
 */
import assert from "node:assert/strict";
import {
  applySourceQuantityAuthority,
  attemptArchetypeScene,
  compileSceneDocument,
  LocalDeterministicSolverProvider,
  relativeMotionSource,
  synthesizeFamilyScene,
  validateRelativeMotionSourceInputs,
  type ExpressionNodeIR,
  type ProblemIR,
  type RenderScene,
  type SceneDocument,
} from "../../src/index";

let checks = 0;
const failures: string[] = [];
function check(condition: unknown, message: string): void {
  checks++;
  if (!condition) failures.push(message);
}

// ---------------------------------------------------------------------------
// 1. Generic solver: an identically zero residual is not an empty root set.
// ---------------------------------------------------------------------------
const n = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const t: ExpressionNodeIR = { kind: "variable", name: "t" };
const plus = (left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator: "+", left, right });
const minus = (left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator: "-", left, right });
const times = (left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator: "*", left, right });
const motion = (x0: number, v: number) => plus(n(x0), times(n(v), t));
async function roots(id: string, left: ExpressionNodeIR, right?: ExpressionNodeIR) {
  const question = `probe ${id}`;
  const problem: ProblemIR = {
    schemaVersion: "problem-ir/v1", id, question,
    facts: [{ id: "f", kind: "given", statement: question, evidence: { source: "question", start: 0, end: question.length, quote: question } }],
    entities: [], constraints: [], representationIntents: [],
    expressions: [
      { id: "left", valueType: "function", root: left, evidenceFactIds: ["f"] },
      ...(right ? [{ id: "right", valueType: "function" as const, root: right, evidenceFactIds: ["f"] }] : []),
    ],
    solveRequests: [right
      ? { id: "r", kind: "intersections", leftExpressionId: "left", rightExpressionId: "right", variable: "t", domain: { min: -10, max: 10 } }
      : { id: "r", kind: "roots", expressionId: "left", variable: "t", domain: { min: -10, max: 10 } }],
  };
  return new LocalDeterministicSolverProvider().solve(problem);
}
for (const [id, left, right] of [
  ["identical_affine_motion", motion(4, 3), motion(4, 3)],
  ["self_cancellation", minus(t, t), undefined],
  ["literal_zero", n(0), undefined],
  ["identical_constants", n(3), n(3)],
] as const) {
  const result = await roots(id, left, right);
  check(result.status === "failed" && !result.values.some((value) => value.requestId === "r")
    && result.issues.some((issue) => issue.requestId === "r" && issue.code === "unsupported_or_invalid_request"),
  `${id}: an all-times coincidence must not be certified as a finite root set`);
}
for (const [id, left, right, expected] of [
  ["nonzero_constant", n(3), undefined, []],
  ["parallel_motion", motion(0, 7), motion(50, 7), []],
  ["linear_root", minus(t, n(5)), undefined, [5]],
  ["overtaking", motion(0, 20), motion(100, 10), [10]],
] as const) {
  const result = await roots(id, left, right);
  check(result.status === "solved" && JSON.stringify(result.values[0]?.approximate) === JSON.stringify(expected), `${id}: expected roots ${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------------------
// 2. Admitted sources: independent expected values and the drawn scene.
// ---------------------------------------------------------------------------
type Outcome = "future" | "initial" | "past_root" | "never_parallel" | "coincident_all_times";
interface Case {
  id: string;
  question: string;
  vA: number; vB: number; vAB: number;
  outcome: Outcome;
  meet?: { t: string; x: string };
  observer?: { vO: number; vAO: number; vBO: number };
}
const STATED: Case[] = [
  { id: "overtaking-easy", question: "In the ground frame on one straight road, take east as positive. At t=0, point car A is at x=0 m and point car B at x=100 m. They move at constant velocities vA=20 m/s and vB=10 m/s. Find the signed velocity of A relative to B and the first encounter time for t>=0.", vA: 20, vB: 10, vAB: 10, outcome: "future", meet: { t: "t=10 s", x: "x=200 m" } },
  { id: "head-on-medium", question: "In the ground frame, east is positive on a straight line. At t=0, point body A is at 0 m and B is at 150 m. A moves east at 12 m/s and B west at 18 m/s, both constant. What are vAB and the first encounter for t>=0?", vA: 12, vB: -18, vAB: 30, outcome: "future", meet: { t: "t=5 s", x: "x=60 m" } },
  { id: "past-root-nonencounter", question: "In the ground frame with east positive, point A starts at 0 m and point B at 100 m at t=0. Their constant velocities are +10 m/s and +20 m/s. Find vAB, the algebraic meeting time, and whether they meet at any t>=0.", vA: 10, vB: 20, vAB: -10, outcome: "past_root" },
  { id: "zero-relative-separated", question: "In the ground frame with east positive, point A starts at 0 m and point B at 50 m. From t=0 onward both have constant velocity +7 m/s. Find vAB and the first future encounter time, if one exists.", vA: 7, vB: 7, vAB: 0, outcome: "never_parallel" },
  { id: "observer-change-composite", question: "In the ground frame, east is positive. At t=0 point A is at 0 m and B at 100 m; their constant ground velocities are +20 m/s and +10 m/s. Observer O starts at x=0 m and moves east at +15 m/s. Report vAO, vBO, vAB and the encounter time for t>=0 in O's frame, using east as positive.", vA: 20, vB: 10, vAB: 10, outcome: "future", meet: { t: "t=10 s", x: "x=200 m" }, observer: { vO: 15, vAO: 5, vBO: -5 } },
  { id: "west-positive-reversal", question: "Use the ground frame with west positive. Point A starts at x=0 m and B at x=-150 m at t=0. A moves east at 12 m/s and B moves west at 18 m/s, constantly. Give signed vAB and the first t>=0 encounter time and coordinate.", vA: -12, vB: 18, vAB: -30, outcome: "future", meet: { t: "t=5 s", x: "x=-60 m" } },
  { id: "stationary-target", question: "In the ground frame with east positive, point A begins at -30 m and moves at constant +6 m/s. Point B stays at 0 m with velocity 0 m/s. Find vAB and the first encounter at t>=0.", vA: 6, vB: 0, vAB: 6, outcome: "future", meet: { t: "t=5 s", x: "x=0 m" } },
  { id: "coincident-equal-speeds", question: "In the ground frame, east is positive. Two point bodies A and B are both at x=4 m at t=0 and both move at constant +3 m/s. Find vAB and describe their encounters for t>=0.", vA: 3, vB: 3, vAB: 0, outcome: "coincident_all_times" },
  { id: "initial-meeting-unequal-speeds", question: "In the ground frame with east positive, A and B both start at x=-2 m at t=0. They have constant velocities +5 m/s and -5 m/s respectively. Find vAB and the first encounter at t>=0.", vA: 5, vB: -5, vAB: 10, outcome: "initial", meet: { t: "t=0 s", x: "x=-2 m" } },
  { id: "source-units-hard", question: "In the ground frame on a straight road, east is positive. At t=0 point A is at 0 km and point B at 0.3 km. Their constant eastward velocities are 72 km/h and 36 km/h. Report vAB in m/s and the first encounter time in seconds.", vA: 20, vB: 10, vAB: 10, outcome: "future", meet: { t: "t=30 s", x: "x=600 m" } },
  { id: "boost-translation-holdout", question: "In the ground frame, east is positive. At t=0 point A is at 17 m and B at 117 m. Their constant velocities are +27 m/s and +17 m/s. Observer O starts at x=0 m and moves at +7 m/s. Give vAO, vBO, vAB and the first encounter time for t>=0.", vA: 27, vB: 17, vAB: 10, outcome: "future", meet: { t: "t=10 s", x: "x=287 m" }, observer: { vO: 7, vAO: 20, vBO: 10 } },
  { id: "body-swap-holdout", question: "In the ground frame with east positive, point A starts at 100 m and B at 0 m. Their constant velocities are +10 m/s and +20 m/s. Find signed vAB and the first encounter at t>=0.", vA: 10, vB: 20, vAB: -10, outcome: "future", meet: { t: "t=10 s", x: "x=200 m" } },
];
// Textbook wording: positive is the subject's direction of motion; A's start is x=0.
const TEXTBOOK: Case[] = [
  // Towards each other: vA=+20, vB=-30, vAB=50, t=500/50=10 s, x=20*10=200 m.
  { id: "textbook-head-on", question: "Two cars approach each other on a straight road with speeds 20 m/s and 30 m/s. They are 500 m apart. When do they meet?", vA: 20, vB: -30, vAB: 50, outcome: "future", meet: { t: "t=10 s", x: "x=200 m" } },
  // 72 km/h=20 m/s, 54 km/h=15 m/s, vAB=5, t=100/5=20 s, x=20*20=400 m.
  { id: "textbook-trains-km-h", question: "Two trains A and B are moving in the same direction on parallel tracks with speeds 72 km/h and 54 km/h. Train A is 100 m behind B. How long does A take to catch up with B?", vA: 20, vB: 15, vAB: 5, outcome: "future", meet: { t: "t=20 s", x: "x=400 m" } },
  // Slower car behind: vAB=10-15=-5, algebraic t=50/(-5)=-10 s, never catches up.
  { id: "textbook-slower-pursuer", question: "Two cars A and B move in the same direction with speeds 10 m/s and 15 m/s. Car A is 50 m behind car B. Find the relative velocity of A with respect to B and when A catches up with B.", vA: 10, vB: 15, vAB: -5, outcome: "past_root" },
  // vAB=25-15=10, t=200/10=20 s, x=25*20=500 m.
  // Reviewer #7 R5: 36 kmph=10 m/s, 54 kmph=15 m/s, towards: vAB=25, t=1000/25=40 s, x=10*40=400 m.
  { id: "rev7-R5-kmph-towards", question: "Two cars A and B move towards each other at 36 kmph and 54 kmph. They are 1 km apart. When do they meet?", vA: 10, vB: -15, vAB: 25, outcome: "future", meet: { t: "t=40 s", x: "x=400 m" } },
  // km/hr: 36 km/hr=10, 54 km/hr=15 m/s, 2 km apart: t=2000/25=80 s, x=800 m.
  { id: "rev7-km-hr-towards", question: "Two cars A and B move towards each other at 36 km/hr and 54 km/hr. They are 2 km apart. When do they meet?", vA: 10, vB: -15, vAB: 25, outcome: "future", meet: { t: "t=80 s", x: "x=800 m" } },
  { id: "textbook-overtake", question: "Car A moves at 25 m/s and car B at 15 m/s in the same direction on a straight road. Car A is 200 m behind car B. After how long does A overtake B?", vA: 25, vB: 15, vAB: 10, outcome: "future", meet: { t: "t=20 s", x: "x=500 m" } },
];

const labelTexts = (scene: RenderScene) => scene.primitives.filter((p) => p.kind === "label").map((p) => String((p as { text?: string }).text));
const primitive = (scene: RenderScene, entityId: string, kind?: string) => scene.primitives.find((p) => p.entityId === entityId && (!kind || p.kind === kind));
const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

const admittedDocuments = new Map<string, SceneDocument>();
for (const testCase of [...STATED, ...TEXTBOOK]) {
  const admission = relativeMotionSource(testCase.question);
  check(admission?.status === "admitted", `${testCase.id}: source must be admitted, got ${admission ? admission.status === "rejected" ? admission.reason : admission.status : "null"}`);
  const scene = synthesizeFamilyScene({ question: testCase.question });
  if (!scene) { failures.push(`${testCase.id}: no scene on the normal synthesis path`); continue; }
  admittedDocuments.set(testCase.id, scene.document);
  check(scene.document.source.sourceModel === "relative_motion_1d", `${testCase.id}: scene must come from the admitted source`);
  const speedsNonzero = testCase.vA !== 0 && testCase.vB !== 0 || testCase.vAB !== 0 && testCase.vA !== 0;
  check(scene.tier === (speedsNonzero ? "exact_verified" : "qualitative_verified"), `${testCase.id}: tier ${scene.tier}`);
  const labels = labelTexts(scene.renderScene);
  check(labels.includes(`vA=${signed(testCase.vA)} m/s`) || labels.includes(`vA=${testCase.vA} m/s`), `${testCase.id}: vA label, got ${labels.join(" | ")}`);
  check(labels.includes(`vB=${signed(testCase.vB)} m/s`) || labels.includes(`vB=${testCase.vB} m/s`), `${testCase.id}: vB label, got ${labels.join(" | ")}`);
  check(labels.includes(`vAB=${signed(testCase.vAB)} m/s`) || labels.includes(`vAB=${testCase.vAB} m/s`), `${testCase.id}: vAB label, got ${labels.join(" | ")}`);
  // Arrow sense on the page follows the signed velocity (x grows to the right).
  for (const [entity, value] of [["a_velocity", testCase.vA], ["b_velocity", testCase.vB], ["rel_velocity", testCase.vAB]] as const) {
    const mark = primitive(scene.renderScene, entity);
    if (value === 0) {
      // A zero velocity is a labelled marker at the body, never an arrow.
      check(!scene.renderScene.primitives.some((p) => p.entityId === entity && p.kind === "vector")
        && scene.renderScene.primitives.some((p) => p.entityId === entity && p.kind === "label" && /=0 m\/s$/.test(String((p as { text?: string }).text))),
      `${testCase.id}: zero ${entity} must be a labelled zero marker, not an arrow`);
    } else {
      const [tail, tip] = mark?.points ?? [];
      check(mark?.kind === "vector" && tail && tip && Math.sign(tip.x - tail.x) === Math.sign(value) && Math.abs(tip.y - tail.y) < 1e-6,
        `${testCase.id}: ${entity} must point ${value > 0 ? "right" : "left"} along the line`);
    }
  }
  if (testCase.meet) {
    check(labels.includes(testCase.meet.t), `${testCase.id}: encounter time label ${testCase.meet.t}, got ${labels.join(" | ")}`);
    check(labels.includes(testCase.meet.x), `${testCase.id}: encounter position label ${testCase.meet.x}, got ${labels.join(" | ")}`);
    const line = primitive(scene.renderScene, "meet_line");
    const [top, bottom] = line?.points ?? [];
    check(top && bottom && Math.abs(top.x - bottom.x) < 1e-6 && Math.abs(top.y - bottom.y) > 1, `${testCase.id}: the encounter joins both lanes at the same x`);
  } else {
    check(!labels.some((text) => /^t[=≈]/.test(text)), `${testCase.id}: no finite meeting time may be drawn`);
    check(!primitive(scene.renderScene, "a_meet"), `${testCase.id}: no encounter marker`);
    const note = { past_root: "no meeting ahead", never_parallel: "gap never closes", coincident_all_times: "always together" }[testCase.outcome as "past_root"];
    check(labels.includes(note), `${testCase.id}: outcome note "${note}"`);
  }
  if (testCase.observer) {
    check(labels.includes(`vO=${signed(testCase.observer.vO)} m/s`), `${testCase.id}: observer velocity label`);
    const quantity = (symbol: string) => scene.document.quantities.find((q) => q.symbol === symbol)?.value;
    check(quantity("vAO") === testCase.observer.vAO && quantity("vBO") === testCase.observer.vBO, `${testCase.id}: observer-frame velocities vAO/vBO`);
  }
  check(scene.document.revealGroups.map((group) => group.id).join(",").startsWith("setup,velocities"), `${testCase.id}: reveal order starts with setup then velocities`);
}

// ---------------------------------------------------------------------------
// 3. Rejections: no invented model, and never the stock two-car sketch.
// ---------------------------------------------------------------------------
const REJECTED = [
  ["missing-directions", "A and B have speeds 20 m/s and 10 m/s on a straight road. What is their signed relative velocity?"],
  ["dimensionally-invalid", "In the ground frame, east is positive. A starts at 0 m and B at 10 m. A's constant velocity is +20 kg and B's +10 m/s. Find vAB."],
  ["acceleration", "In the ground frame with east positive, A starts at 0 m with +20 m/s and acceleration -2 m/s^2. B starts at 100 m with constant +10 m/s. Find all encounter times for t>=0."],
  ["finite-train-length", "In the ground frame with east positive, a 200 m train moves east at 20 m/s and a 100 m train west at 10 m/s. Their front ends meet at t=0. When do they finish passing?"],
  ["same-direction-unknown-order", "Two cars move in the same direction with speeds 20 m/s and 10 m/s. They are 100 m apart. When do they meet?"],
  ["finite-length-passing", "Two trains A and B, each 100 m long, move in the same direction with speeds 20 m/s and 10 m/s. How long does A take to pass B?"],
  ["no-frame-signed", "Two cars A and B have velocities +20 m/s and -10 m/s. Car A is 100 m behind car B. Find the relative velocity of A with respect to B."],
] as const;
for (const [id, question] of REJECTED) {
  const admission = relativeMotionSource(question);
  check(admission?.status === "rejected", `${id}: must be rejected, got ${JSON.stringify(admission?.status ?? null)}`);
  const scene = synthesizeFamilyScene({ question });
  check(scene?.document.source.sourceModel !== "relative_motion_1d", `${id}: a rejected source must not produce the exact relative-motion figure`);
  if (id === "missing-directions" || id === "no-frame-signed") {
    // No stated direction of motion: no two-body sketch may assume one.
    check(!scene || (scene.document.source.archetype !== "relative_motion_line" && !/two cars on a line/.test(scene.document.visualDecision.reason)),
      `${id}: drew a relative-motion sketch without a stated direction (${scene?.reason})`);
  }
}
check(relativeMotionSource("Find the area of a circle of radius 3 cm.") === null, "unrelated stems are not engaged");
// Reviewer #7: premises in the question sentence, and wording a two-body
// sketch would drop, decline outright (no exact figure, no legacy sketch).
for (const [id, question] of [
  ["rev7-R2-instead", "Two trains A and B move in the same direction with speeds 72 km/h and 54 km/h respectively. Train A is 100 m behind B. Find how long A takes to catch up with B if B moves at 36 km/h instead."],
  ["rev7-R2b-if-starts", "Two trains A and B move in the same direction with speeds 72 km/h and 54 km/h respectively. Train A is 100 m behind B. How long does A take to catch up with B if A starts 200 m behind B?"],
  ["rev7-R4-opposite", "Two cars A and B move in opposite directions with speeds 10 m/s and 15 m/s. They are 100 m apart. Find their relative velocity."],
  ["rev7-R8-delay", "Two cars A and B move in the same direction with speeds 20 m/s and 10 m/s. Car A is 100 m behind car B, and B starts 2 s later. When does A catch up with B?"],
  ["rev7-R10-three-cars", "Three cars A, B and C move in the same direction with speeds 20 m/s, 15 m/s and 10 m/s. Car A is 100 m behind car B. Find the velocity of A relative to B."],
  ["mph-unit", "Two cars A and B move in the same direction with speeds 30 mph and 20 mph. Car A is 100 m behind car B. When does A catch up with B?"],
] as const) {
  const admission = relativeMotionSource(question);
  check(admission?.status === "rejected" && admission.kind === "out_of_model", `${id}: must be rejected as out of model, got ${admission?.status === "rejected" ? `${admission.kind}: ${admission.reason}` : admission?.status ?? "null"}`);
  const scene = synthesizeFamilyScene({ question });
  check(!scene || (scene.document.source.archetype !== "relative_motion_line" && scene.document.source.sourceModel !== "relative_motion_1d" && !/two cars on a line/.test(scene.document.visualDecision.reason)),
    `${id}: no relative-motion figure or sketch may be drawn (${scene?.reason})`);
}
// Reviewer #7 R1: "B take to catch up with A" makes B the subject: vBA=+10, t=10 s, x=200 m.
{
  const scene = synthesizeFamilyScene({ question: "Two cars A and B move in the same direction with speeds 10 m/s and 20 m/s. Car A is 100 m ahead of car B. How long does B take to catch up with A?" });
  const labels = scene ? labelTexts(scene.renderScene) : [];
  check(labels.includes("vBA=+10 m/s") && labels.includes("t=10 s") && labels.includes("x=200 m") && labels.includes("B seen from A"), `rev7-R1: subject follows "B take to catch up with A" (${labels.join(" | ")})`);
}
// Unread but in-model wording keeps the qualitative sketch with the stem's own m/s values.
{
  const scene = synthesizeFamilyScene({ question: "Car A travels east at 20 m/s and car B travels east at 5.0 m/s on the same straight road. Find the velocity of A relative to B and of B relative to A." });
  check(scene?.tier === "qualitative_verified" && labelTexts(scene.renderScene).includes("vA=20 m/s"), "unread same-direction wording keeps the qualitative sketch with stem values");
}


// The stock archetype reads direction instead of assuming it.
const headOn = attemptArchetypeScene({ question: "Two trains approach each other on parallel tracks. Train A moves at 20 m/s and train B at 30 m/s. Find their relative velocity." });
check(headOn.match?.slots.sameDirection !== "yes", "archetype must not read 'approach each other' as same direction");
const unstated = attemptArchetypeScene({ question: "Two cars A and B move along a straight road at 20 m/s and 10 m/s. Find the velocity of A relative to B." });
check(!unstated.scene, "archetype must decline when the direction of motion is not stated");

// ---------------------------------------------------------------------------
// 3b. River crossing (relative velocity in a plane, river_boat archetype).
// Shortest path with vb=5, vc=3: heading upstream at asin(3/5)=36.87° from
// the bank normal, resultant straight across. Shortest time: heading along
// the normal, resultant drifts with dx/dy = vc/vb = 0.6. A boat slower than
// the current cannot cross straight: no figure.
// ---------------------------------------------------------------------------
const vectorOf = (scene: RenderScene, id: string) => {
  const mark = scene.primitives.find((p) => p.entityId === id && p.kind === "vector");
  const [tail, tip] = mark?.points ?? [];
  return tail && tip ? { dx: tip.x - tail.x, dy: tail.y - tip.y } : null; // page y grows downward
};
const shortestPath = synthesizeFamilyScene({ question: "A boat can row at 5 km/h in still water. A river 1 km wide flows at 3 km/h. Find the time to cross by the shortest path." });
{
  const labels = shortestPath ? labelTexts(shortestPath.renderScene) : [];
  check(shortestPath?.tier === "exact_verified" && labels.includes("vb=5 km/h") && labels.includes("vc=3 km/h"), `river shortest path: speeds keep the stem unit (${labels.join(" | ")})`);
  check(labels.includes("α=36.9°"), "river shortest path: heading angle asin(3/5)");
  const boat = shortestPath && vectorOf(shortestPath.renderScene, "boat"); const current = shortestPath && vectorOf(shortestPath.renderScene, "current"); const resultant = shortestPath && vectorOf(shortestPath.renderScene, "resultant");
  check(boat && current && resultant && current.dx > 0 && boat.dx < 0 && Math.abs(resultant.dx) < 1e-6 * Math.abs(resultant.dy)
    && Math.abs(Math.atan2(-boat.dx, boat.dy) * 180 / Math.PI - 36.8699) < 0.01, "river shortest path: heads upstream, resultant straight across");
}
const shortestTime = synthesizeFamilyScene({ question: "A boat can row at 5 km/h in still water across a river flowing at 3 km/h. Find the minimum time to cross a 1 km wide river and the drift." });
{
  const boat = shortestTime && vectorOf(shortestTime.renderScene, "boat"); const resultant = shortestTime && vectorOf(shortestTime.renderScene, "resultant");
  check(boat && resultant && Math.abs(boat.dx) < 1e-6 * Math.abs(boat.dy) && Math.abs(resultant.dx / resultant.dy - 0.6) < 1e-3 /* page coordinates are rounded to 0.01 px */, "river shortest time: heads along the normal and drifts with dx/dy = 0.6");
  check(shortestTime && !labelTexts(shortestTime.renderScene).some((text) => text.startsWith("α=")), "river shortest time: no upstream heading angle");
}
const slowBoat = synthesizeFamilyScene({ question: "A boat can row at 3 km/h in still water. A river 1 km wide flows at 5 km/h. In which direction should the boat head to cross along the shortest path straight across?" });
check(!slowBoat, `river slower boat: straight across is impossible, so no figure (${slowBoat?.reason})`);

// ---------------------------------------------------------------------------
// 3c. River speeds bind by role words, never by mention order.
// ---------------------------------------------------------------------------
const riverFirst = synthesizeFamilyScene({ question: "A river 1 km wide flows at 3 km/h. A boat that can row at 5 km/h in still water crosses it by the shortest path. Find the time taken." });
check(riverFirst && labelTexts(riverFirst.renderScene).includes("vb=5 km/h") && labelTexts(riverFirst.renderScene).includes("vc=3 km/h")
  && labelTexts(riverFirst.renderScene).includes("α=36.9°"), `river named first: boat 5, current 3 (${riverFirst ? labelTexts(riverFirst.renderScene).join(" | ") : "null"})`);
const swimmer = synthesizeFamilyScene({ question: "The current in a 1 km wide river is 3 km/h and a boat rows at 5 km/h relative to the water. Find the minimum time to cross." });
{
  const boat = swimmer && vectorOf(swimmer.renderScene, "boat"); const resultant = swimmer && vectorOf(swimmer.renderScene, "resultant");
  check(swimmer && labelTexts(swimmer.renderScene).includes("vb=5 km/h") && boat && resultant && Math.abs(boat.dx) < 1e-6 * Math.abs(boat.dy)
    && Math.abs(resultant.dx / resultant.dy - 0.6) < 1e-3, "current named first, minimum time: boat 5 along the normal");
}
const ambiguousRiver = synthesizeFamilyScene({ question: "A boat and a river current have speeds 5 km/h and 3 km/h. Find the time to cross a 1 km wide river by the shortest path." });
check(!ambiguousRiver, `river roles not named per speed: no figure (${ambiguousRiver?.reason})`);
const respectively = synthesizeFamilyScene({ question: "The speeds of the river and the boat in still water are 3 km/h and 5 km/h respectively. Find the shortest time to cross a 1 km wide river." });
check(!respectively, `river roles given only by "respectively": no figure (${respectively?.reason})`);

// ---------------------------------------------------------------------------
// 3d. Numeric authority: plan numbers narration will speak must match the
// source values, or the figure is withheld (the tutor then teaches text only).
// ---------------------------------------------------------------------------
const plan = (givens: Array<[string, number, string]>, derived: Array<[string, number, string]> = []) => ({
  schemaVersion: "turn-plan/v3", question: "", unknowns: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  givens: givens.map(([symbol, value, unit], index) => ({ id: `g${index}`, symbol, value, unit, provenance: "question" })),
  derived: derived.map(([symbol, value, unit], index) => ({ id: `d${index}`, symbol, value, unit, provenance: "derived" })),
});
const trains = TEXTBOOK.find((c) => c.id === "textbook-trains-km-h")!.question;
const trainsGivens: Array<[string, number, string]> = [["v_A", 72, "km/h"], ["v_B", 54, "km/h"], ["d", 100, "m"]];
for (const [id, derived, drawn] of [
  ["agreeing plan", [["v_AB", 5, "m/s"], ["t", 20, "s"], ["x_meet", 400, "m"], ["s_B", 300, "m"]], true],
  ["agreeing plan in km/h and minutes", [["v_rel", 18, "km/h"], ["t", 1 / 3, "min"]], true],
  ["stale meeting time t=25 s (source 20 s)", [["v_AB", 5, "m/s"], ["t", 25, "s"]], false],
  ["stale relative velocity 35 m/s (speeds added)", [["v_AB", 35, "m/s"], ["t", 20, "s"]], false],
  ["stale meeting position 500 m (source 400 m)", [["t", 20, "s"], ["x_meet", 500, "m"]], false],
] as const) {
  const scene = synthesizeFamilyScene({ question: trains, turnPlan: plan(trainsGivens, derived as Array<[string, number, string]>) });
  check(drawn ? scene?.document.source.sourceModel === "relative_motion_1d" : !scene, `relative plan authority, ${id}: ${drawn ? "figure expected" : "figure must be withheld"} (${scene?.reason ?? "null"})`);
}
// 500/15 s = 33.33 s; a plan rounded to 33.3 s agrees.
const rounded = synthesizeFamilyScene({ question: "Car A moves at 25 m/s and car B at 10 m/s in the same direction on a straight road. Car A is 500 m behind car B. After how long does A overtake B?", turnPlan: plan([["v_A", 25, "m/s"], ["v_B", 10, "m/s"], ["d", 500, "m"]], [["t", 33.3, "s"]]) });
check(rounded?.document.source.sourceModel === "relative_motion_1d", "relative plan authority: a three-figure rounded time agrees");
const stalePastRoot = synthesizeFamilyScene({ question: TEXTBOOK.find((c) => c.id === "textbook-slower-pursuer")!.question, turnPlan: plan([], [["t", 10, "s"]]) });
check(!stalePastRoot, "relative plan authority: a positive catch-up time for a pursuer that never catches up is withheld");
const riverPath = "A boat can row at 5 km/h in still water. A river 1 km wide flows at 3 km/h. Find the time to cross by the shortest path.";
for (const [id, givens, derived, drawn] of [
  ["agreeing plan (t=0.25 h, heading 36.87 deg)", [["v_b", 5, "km/h"], ["v_c", 3, "km/h"], ["d", 1, "km"]], [["t", 0.25, "h"], ["theta", 36.87, "degree"], ["v", 4, "km/h"]], true],
  ["stale crossing time 0.2 h (source 0.25 h)", [["v_b", 5, "km/h"], ["v_c", 3, "km/h"], ["d", 1, "km"]], [["t", 0.2, "h"]], false],
  ["stale heading 30 deg", [["v_b", 5, "km/h"], ["v_c", 3, "km/h"]], [["theta", 30, "degree"]], false],
  ["plan swaps boat and current", [["v_b", 3, "km/h"], ["v_c", 5, "km/h"], ["d", 1, "km"]], [], false],
] as const) {
  const scene = synthesizeFamilyScene({ question: riverPath, turnPlan: plan(givens as unknown as Array<[string, number, string]>, derived as unknown as Array<[string, number, string]>) });
  check(drawn ? scene?.document.source.archetype === "river_boat" : !scene, `river plan authority, ${id}: ${drawn ? "figure expected" : "figure must be withheld"} (${scene?.reason ?? "null"})`);
}

// Shared source-quantity seam (applySourceQuantityAuthority, the one live
// call): a value whose symbol binds to one source quantity is corrected in
// the plan's unit; an unbound value that equals no source value is
// withdrawn so narration never states it; other topics are untouched.
{
  type Plan = Parameters<typeof applySourceQuantityAuthority>[0];
  const run = (question: string, value: ReturnType<typeof plan>) => applySourceQuantityAuthority(value as unknown as Plan, null, question);
  const outcomeOf = (result: ReturnType<typeof run>, topic: string) => result.outcomes.find((outcome) => outcome.topic === topic);
  const stale = plan(trainsGivens, [["v_AB", 35, "m/s"], ["t", 25, "s"], ["x_meet", 500, "m"]]);
  const result = run(trains, stale);
  const outcome = outcomeOf(result, "physics|2|relative-velocity");
  const fixed = Object.fromEntries((outcome?.corrections ?? []).map((c) => [c.symbol, c.corrected]));
  check(outcome && !outcome.declineFigure && fixed.v_AB === 5 && fixed.t === 20 && fixed.x_meet === 400, `seam corrects bound vAB/t/x_meet: ${JSON.stringify(outcome?.corrections)}`);
  check(result.plan.derived.find((q) => q.symbol === "t")?.value === 20 && /Source-verified/.test(String(result.plan.derived.find((q) => q.symbol === "t")?.sourceText)), "corrected plan carries the source value and marks sourceText");
  check(synthesizeFamilyScene({ question: trains, turnPlan: result.plan })?.document.source.sourceModel === "relative_motion_1d", "the corrected plan draws the figure");
  check(stale.derived[1]!.value === 25, "the seam does not mutate the input plan");
  const unboundTime = run(trains, plan(trainsGivens, [["T_1", 640, "s"]]));
  const unboundOutcome = outcomeOf(unboundTime, "physics|2|relative-velocity");
  check(unboundOutcome?.issueCodes.includes("relative_motion_value_withdrawn") && !unboundTime.plan.derived.some((q) => q.symbol === "T_1"), "an unbound time that equals no source value is withdrawn from the plan");
  const intermediate = run(trains, plan(trainsGivens, [["s_5", 75, "m"]]));
  check(intermediate.plan.derived.some((q) => q.symbol === "s_5" && q.value === 75), "an unbound intermediate distance is left unjudged");
  check(synthesizeFamilyScene({ question: trains, turnPlan: intermediate.plan })?.document.source.sourceModel === "relative_motion_1d", "an unjudged intermediate distance does not withhold the figure");
  const kmh = outcomeOf(run(trains, plan(trainsGivens, [["v_AB", 36, "km/h"]])), "physics|2|relative-velocity");
  check(kmh?.corrections[0]?.corrected === 18 && kmh.corrections[0]?.unit === "km/h", "a correction keeps the plan's unit (5 m/s = 18 km/h)");
  const pastRoot = run(TEXTBOOK.find((c) => c.id === "textbook-slower-pursuer")!.question, plan([], [["t", 10, "s"]]));
  check(!pastRoot.plan.derived.some((q) => q.symbol === "t"), "a catch-up time that does not exist is withdrawn, not corrected");
  check(run("Find the area of a circle of radius 3 cm.", plan([], [["t", 9, "s"]])).outcomes.every((o) => !/relative-velocity/.test(o.topic)), "no relative-motion outcome for another topic");
  const agreeing = outcomeOf(run(trains, plan(trainsGivens, [["v_AB", 5, "m/s"], ["t", 20, "s"]])), "physics|2|relative-velocity");
  check(agreeing && agreeing.corrections.length === 0 && agreeing.issueCodes.length === 0, "agreeing plan: no corrections, nothing withdrawn");
  const swapped = run(riverPath, plan([["v_b", 3, "km/h"], ["v_c", 5, "km/h"]], [["t", 0.2, "h"]]));
  const river = Object.fromEntries((outcomeOf(swapped, "physics|2|relative-velocity-in-a-plane")?.corrections ?? []).map((c) => [c.symbol, c.corrected]));
  check(river.v_b === 5 && river.v_c === 3 && river.t === 0.25, `river seam corrects swapped speeds and the shortest-path time: ${JSON.stringify(river)}`);
  check(synthesizeFamilyScene({ question: riverPath, turnPlan: swapped.plan })?.document.source.archetype === "river_boat", "corrected river plan draws the crossing");
  const angle = run(riverPath, plan([], [["theta", 30, "degree"]]));
  check(!angle.plan.derived.some((q) => q.symbol === "theta") && (outcomeOf(angle, "physics|2|relative-velocity-in-a-plane")?.corrections.length ?? 0) === 0, "a conflicting heading angle is withdrawn, never rewritten");
}

// ---------------------------------------------------------------------------
// 4. Forged or stale documents fail before ink.
// ---------------------------------------------------------------------------
const base = admittedDocuments.get("head-on-medium")!;
const mutate = (edit: (document: SceneDocument) => void) => { const copy = structuredClone(base); edit(copy); return copy; };
check(compileSceneDocument(base).ok, "untouched admitted document compiles");
for (const [id, document] of [
  ["stale relative velocity", mutate((d) => { d.quantities.find((q) => q.symbol === "vAB")!.value = 6; })],
  ["sign-flipped body velocity", mutate((d) => { d.quantities.find((q) => q.symbol === "vB")!.value = 18; })],
  ["moved start", mutate((d) => { d.quantities.find((q) => q.symbol === "x0B")!.value = 120; })],
  ["dropped encounter time", mutate((d) => { d.constructions = d.constructions.filter((c) => !c.outputs.includes("meet_time")); d.entities = d.entities.filter((e) => e.id !== "meet_time"); d.requiredEntityIds = d.requiredEntityIds.filter((id) => id !== "meet_time"); d.revealGroups.forEach((g) => { g.entityIds = g.entityIds.filter((id) => id !== "meet_time"); }); })],
  ["foreign question", mutate((d) => { d.source.question = "In the ground frame, east is positive. A starts at 0 m and B at 10 m. Find vAB."; })],
] as const) {
  const compiled = compileSceneDocument(document);
  check(!compiled.ok && compiled.report.issues.some((issue) => issue.code.startsWith("relative_motion_source")), `${id}: forged document must fail the source check`);
}
// Restore uses the stored turn's actual question, not the document's copy.
const otherTurn = STATED.find((c) => c.id === "overtaking-easy")!.question;
check(validateRelativeMotionSourceInputs(base, otherTurn).some((issue) => issue.severity === "fatal"), "a document restored under a different turn question is rejected");
check(validateRelativeMotionSourceInputs(base, base.source.question).length === 0, "a document restored under its own question passes");

console.log(JSON.stringify({ gate: "relative-velocity-ready", checks, failures: failures.length, admitted: STATED.length + TEXTBOOK.length, rejected: REJECTED.length }));
if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
