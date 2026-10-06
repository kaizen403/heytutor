/**
 * SUVAT readiness gate (physics|2|suvat-equations, declared scope).
 *
 * Runs representative straight-line constant-acceleration questions through
 * the tutor's own representation selector (the deterministic path the live
 * turn takes after the planner) and checks the drawn v-t figure against
 * hand-computed values. Controls must not draw the SUVAT figure, and must not
 * draw any numeric label that disagrees with the hand values.
 *
 * Needs the scene-engine dist: `pnpm turbo run build --filter=@heytutor/scene-engine`.
 * Usage: tsx scripts/verify/verify-suvat-ready.ts [outDir]
 */
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { renderSceneSvg } from "../../../../packages/scene-engine/scripts/lib/renderSceneSvg";
import type { RenderScene } from "@heytutor/scene-engine";

type Given = [symbol: string, value: number, unit: string, sourceText: string];
type Derived = [symbol: string, value: number, unit: string];
interface Case {
  id: string;
  question: string;
  givens: Given[];
  derived: Derived[];
  /** Independent hand values in SI: u, v, a, t, s. */
  expected?: { u: number; v: number; a: number; t: number; s: number };
  /** Controls: why the SUVAT figure must not appear. */
  control?: string;
  /** Run with no turn plan: the question's own numbers only. */
  noPlan?: boolean;
}

