/** Independent source equations for the bounded w1 relative-authority repair. */
import assert from "node:assert/strict";
import {
  applySourceQuantityAuthority,
  compileSceneDocument,
  riverCrossingSpeeds,
  synthesizeFamilyScene,
  validateProblemIR,
  type ProblemIR,
  type TurnPlanQuantityV3,
  type TurnPlanV3,
} from "../../src/index";

let checks = 0;
const failures: string[] = [];
// Optional name filter is for isolated mutation proofs; the default runs all.
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
function check(name: string, run: () => void): void {
  if (filter && !filter.test(name)) return;
  checks++;
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const quantity = (id: string, symbol: string, value: number, unit: string, provenance: "given" | "derived" = "derived"): TurnPlanQuantityV3 => ({ id, symbol, value, unit, provenance });
function plan(question: string, givens: TurnPlanQuantityV3[] = [], derived: TurnPlanQuantityV3[] = []): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, givens, derived,
    unknowns: derived.map(({ id, symbol, unit }) => ({ id, symbol, unit })),
    assumptions: [], qualitativeClaims: [], lawIds: [], visualRequirement: "required",
  };
}
function problem(question: string): ProblemIR {
  const requestStart = question.search(/\b(?:Find|Report|Give|What)\b/);
  const end = requestStart < 0 ? question.length : requestStart;
  const facts: ProblemIR["facts"] = [{ id: "setup", kind: "given", statement: question.slice(0, end), evidence: { source: "question", start: 0, end, quote: question.slice(0, end) } }];
  if (end < question.length) facts.push({ id: "request", kind: "requested", statement: question.slice(end), evidence: { source: "question", start: end, end: question.length, quote: question.slice(end) } });
  const isRiver = /\briver\b/i.test(question);
  // Labels name visible source bodies, rather than inventing proper names
  // from their descriptive roles. The river is context for the boat intent;
  // sceneDemand independently requires its banks on the normal family path.
  const entities: ProblemIR["entities"] = isRiver
    ? [{ id: "boat", kind: "body", label: "boat", evidenceFactIds: ["setup"] }, { id: "river", kind: "region", evidenceFactIds: ["setup"] }]
    : [{ id: "A", kind: "body", label: "A", evidenceFactIds: ["setup"] }, { id: "B", kind: "body", label: "B", evidenceFactIds: ["setup"] }, ...(/\bObserver O\b/.test(question) ? [{ id: "O", kind: "body" as const, label: "O", evidenceFactIds: ["setup"] }] : [])];
  const ir: ProblemIR = {
    schemaVersion: "problem-ir/v1", id: "w1RelativeAuthority", question, facts, entities,
    expressions: [], constraints: [], solveRequests: [],
    representationIntents: [{ id: "motion", kind: "conceptual", entityIds: isRiver ? ["boat"] : entities.map(({ id }) => id), evidenceFactIds: ["setup"] }],
  };
  const validated = validateProblemIR(ir, question);
  assert.ok(validated.valid, JSON.stringify(validated.issues));
  return ir;
}
const value = (p: TurnPlanV3, id: string) => [...p.givens, ...p.derived].find((q) => q.id === id)?.value;
const corrected = (p: TurnPlanV3) => applySourceQuantityAuthority(p, problem(p.question), p.question);
const close = (actual: number | undefined, expected: number) => assert.ok(actual !== undefined && Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
function draw(p: TurnPlanV3, model: string): void {
  const scene = synthesizeFamilyScene({ question: p.question, turnPlan: p, problemIR: problem(p.question) });
  assert.ok(scene, "normal family path with full ProblemIR must draw");
  assert.equal(scene.document.source.sourceModel ?? scene.document.source.archetype, model);
  assert.ok(compileSceneDocument(scene.document).ok);
}

const trains = "Two trains A and B move in the same direction with speeds 72 km/h and 54 km/h respectively. Train A is 100 m behind B. Find how long A takes to catch up with B.";
// 72/3.6=20, 54/3.6=15, vAB=20-15=5, t=100/5=20, xmeet=20*20=400.
check("bound relative velocity overrides another body's allowed speed", () => {
  for (const wrong of [20, 15, -5]) {
    const result = corrected(plan(trains, [], [quantity("vr", "v_AB", wrong, "m/s")]));
    close(value(result.plan, "vr"), 5);
    assert.equal(result.outcomes.find((o) => o.topic === "physics|2|relative-velocity")?.corrections.length, 1);
    draw(result.plan, "relative_motion_1d");
  }
});
check("swapped named givens are corrected despite both literals being stated", () => {
  const p = plan(trains, [quantity("va", "v_A", 54, "km/h", "given"), quantity("vb", "v_B", 72, "km/h", "given")]);
  const before = structuredClone(p); const result = corrected(p);
  close(value(result.plan, "va"), 72); close(value(result.plan, "vb"), 54);
  assert.deepEqual(p, before);
  assert.deepEqual(corrected(result.plan).plan, result.plan);
  draw(result.plan, "relative_motion_1d");
});
check("bindings also precede length/time membership and raw given literals", () => {
  const result = corrected(plan(trains, [quantity("t", "t", 100, "s", "given")], [quantity("x", "x_meet", 100, "m"), quantity("v_A", "velocity", 15, "m/s")]));
  close(value(result.plan, "t"), 20); close(value(result.plan, "x"), 400); close(value(result.plan, "v_A"), 20);
});
check("correct units, rounded time and unjudged intermediate length survive", () => {
  const p = plan(trains, [quantity("va", "v_A", 20, "m/s", "given"), quantity("vb", "v_B", 15, "m/s", "given"), quantity("gap", "d", 0.1, "km", "given")], [quantity("rel", "v_rel", 18, "km/h"), quantity("t", "t", 0.333, "min"), quantity("x", "x_meet", 0.4, "km"), quantity("step", "s_5", 75, "m")]);
  assert.deepEqual(corrected(p).plan, p); draw(p, "relative_motion_1d");
});
const west = "Use the ground frame with west positive. Point A starts at x=0 m and B at x=-150 m at t=0. A moves east at 12 m/s and B moves west at 18 m/s, constantly. Give signed vAB and the first t>=0 encounter time and coordinate.";
// West-positive velocities -12,+18; vAB=-30, vBA=+30, t=(-150)/(-30)=5, x=-60.
check("signed axis reversal and inverse relative velocity retain correct signs", () => {
  const p = plan(west, [quantity("va", "v_A", -43.2, "km/h", "given"), quantity("vb", "v_B", 64.8, "km/h", "given")], [quantity("rel", "v_AB", -108, "km/h"), quantity("back", "v_BA", 108, "km/h"), quantity("t", "t", 1 / 12, "min"), quantity("x", "x_meet", -0.06, "km")]);
  assert.deepEqual(corrected(p).plan, p); draw(p, "relative_motion_1d");
  const wrong = corrected(plan(west, [], [quantity("rel", "v_AB", -12, "m/s"), quantity("back", "v_BA", 18, "m/s")]));
  close(value(wrong.plan, "rel"), -30); close(value(wrong.plan, "back"), 30);
  close(value(corrected(plan(west, [], [quantity("rel", "v_AB", 30, "m/s")])).plan, "rel"), -30);
});
check("head-on and negative-relative sources bind both signed pair directions", () => {
  const headOn = "Two cars A and B move towards each other at 10 m/s and 15 m/s. They are 500 m apart. Find when they meet.";
  // vA=+10, vB=-15: vAB=+25 and vBA=-25, t=500/25=20.
  const p = plan(headOn, [quantity("b", "v_B", 15, "m/s", "given")], [quantity("ab", "v_AB", 90, "km/h"), quantity("ba", "v_BA", -90, "km/h"), quantity("t", "t", 20, "s")]);
  assert.deepEqual(corrected(p).plan, p); draw(p, "relative_motion_1d");
  close(value(corrected(plan(headOn, [], [quantity("ba", "v_BA", 25, "m/s")])).plan, "ba"), -25);
  const slower = "Two cars A and B move in the same direction with speeds 10 m/s and 15 m/s. Car A is 50 m behind car B. Find the relative velocity of A with respect to B and when A catches up with B.";
  const signed = plan(slower, [], [quantity("ab", "v_AB", -18, "km/h"), quantity("ba", "v_BA", 18, "km/h")]);
  assert.deepEqual(corrected(signed).plan, signed);
  const wrong = corrected(plan(slower, [], [quantity("ab", "v_AB", 5, "m/s"), quantity("ba", "v_BA", -5, "m/s")]));
  close(value(wrong.plan, "ab"), -5); close(value(wrong.plan, "ba"), 5);
});
for (const [symbol, number, unit] of [["v_A", 72, "s"], ["v_AB", 20, "s"], ["v_AB", 100, "m"], ["v_AB", 20, "kg"], ["v_AB", 20, "m/s^2"], ["x_meet", 20, "m/s"]] as const) {
  check(`named wrong-dimension ${symbol}=${number} ${unit} is withdrawn`, () => {
    const p = plan(trains, [quantity("bad", symbol, number, unit, "given")]);
    const result = corrected(p);
    assert.equal(value(result.plan, "bad"), undefined);
    assert.equal(result.outcomes.find((o) => o.topic === "physics|2|relative-velocity")?.corrections.length, 0);
    assert.equal(synthesizeFamilyScene({ question: trains, turnPlan: p, problemIR: problem(trains) }), null);
  });
}
const observer = "In the ground frame, east is positive. At t=0 point A is at 0 m and B at 100 m; their constant ground velocities are +20 m/s and +10 m/s. Observer O starts at x=0 m and moves east at +15 m/s. Report vAO, vBO, vAB and the encounter time for t>=0 in O's frame, using east as positive.";
// vAO=20-15=5, vBO=10-15=-5, vAB=10; boosts leave meeting time 10 s unchanged.
check("correct observer-frame velocities survive while swapped roles are corrected", () => {
  const p = plan(observer, [quantity("o", "v_O", 54, "km/h", "given")], [quantity("ao", "v_AO", 18, "km/h"), quantity("bo", "v_BO", -18, "km/h"), quantity("ab", "v_AB", 10, "m/s"), quantity("t", "t", 10, "s")]);
  assert.deepEqual(corrected(p).plan, p); draw(p, "relative_motion_1d");
  const wrong = corrected(plan(observer, [quantity("o", "v_O", 20, "m/s", "given")], [quantity("ao", "v_AO", 10, "m/s"), quantity("bo", "v_BO", -10, "m/s")]));
  close(value(wrong.plan, "o"), 15); close(value(wrong.plan, "ao"), 5); close(value(wrong.plan, "bo"), -5);
});
check("unbound unsupported velocity/time are withdrawn including unknowns", () => {
  const result = corrected(plan(trains, [], [quantity("extra", "u_extra", 999, "m/s"), quantity("time", "T_1", 640, "s")]));
  assert.equal(result.plan.derived.length, 0); assert.equal(result.plan.unknowns.length, 0);
});
check("an extra request premise gets no relative source authority", () => {
  const question = trains.replace("B.", "B if B moves at 36 km/h instead.");
  const p = plan(question, [], [quantity("t", "t", 999, "s")]);
  assert.equal(corrected(p).outcomes.filter((o) => /relative-velocity/.test(o.topic)).length, 0);
  assert.equal(synthesizeFamilyScene({ question, turnPlan: p, problemIR: problem(question) }), null);
});

const river = (boat: string, current: string, width = "120 m", request = "minimum time to cross") => `A river flows at ${current}. A boat can row at ${boat} in still water. The river is ${width} wide. Find the ${request}.`;
const fractions = river("5/2 m/s", "1/2 m/s");
check("named river speed with a time unit is withdrawn", () => {
  const p = plan(fractions, [quantity("bad", "v_b", 120, "s", "given")]);
  assert.equal(value(corrected(p).plan, "bad"), undefined);
});
check("river fractions read as complete numbers and preserve the correct 48 seconds", () => {
  assert.deepEqual(riverCrossingSpeeds(fractions), { status: "bound", vb: 2.5, vc: 0.5, unit: "m/s", widthM: 120 });
  const p = plan(fractions, [quantity("b", "v_b", 2.5, "m/s", "given"), quantity("c", "v_c", 0.5, "m/s", "given")], [quantity("t", "t", 48, "s"), quantity("drift", "drift", 24, "m")]);
  assert.deepEqual(corrected(p).plan, p); draw(p, "river_boat");
  const stale = corrected(plan(fractions, [], [quantity("t", "t", 60, "s")])); close(value(stale.plan, "t"), 48);
});
check("river role and time bindings precede membership in other allowed values", () => {
  const result = corrected(plan(fractions, [quantity("b", "v_b", 0.5, "m/s", "given"), quantity("c", "v_c", 2.5, "m/s", "given"), quantity("t", "t", 120, "s", "given")]));
  close(value(result.plan, "b"), 2.5); close(value(result.plan, "c"), 0.5); close(value(result.plan, "t"), 48);
});
for (const [boat, current, width, vb, vc, widthM] of [
  ["2 1/2 m/s", "1/2 m/s", "1/8 km", 2.5, 0.5, 125],
  ["2½ m/s", "½ m/s", "¼ km", 2.5, 0.5, 250],
  ["25 × 10^-1 m/s", "5e-1 m/s", "1,200 m", 2.5, 0.5, 1200],
  ["9 km/hr", "9/5 km/hr", "3/25 km", 9, 1.8, 120],
  ["+5/2m/s", "+1/2m/s", "120m", 2.5, 0.5, 120],
] as const) check(`shared river scalar grammar: ${boat}; ${current}; ${width}`, () => {
  const question = river(boat, current, width);
  assert.deepEqual(riverCrossingSpeeds(question), { status: "bound", vb, vc, unit: /km/.test(boat) ? "km/h" : "m/s", widthM });
  const seconds = widthM / (vb * (/km/.test(boat) ? 1 / 3.6 : 1));
  const result = corrected(plan(question, [], [quantity("t", "t", seconds / 60, "min")]));
  close(value(result.plan, "t"), seconds / 60); draw(result.plan, "river_boat");
});
check("shortest path and shortest time use separate equations, angles and drift", () => {
  // vb=2.5, vc=0.5: normal speed on shortest path sqrt(6); t=120/sqrt(6).
  const path = river("5/2 m/s", "1/2 m/s", "3/25 km", "time to cross by the shortest path");
  const pathTime = 120 / Math.sqrt(6); const angle = Math.asin(1 / 5);
  const p = plan(path, [quantity("b", "v_b", 2.5, "m/s", "given"), quantity("c", "v_c", 0.5, "m/s", "given")], [quantity("t", "t", pathTime, "s"), quantity("a", "alpha", angle * 180 / Math.PI, "degree"), quantity("v", "v", Math.sqrt(6), "m/s")]);
  assert.deepEqual(corrected(p).plan, p);
  // Shortest-path fractional rendering can choose a legacy symbolic sketch.
  // This authority/reader gate does not claim that renderer is fixed; its
  // reproduction and unit-conversion gap are recorded in the work log.
  // Authority unit preservation is checked independently of the legacy
  // renderer's existing radian-heading conversion gap (recorded in the log).
  const radians = structuredClone(p); radians.derived[1]!.value = angle; radians.derived[1]!.unit = "rad";
  assert.deepEqual(corrected(radians).plan, radians);
  close(value(corrected(plan(path, [], [quantity("t", "t", 48, "s")])).plan, "t"), pathTime);
  const fast = corrected(plan(fractions, [], [quantity("t", "t", pathTime, "s"), quantity("a", "alpha", angle, "rad"), quantity("drift", "drift", 99, "m")]));
  close(value(fast.plan, "t"), 48); assert.equal(value(fast.plan, "a"), undefined); assert.equal(value(fast.plan, "drift"), undefined);
});
check("downstream and upstream speeds remain independent of crossing time", () => {
  const question = river("5/2 m/s", "1/2 m/s", "120 m", "speeds downstream and upstream");
  const p = plan(question, [], [quantity("down", "v_down", 3, "m/s"), quantity("up", "v_up", 2, "m/s")]);
  assert.deepEqual(corrected(p).plan, p);
  const swapped = corrected(plan(question, [], [quantity("down", "v_down", 2, "m/s"), quantity("up", "v_up", 3, "m/s")]));
  close(value(swapped.plan, "down"), 3); close(value(swapped.plan, "up"), 2);
});
for (const expression of ["1/0", "1/2/3", "2^3", "2*3", "2 × 3", "sqrt(2)", "√2", "π/2", "1/2 + 2", "x+2", "a + 2", "sqrt(2)+3", "1 1/2/3", "1,0000", "-1/2", "0"]) {
  check(`unsupported whole boat quantity declines: ${expression}`, () => {
    const question = river(`${expression} m/s`, "1/2 m/s"); const p = plan(question, [], [quantity("t", "t", 48, "s")]);
    assert.equal(riverCrossingSpeeds(question).status, "unbound");
    assert.equal(corrected(p).outcomes.filter((o) => /relative-velocity/.test(o.topic)).length, 0);
    assert.equal(synthesizeFamilyScene({ question, turnPlan: p, problemIR: problem(question) }), null);
  });
}
for (const width of ["1/0 m", "1/2/3 km", "2*60 m", "sqrt(120) m", "1/2 + 120 m", "-120 m", "0 m", "120 cm", "120 m^2"]) {
  check(`unsupported whole width declines: ${width}`, () => {
    const question = river("5/2 m/s", "1/2 m/s", width); const p = plan(question, [], [quantity("t", "t", 48, "s")]);
    assert.equal(riverCrossingSpeeds(question).status, "unbound");
    assert.equal(corrected(p).outcomes.filter((o) => /relative-velocity/.test(o.topic)).length, 0);
    assert.equal(synthesizeFamilyScene({ question, turnPlan: p, problemIR: problem(question) }), null);
  });
}
check("numeric speeds with unreadable units cannot become a value-free sketch", () => {
  for (const unit of ["m/s^2", "m/s²", "m/sec", "km/hours", "m/h", "ft/s", "mph"]) {
    const question = river(`5/2 ${unit}`, `1/2 ${unit}`); const p = plan(question);
    assert.equal(riverCrossingSpeeds(question).status, "unbound");
    assert.equal(synthesizeFamilyScene({ question, turnPlan: p, problemIR: problem(question) }), null);
  }
});
check("an unsupported extra speed or width cannot disappear beside supported quantities", () => {
  for (const question of [fractions.replace("Find", "Another boat rows at sqrt(2) m/s. Find"), fractions.replace("Find", "The river is also 2^3 m wide. Find")]) {
    assert.equal(riverCrossingSpeeds(question).status, "unbound");
    assert.equal(corrected(plan(question)).outcomes.filter((o) => /relative-velocity/.test(o.topic)).length, 0);
  }
});
check("ambiguous river roles, mixed units and impossible straight crossing decline", () => {
  for (const question of [
    "A boat and a river current have speeds 5 km/h and 3 km/h. Find the minimum time to cross a 1 km wide river.",
    river("5/2 m/s", "9/5 km/h"),
    river("1/2 m/s", "5/2 m/s", "120 m", "shortest path straight across"),
  ]) assert.equal(synthesizeFamilyScene({ question, turnPlan: plan(question), problemIR: problem(question) }), null);
});
check("numberless river source remains unstated", () => {
  assert.equal(riverCrossingSpeeds("A boat crosses a flowing river. Draw its velocity triangle.").status, "unstated");
});

for (const failure of failures) console.error(`FAIL ${failure}`);
assert.ok(checks > 0, "the case filter must select at least one independent group");
console.log(`w1 relative authority: ${checks - failures.length}/${checks} independent groups passed`);
process.exitCode = failures.length ? 1 : 0;