const CASES: Case[] = [
  {
    id: "final_velocity_from_u_a_t",
    question: "A car moving with an initial velocity of 2 m/s accelerates uniformly at 4 m/s^2 for 3 s. Find its final velocity and the distance covered.",
    givens: [["u", 2, "m/s", "initial velocity of 2 m/s"], ["a", 4, "m/s^2", "4 m/s^2"], ["t", 3, "s", "3 s"]],
    derived: [["v", 14, "m/s"], ["s", 24, "m"]],
    // v = 2 + 4*3 = 14; s = 2*3 + 0.5*4*9 = 24
    expected: { u: 2, v: 14, a: 4, t: 3, s: 24 },
  },
  {
    id: "braking_to_rest",
    question: "A train moving at 20 m/s applies brakes and decelerates uniformly at 2 m/s^2 until it stops. Find the time taken to stop and the stopping distance.",
    givens: [["u", 20, "m/s", "20 m/s"], ["a", 2, "m/s^2", "2 m/s^2"], ["v", 0, "m/s", "until it stops"]],
    derived: [["t", 10, "s"], ["s", 100, "m"]],
    // t = 20/2 = 10; s = 20^2 / (2*2) = 100
    expected: { u: 20, v: 0, a: -2, t: 10, s: 100 },
  },
  {
    id: "distance_from_u_v_a",
    question: "A cyclist speeds up from 3 m/s to 7 m/s with a constant acceleration of 2 m/s^2 along a straight road. How far does the cyclist travel during this time?",
    givens: [["u", 3, "m/s", "3 m/s"], ["v", 7, "m/s", "7 m/s"], ["a", 2, "m/s^2", "2 m/s^2"]],
    derived: [["s", 10, "m"]],
    // s = (49 - 9) / 4 = 10; t = 4/2 = 2
    expected: { u: 3, v: 7, a: 2, t: 2, s: 10 },
  },
  {
    id: "vt_graph_area_from_rest",
    question: "A body starts from rest and accelerates uniformly at 2 m/s^2 for 5 s. Draw the velocity-time graph and use its area to find the displacement.",
    givens: [["u", 0, "m/s", "starts from rest"], ["a", 2, "m/s^2", "2 m/s^2"], ["t", 5, "s", "5 s"]],
    derived: [["v", 10, "m/s"], ["s", 25, "m"]],
    // v = 10; area = 0.5 * 5 * 10 = 25
    expected: { u: 0, v: 10, a: 2, t: 5, s: 25 },
  },
  {
    id: "kmh_conversion",
    question: "A car accelerates uniformly from 36 km/h to 72 km/h in 5 s on a straight road. Find its acceleration and the distance it covers in this time.",
    givens: [["u", 36, "km/h", "36 km/h"], ["v", 72, "km/h", "72 km/h"], ["t", 5, "s", "5 s"]],
    derived: [["a", 2, "m/s^2"], ["s", 75, "m"]],
    // 36 km/h = 10 m/s, 72 km/h = 20 m/s; a = 10/5 = 2; s = 15*5 = 75
    expected: { u: 10, v: 20, a: 2, t: 5, s: 75 },
  },
  {
    id: "fraction_acceleration",
    question: "A cart moving at 4 m/s accelerates uniformly at 1/2 m/s^2 for 4 s. Find its final velocity.",
    givens: [["u", 4, "m/s", "4 m/s"], ["a", 0.5, "m/s^2", "1/2 m/s^2"], ["t", 4, "s", "4 s"]],
    derived: [["v", 6, "m/s"]],
    // a = 1/2, never the denominator 2: v = 4 + 0.5*4 = 6; s = 16 + 0.25*16 = 20
    expected: { u: 4, v: 6, a: 0.5, t: 4, s: 20 },
  },
  {
    id: "fraction_acceleration_question_only",
    question: "A cart moving at 4 m/s accelerates uniformly at 1/2 m/s^2 for 4 s. Find its final velocity.",
    givens: [], derived: [], noPlan: true,
    expected: { u: 4, v: 6, a: 0.5, t: 4, s: 20 },
  },
  {
    id: "fraction_deceleration_question_only",
    question: "A trolley moving at 6 m/s decelerates uniformly at 1/2 m/s^2 for 4 s on a straight track. Find its final velocity and the distance covered.",
    givens: [], derived: [], noPlan: true,
    // a = -1/2, never -2 (which would stop it at 3 s): v = 6 - 0.5*4 = 4; s = 24 - 0.25*16 = 20
    expected: { u: 6, v: 4, a: -0.5, t: 4, s: 20 },
  },
  {
    id: "mixed_fraction_acceleration_question_only",
    question: "A car moving at 2 m/s accelerates uniformly at 1 1/2 m/s^2 for 2 s. Find its final velocity.",
    givens: [], derived: [], noPlan: true,
    // a = 1.5: v = 2 + 3 = 5; s = 4 + 0.75*4 = 7
    expected: { u: 2, v: 5, a: 1.5, t: 2, s: 7 },
  },
  {
    id: "horizontal_vt_graph",
    question: "A velocity–time graph is a horizontal line at v = 10 m/s from t = 0 to t = 4.0 s. Sketch it, find the displacement from the area.",
    givens: [], derived: [], noPlan: true,
    // horizontal line: a = 0, v = u = 10, area = 10*4 = 40
    expected: { u: 10, v: 10, a: 0, t: 4, s: 40 },
  },
  {
    id: "control_inconsistent_overdetermined",
    question: "A car starts from rest and accelerates uniformly at 1 m/s^2 for 2 s, reaching 3 m/s.",
    givens: [["u", 0, "m/s", "starts from rest"], ["a", 1, "m/s^2", "1 m/s^2"], ["t", 2, "s", "2 s"], ["v", 3, "m/s", "3 m/s"]],
    derived: [],
    control: "v=0+1*2=2, not the stated 3 m/s",
  },
  {
    id: "control_stops_before_stated_time",
    question: "A train moving at 20 m/s brakes with a uniform deceleration of 2 m/s^2 for 12 s. Find its displacement.",
    givens: [["u", 20, "m/s", "20 m/s"], ["a", 2, "m/s^2", "2 m/s^2"], ["t", 12, "s", "12 s"]],
    derived: [["s", 96, "m"]],
    control: "the train stops at 10 s; s=ut+at^2/2 would wrongly reverse it",
  },
  {
    id: "control_negative_time_root",
    question: "A car moving at 10 m/s accelerates uniformly at 2 m/s^2 until its velocity is 4 m/s. Find the time taken.",
    givens: [["u", 10, "m/s", "10 m/s"], ["a", 2, "m/s^2", "2 m/s^2"], ["v", 4, "m/s", "4 m/s"]],
    derived: [["t", -3, "s"]],
    control: "t=(4-10)/2 is negative",
  },
  {
    id: "control_unit_mismatch",
    question: "A car moving at 5 m/s accelerates uniformly at 0.1 m/s^2 for 2 min on a straight road. Find its final velocity.",
    givens: [["u", 5, "m/s", "5 m/s"], ["a", 0.1, "m/s^2", "0.1 m/s^2"], ["t", 2, "s", "2 min"]],
    derived: [["v", 5.2, "m/s"]],
    control: "the plan read 2 min as 2 s; the question's 120 s disagrees",
  },
  {
    id: "control_stale_narration_scalar",
    question: "A car moving with an initial velocity of 2 m/s accelerates uniformly at 4 m/s^2 for 3 s. Find its final velocity and the distance covered.",
    givens: [["u", 2, "m/s", "initial velocity of 2 m/s"], ["a", 4, "m/s^2", "4 m/s^2"], ["t", 3, "s", "3 s"]],
    derived: [["v", 15, "m/s"], ["s", 24, "m"]],
    control: "plan derived v=15 disagrees with the recomputed 14",
  },
  {
    id: "control_unknown_unit",
    question: "A car moving at 10 ft/s accelerates uniformly at 2 ft/s^2 for 4 s along a straight road. Find its final speed.",
    givens: [["u", 10, "ft/s", "10 ft/s"], ["a", 2, "ft/s^2", "2 ft/s^2"], ["t", 4, "s", "4 s"]],
    derived: [["v", 18, "ft/s"]],
    control: "feet are not a supported unit; nothing is converted silently",
  },
];

const out = resolve(process.argv[2] ?? "/tmp/suvat-ready/gate");
mkdirSync(out, { recursive: true });
let checks = 0;
const close = (actual: number, expected: number, name: string, tolerance = 1e-6) => {
  checks++;
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${name}: ${actual} != ${expected}`);
};

function plan(c: Case) {
  if (c.noPlan) return null;
  return {
    schemaVersion: "turn-plan/v3", question: c.question,
    givens: c.givens.map(([symbol, value, unit, sourceText]) => ({ id: symbol, symbol, value, unit, provenance: "given", sourceText })),
    unknowns: c.derived.map(([symbol, , unit]) => ({ id: symbol, symbol, unit })),
    derived: c.derived.map(([symbol, value, unit]) => ({ id: symbol, symbol, value, unit, provenance: "derived" })),
    qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  };
}

function primitive(scene: RenderScene, entityId: string) {
  const found = scene.primitives.find((item) => item.entityId === entityId && item.kind !== "label" && item.points.length > 0);
  assert.ok(found, `primitive ${entityId}`);
  return found;
}

function shoelace(points: ReadonlyArray<{ x: number; y: number }>): number {
  let sum = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!;
    sum += point.x * next.y - next.x * point.y;
  });
  return Math.abs(sum) / 2;
}

/** Every number in any label, so a control cannot hide a wrong value in ink. */
function labelNumbers(selected: ReturnType<typeof selectVerifiedRepresentation>): number[] {
  const texts = [
    ...selected.sceneDocument.entities.map((entity) => entity.label ?? ""),
    ...selected.renderScene.primitives.map((item) => item.text ?? ""),
  ];
  return texts.flatMap((text) => [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])));
}

const results: unknown[] = [];
for (const c of CASES) {
  const selected = selectVerifiedRepresentation({ question: c.question, turnPlan: plan(c) });
  const archetype = (selected.sceneDocument.source as { archetype?: string }).archetype ?? null;
  writeFileSync(resolve(out, `${c.id}.scene.json`), JSON.stringify(selected.sceneDocument, null, 2));
  writeFileSync(resolve(out, `${c.id}.svg`), renderSceneSvg(selected.renderScene, { title: `SUVAT ${c.id}`, subtitle: `${selected.tier} ${archetype ?? selected.family ?? "none"}` }));
  if (c.expected) {
    const e = c.expected;
    checks++;
    assert.equal(archetype, "uniform_acceleration_vt", `${c.id}: drew ${archetype ?? selected.family} (${selected.reason})`);
    checks++;
    assert.equal(selected.tier, "exact_verified", `${c.id}: tier ${selected.tier}`);
    const quantities = new Map(selected.sceneDocument.quantities.map((quantity) => [String(quantity.symbol), Number(quantity.value)] as const));
    for (const role of ["u", "v", "a", "t", "s"] as const) close(quantities.get(role)!, e[role], `${c.id} quantity ${role}`);
    // SUVAT identities hold for the drawn state.
    const q = (role: string) => quantities.get(role)!;
    close(q("v"), q("u") + q("a") * q("t"), `${c.id} v=u+at`);
    close(q("s"), q("u") * q("t") + 0.5 * q("a") * q("t") ** 2, `${c.id} s=ut+at^2/2`);
    close(q("v") ** 2, q("u") ** 2 + 2 * q("a") * q("s"), `${c.id} v^2=u^2+2as`);
    // Labels say the hand values (3 significant figures).
    const labels = Object.fromEntries(selected.sceneDocument.entities.filter((entity) => entity.label).map((entity) => [entity.id, entity.label!]));
    for (const [id, role, unit] of [["start", "u", "m/s"], ["end", "v", "m/s"], ["foot", "t", "s"], ["graph", "a", "m/s^2"], ["s_label", "s", "m"]] as const) {
      checks++;
      assert.equal(labels[id], `${role} = ${Number(e[role].toPrecision(3))} ${unit}`, `${c.id} label ${id}`);
    }
    // Rendered geometry, independent of the display factor: pixel ratios.
    const scene = selected.renderScene;
    const zero = primitive(scene, "zero").points;
    const origin = zero[0]!;
    const start = primitive(scene, "start").points[0]!;
    const end = primitive(scene, "end").points[0]!;
    // When v=0 the end point sits on the axis and the foot shares its mark.
    const foot = e.v === 0 ? end : primitive(scene, "foot").points[0]!;
    close(foot.y, origin.y, `${c.id} foot on time axis`, 1e-6);
    close(start.x, origin.x, `${c.id} start at t=0`, 1e-6);
    close(end.x, foot.x, `${c.id} end above foot`, 1e-6);
    const height = (point: { y: number }) => origin.y - point.y;
    if (e.u === 0) close(height(start), 0, `${c.id} starts on the axis`, 1e-6);
    else close(height(end) / height(start), e.v / e.u, `${c.id} pixel v/u`, 1e-4);
    const area = shoelace(primitive(scene, "area").points);
    const peak = Math.max(height(start), height(end));
    const peakValue = Math.max(e.u, e.v);
    close(area / ((foot.x - origin.x) * peak), e.s / (e.t * peakValue), `${c.id} pixel area ratio`, 1e-3);
    const graph = primitive(scene, "graph").points;
    for (const point of graph) {
      const fraction = (point.x - origin.x) / (foot.x - origin.x);
      const value = e.u + (e.v - e.u) * fraction;
      close(height(point) / peak, value / peakValue, `${c.id} graph is the line u+at`, 1e-3);
    }
    for (const item of scene.primitives) for (const point of item.points) {
      checks++;
      assert.ok(point.x >= 0 && point.x <= 1200 && point.y >= 0 && point.y <= 700, `${c.id} ${item.entityId} inside the canvas`);
    }
    results.push({ id: c.id, tier: selected.tier, archetype, expected: e });
  } else {
    checks++;
    assert.notEqual(archetype, "uniform_acceleration_vt", `${c.id} must decline: ${c.control}`);
    // Nor may a canned v-t shape stand in for the motion it declined.
    checks++;
    assert.notEqual(selected.family, "state_plot", `${c.id} fell back to a fixed v-t shape`);
    // Whatever the fallback drew, it carries no number the hand solution contradicts.
    const allowed = new Set(c.givens.map(([, value]) => value));
    const stray = labelNumbers(selected).filter((value) => !allowed.has(value) && value !== 0);
    checks++;
    assert.deepEqual(stray, [], `${c.id} fallback labels carry numbers not in the question: ${JSON.stringify(stray)}`);
    results.push({ id: c.id, declined: true, fallbackTier: selected.tier, fallback: archetype ?? selected.family ?? "text-only", reason: selected.reason });
  }
}
// A planner scene that validated but only earned the qualitative tier must not
// displace the source-bound exact figure; an exact planner scene keeps priority.
{
  const c = CASES[0]!;
  const control = CASES.find((item) => item.id === "control_inconsistent_overdetermined")!;
  const qualitative = selectVerifiedRepresentation({ question: control.question, turnPlan: plan(control) });
  checks++;
  assert.equal(qualitative.tier, "qualitative_verified");
  const selected = selectVerifiedRepresentation({
    question: c.question, turnPlan: plan(c),
    exact: { sceneDocument: qualitative.sceneDocument, renderScene: qualitative.renderScene, validationReport: qualitative.validationReport },
  });
  checks++;
  assert.equal((selected.sceneDocument.source as { archetype?: string }).archetype, "uniform_acceleration_vt", "exact archetype outranks a qualitative planner scene");
  const exactPlanner = selectVerifiedRepresentation({ question: c.question, turnPlan: plan(c) });
  const kept = selectVerifiedRepresentation({
    question: c.question, turnPlan: plan(c),
    exact: { sceneDocument: exactPlanner.sceneDocument, renderScene: exactPlanner.renderScene, validationReport: exactPlanner.validationReport },
  });
  checks++;
  assert.ok(kept.reason.startsWith("caller supplied a verified scene"), `an exact planner scene keeps its priority: ${kept.reason}`);
}
// Multi-phase v-t graphs (vt_graph archetype): the first vertex is the stated
// initial speed, never rest unless the question says rest.
const sections: unknown[] = [];
function pointAt(selected: ReturnType<typeof selectVerifiedRepresentation>, id: string) {
  const construction = selected.sceneDocument.constructions.find((item) => item.outputs.includes(id));
  assert.ok(construction, `construction for ${id}`);
  return { x: Number(construction.inputs.x), y: Number(construction.inputs.y) };
}
{
  const question = "A car moving at 10 m/s accelerates uniformly at 2 m/s^2 for 5 s, then moves at constant speed for 10 s. Draw the velocity-time graph and find the distance travelled.";
  const selected = selectVerifiedRepresentation({ question, turnPlan: null });
  writeFileSync(resolve(out, "multiphase_stated_start.svg"), renderSceneSvg(selected.renderScene, { title: "v-t from 10 m/s", subtitle: selected.tier }));
  checks++;
  assert.equal((selected.sceneDocument.source as { archetype?: string }).archetype, "vt_graph", selected.reason);
  // Hand values: start (0, 10); after 5 s at +2 the speed is 20; cruise to t = 15.
  const p0 = pointAt(selected, "p0");
  const p1 = pointAt(selected, "p1");
  const p2 = pointAt(selected, "p2");
  close(p0.x, 0, "multi-phase p0 time");
  close(p1.x, 5, "multi-phase p1 time");
  close(p2.x, 15, "multi-phase p2 time");
  close(p1.y / p0.y, 2, "multi-phase v1/v0 = 20/10");
  close(p2.y / p1.y, 1, "multi-phase cruise holds 20 m/s");
  const labels = selected.sceneDocument.entities.map((entity) => entity.label ?? "");
  for (const expected of ["(0 s, 10 m/s)", "(5 s, 20 m/s)", "(15 s, 20 m/s)"]) {
    checks++;
    assert.ok(labels.includes(expected.slice(0, 16)), `multi-phase label ${expected}: ${JSON.stringify(labels)}`);
  }
  const area = selected.renderScene.primitives.find((item) => item.entityId === "area" && item.kind !== "label");
  assert.ok(area);
  const mark = (id: string) => {
    const found = selected.renderScene.primitives.find((item) => item.entityId === id && item.kind !== "label" && item.points.length > 0);
    assert.ok(found, `mark ${id}`);
    return found.points[0]!;
  };
  const start = mark("p0");
  const footEnd = mark("foot2");
  close(mark("foot1").y, footEnd.y, "multi-phase feet on the time axis");
  const pixelPerSecond = (footEnd.x - start.x) / 15;
  const pixelPerSpeed = (footEnd.y - start.y) / 10;
  // Area = trapezoid 0.5*(10+20)*5 + rectangle 20*10 = 275 m.
  close(shoelace(area.points) / (pixelPerSecond * pixelPerSpeed), 275, "multi-phase area is the distance 275 m", 1e-3);
  sections.push({ id: "multiphase_stated_start", archetype: "vt_graph", area: 275 });
}
{
  // No start speed and no "rest": the archetype may not assume rest.
  const question = "A car accelerates at 2 m/s^2 for 5 s, then moves at constant speed for 10 s. Draw the velocity-time graph.";
  const selected = selectVerifiedRepresentation({ question, turnPlan: null });
  checks++;
  assert.notEqual((selected.sceneDocument.source as { archetype?: string }).archetype, "vt_graph", "unstated start speed must not be drawn from rest");
  sections.push({ id: "multiphase_unstated_start", declined: true, fallback: selected.family ?? "text-only", tier: selected.tier });
}

// Free fall and vertical throws: the height label is the stated drop or the
// recomputed u^2/(2g), never a plan-derived value and never a speed read as metres.
interface FallCase { id: string; question: string; givens: Given[]; derived: Derived[]; height?: number; declines?: boolean; noPlan?: boolean }
const FALLS: FallCase[] = [
  { id: "fall_throw_up", question: "A ball is thrown vertically upward with a speed of 10 m/s. Take g = 10 m/s^2. Find the maximum height reached.",
    givens: [["u", 10, "m/s", "10 m/s"], ["g", 10, "m/s^2", "g = 10 m/s^2"]], derived: [["h", 5, "m"]], height: 5 }, // 100/20
  { id: "fall_throw_up_question_only", question: "A ball is thrown vertically upward with a speed of 19.6 m/s. Taking g = 9.8 m/s^2, find the maximum height reached.",
    givens: [], derived: [], noPlan: true, height: 19.6 }, // 384.16/19.6
  { id: "fall_dropped_tower", question: "A stone is dropped from the top of a 45 m tall tower. Take g = 10 m/s^2. How long does it take to reach the ground?",
    givens: [["h", 45, "m", "45 m"], ["g", 10, "m/s^2", "g = 10 m/s^2"]], derived: [["t", 3, "s"]], height: 45 },
  { id: "fall_raindrop_km", question: "A raindrop of mass 1 g starts from rest at height 1 km and hits the ground at 5 m/s.",
    givens: [], derived: [], noPlan: true, height: 1000 }, // 1 km, not the 5 of "5 m/s"
  { id: "control_fall_stale_height", question: "A ball is thrown vertically upward with a speed of 10 m/s. Take g = 10 m/s^2. Find the maximum height reached.",
    givens: [["u", 10, "m/s", "10 m/s"], ["g", 10, "m/s^2", "g = 10 m/s^2"]], derived: [["h", 6, "m"]], declines: true },
  { id: "control_fall_derived_only_height", question: "A ball is thrown vertically upward from the ground and returns after some time. Find the maximum height.",
    givens: [], derived: [["h", 20, "m"]] },
];
for (const c of FALLS) {
  const turnPlan = c.noPlan ? null : plan({ id: c.id, question: c.question, givens: c.givens, derived: c.derived });
  const selected = selectVerifiedRepresentation({ question: c.question, turnPlan });
  const archetype = (selected.sceneDocument.source as { archetype?: string }).archetype ?? null;
  writeFileSync(resolve(out, `${c.id}.svg`), renderSceneSvg(selected.renderScene, { title: c.id, subtitle: `${selected.tier} ${archetype ?? selected.family ?? "none"}` }));
  const heightLabel = selected.sceneDocument.entities.find((entity) => entity.id === "height")?.label;
  if (c.height !== undefined) {
    checks++;
    assert.equal(archetype, "free_fall", `${c.id}: ${selected.reason}`);
    checks++;
    assert.equal(heightLabel, `h=${Number(c.height.toPrecision(3))} m`, `${c.id} height label`);
  } else if (c.declines) {
    checks++;
    assert.notEqual(archetype, "free_fall", `${c.id}: a stale derived height must decline the figure`);
  } else {
    // Only a derived value: the height may be drawn but never labelled with it.
    checks++;
    assert.ok(archetype !== "free_fall" || heightLabel === "h", `${c.id}: derived-only height labelled ${heightLabel}`);
  }
  const derivedValues = new Set(c.derived.map(([, value]) => value));
  const stray = labelNumbers(selected).filter((value) => derivedValues.has(value) && value !== c.height);
  checks++;
  assert.deepEqual(stray, [], `${c.id}: plan-derived numbers reached the ink ${JSON.stringify(stray)}`);
  sections.push({ id: c.id, archetype, tier: selected.tier, heightLabel: heightLabel ?? null });
}

const report = { topic: "physics|2|suvat-equations", gate: "verify-suvat-ready", checks, results, sections };
writeFileSync(resolve(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`verify-suvat-ready: ${checks} checks passed`);
