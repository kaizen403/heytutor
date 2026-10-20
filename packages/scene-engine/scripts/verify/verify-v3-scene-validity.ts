/**
 * Video 3 (Relative Velocity, 20 Oct 2026) scene documents refused for fixable
 * reasons, and the river crossing time the source authority rewrote.
 *
 * 1. `relations` entries arrive without ids ({kind, entities}, {on: [a, b]}).
 *    The id stage refused the whole document, and the repair prompt only ever
 *    said "relations[0] needs a non-empty id". Relations are never compiled,
 *    proven or rendered, so a normalizer gives each a fresh id and drops the
 *    unreadable ones (recorded as `relation_dropped`).
 * 2. `right_angle_mark` refused a line through the vertex as an arm. Either
 *    direction along it gives the same right angle; the arms must still be
 *    perpendicular. A tilted mark was then refused as "collapsed" by its
 *    bounding box; a corner glyph is measured by its two arms.
 * 3. `space_project` on a 2D `axes` frame is rewritten to the 2D `project`
 *    operator (the same foot of the perpendicular); with no frame at all the
 *    repair prompt now names `project`.
 * 4. River crossing: "a boat heads due north" across an east-flowing river is
 *    the least-time crossing, and "the heading to go straight across" asks the
 *    straight-across one too, so no single crossing time `t` may be bound.
 *
 * Fixtures:
 * - fixtures/v3-scene-validity-recorded.json: recorded planner documents
 *   (v1, v2, v3 and the YouTube lessons) whose replay changed, plus every
 *   p4e1-t1 and p4e2-t1 draft. Written by scripts/extract-recorded-scene-documents.ts.
 * - fixtures/river-crossing-heading-plans.json: the two recorded turn plans of
 *   v3 p2c-t2 (network.jsonl), both with t = 25 s.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-v3-scene-validity.ts
 *   ... --recorded <all.json>   also print validate / compile / proof counts over a full extraction
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SceneDocument, SceneIssue, TurnPlanV3 } from "../../src";

const engine = process.argv.includes("--compiled-boundary") ? await import("../../dist/index.js") : await import("../../src/index");
const here = dirname(fileURLToPath(import.meta.url));
let checks = 0;
function check(value: unknown, message: string): asserts value { checks += 1; assert.ok(value, message); }

type Raw = Record<string, unknown>;
interface Recorded { id: string; phase: string; question: string; turnPlan: TurnPlanV3 | null; document: Raw }
interface Replay { stage: "validate" | "compile" | "proof" | "ok"; issues: SceneIssue[]; document: SceneDocument | null }

function replay(recorded: Pick<Recorded, "question" | "turnPlan" | "document">): Replay {
  const raw = structuredClone(recorded.document);
  const source = typeof raw.source === "object" && raw.source !== null ? raw.source as Raw : {};
  raw.source = { ...source, question: typeof source.question === "string" ? source.question : recorded.question };
  const normalized = engine.normalizeVerifiedPartsInputs(raw, false).candidate;
  const validated = engine.validateSceneDocument(engine.pruneDeadSceneEntities(normalized));
  if (!validated.document) return { stage: "validate", issues: validated.report.issues, document: null };
  const compiled = engine.compileSceneDocument(validated.document);
  const compileFatal = compiled.report.issues.filter((issue: SceneIssue) => issue.severity === "fatal");
  const issues = [...validated.report.issues, ...compiled.report.issues];
  if (!compiled.ok || compileFatal.length > 0) return { stage: "compile", issues, document: validated.document };
  const proofs = recorded.turnPlan
    ? engine.validateTurnPlanSceneProofs(validated.document, recorded.turnPlan).filter((issue: SceneIssue) => issue.severity === "fatal")
    : [];
  return { stage: proofs.length > 0 ? "proof" : "ok", issues: [...issues, ...proofs], document: validated.document };
}
const fatal = (result: Replay) => result.issues.filter((issue) => issue.severity === "fatal");

// ------------------------------------------------------------ recorded replay
const recorded = JSON.parse(readFileSync(join(here, "fixtures/v3-scene-validity-recorded.json"), "utf8")) as Recorded[];
check(recorded.length >= 20, `expected the recorded fixtures, found ${recorded.length}`);
const byId = new Map(recorded.map((document) => [document.id, document]));
/** Every recorded document that validates, compiles and proves its plan after the fixes. */
const NOW_PASSING = [
  "v2/p1c-stopped-unmuted#4", "v2/p1c-t4#4", "v2/p1c-t4#5", "v2/p1c-t5#4", "v2/p3c-t1#4",
  "v3/p2e1-t1#4", "v3/p2e1-t1#5", "v3/p3e2-t1#5", "v3/p4c-t1#4", "v3/p4e1-t2#4",
  "v3/p4e1-t1#3", "v3/p4e1-t1#5", "v3/p4e1-t1#8",
  "v3/p4e2-t1#5", "v3/p4e2-t1#6", "v3/p4e2-t1#7", "v3/p4e2-t1#8", "v3/p4e2-t1#9",
];
for (const id of NOW_PASSING) check(byId.has(id), `fixture ${id} is missing`);
for (const document of recorded) {
  const result = replay(document);
  const codes = fatal(result).map((issue) => `${issue.code}: ${issue.message}`);
  check(!codes.some((code) => code.startsWith("invalid_id")), `${document.id}: relations must not stop the id stage: ${codes.join(" | ")}`);
  check(!codes.some((code) => /angle arm path must meet/.test(code)), `${document.id}: a line through the vertex is a right-angle arm: ${codes.join(" | ")}`);
  if (NOW_PASSING.includes(document.id)) {
    check(result.stage === "ok", `${document.id}: expected to validate, compile and prove its plan, stopped at ${result.stage}: ${codes.join(" | ")}`);
  }
}

// The p4e2-t1 drafts: the rewritten foot is the 2D projection, and the
// document's own "on" and "perpendicular" claims about it are proved.
for (const id of ["v3/p4e2-t1#6", "v3/p4e2-t1#7"]) {
  const result = replay(byId.get(id)!);
  const foot = result.document?.constructions.find((construction) => construction.outputs.includes("ptClosest"));
  check(foot?.operator === "project" && JSON.stringify(foot.inputs) === JSON.stringify({ point: "ptO", onto: "relPath" }), `${id}: space_project on axes must become project(ptO, relPath), got ${JSON.stringify(foot)}`);
  check(result.document!.assertions.some((assertion) => assertion.predicate === "perpendicular" && assertion.entities.includes("relPath")), `${id}: the perpendicular claim must remain`);
  check(result.stage === "ok", `${id}: must compile with its perpendicular and on claims proved`);
}
// No frame at all: still refused, but the repair prompt now names project.
{
  const result = replay(byId.get("v3/p4e2-t1#4")!);
  check(result.stage === "validate" && fatal(result).some((issue) => issue.code === "invalid_space_project_frame"), "p4e2-t1#4 names a frame that does not exist and must stay refused");
  check(result.issues.some((issue) => issue.code === "space_project_on_planar_inputs" && /"operator":"project"/.test(issue.message)), "p4e2-t1#4: the repair message must name the 2D project operator");
}
// Relations were rewritten, not trusted: every one has an id and a predicate.
{
  const result = replay(byId.get("v3/p4e2-t1#5")!);
  const relations = result.document!.relations;
  check(relations.length === 4 && relations.every((relation) => relation.id && relation.predicate && relation.entities.length > 0), `p4e2-t1#5 relations must be normalized: ${JSON.stringify(relations)}`);
  check(new Set(relations.map((relation) => relation.id)).size === relations.length, "assigned relation ids must be distinct");
  check(relations.some((relation) => relation.predicate === "converges" && relation.entities.join() === "roadEW,roadNS,O"), "the {converges: [...]} shape must keep its predicate and entities");
}

// ------------------------------------------------------------ relation mutations
const base = byId.get("v3/p4e1-t1#3")!;
check(replay(base).stage === "ok", "mutation base must pass before mutation");
const entityIds = new Set(((base.document.entities as Raw[]) ?? []).map((entity) => entity.id));
check(!entityIds.has("ghost"), "mutation entity must be unknown");
const mutate = (relations: unknown[]): Raw => ({ ...structuredClone(base.document), relations });
{
  // Unknown entity: the relation is refused (dropped and recorded); nothing is invented.
  const result = replay({ ...base, document: mutate([{ predicate: "on", entities: ["ghost", "relPath"] }, { id: "named", kind: "on", entities: ["pClosest", "ghost"] }]) });
  check(result.document && result.document.relations.length === 0, `relations naming an unknown entity must be refused: ${JSON.stringify(result.document?.relations)}`);
  check(!result.document.entities.some((entity) => entity.id === "ghost"), "the unknown entity must not be invented");
  check(result.issues.filter((issue) => issue.code === "relation_dropped" && issue.entityIds?.includes("ghost")).length === 2, "each refused relation is recorded");
}
{
  // An id written by the planner that collides with an entity stays a duplicate.
  const result = replay({ ...base, document: mutate([{ id: "relPath", predicate: "on", entities: ["pClosest", "relPath"] }]) });
  check(result.stage === "validate" && fatal(result).some((issue) => issue.code === "duplicate_id"), `a relation id colliding with an entity must stay refused: ${JSON.stringify(fatal(result))}`);
}
{
  // Assigned ids never collide with ids already in the document.
  const result = replay({ ...base, document: { ...mutate([{ predicate: "on", entities: ["pClosest", "relPath"] }]), annotations: [...((base.document.annotations as unknown[]) ?? []), { id: "relation_1", kind: "callout", targetIds: ["pA"], text: "A" }] } });
  check(result.document && result.document.relations[0]?.id === "relation_2", `fresh ids skip used ids: ${JSON.stringify(result.document?.relations)}`);
}
{
  // Malformed entries are dropped, never guessed.
  const result = replay({ ...base, document: mutate(["on pA relPath", { entities: ["pA", "relPath"] }, { on: "pA" }, { predicate: "on", entities: [] }, { predicate: "on", entities: ["pA", 3] }]) });
  check(result.document && result.document.relations.length === 0, "malformed relations must be dropped");
  check(result.issues.filter((issue) => issue.code === "relation_dropped").length === 5, "each malformed relation is recorded");
}

// ------------------------------------------------------------ right angle mark
const DEG = Math.PI / 180;
function rightAngleScene(degrees: number, arm: "line" | "segment" | "ray_ahead" | "ray_behind" | "offset_line"): Raw {
  const ux = Math.cos(degrees * DEG); const uy = Math.sin(degrees * DEG);
  const armConstruction = {
    line: { operator: "line", inputs: { start: "L0", end: "L1" } },
    segment: { operator: "segment", inputs: { start: "L0", end: "L1" } },
    ray_ahead: { operator: "ray", inputs: { start: "L0", end: "L1" } },
    ray_behind: { operator: "ray", inputs: { start: "L1", end: "L2" } },
    offset_line: { operator: "line", inputs: { start: "M0", end: "M1" } },
  }[arm];
  const point = (id: string, x: number, y: number) => ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] });
  const points = [
    point("V", 0, 0), point("A", 6, 0),
    point("L0", -4 * ux, -4 * uy), point("L1", 5 * ux, 5 * uy), point("L2", 9 * ux, 9 * uy),
    point("M0", -4 * ux + 1, -4 * uy), point("M1", 5 * ux + 1, 5 * uy),
  ];
  const entities = [
    ...["V", "A", "L0", "L1", "L2", "M0", "M1"].map((id) => ({ id, kind: "point", role: "point", ...(id === "V" || id === "A" ? { label: id } : {}) })),
    { id: "VA", kind: "segment", role: "arm" }, { id: "arm", kind: arm.startsWith("ray") ? "ray" : arm === "segment" ? "segment" : "line", role: "arm" },
    { id: "mark", kind: "right_angle_mark", role: "right angle" },
  ];
  const constructions = [
    ...points,
    { id: "make_VA", operator: "segment", inputs: { start: "V", end: "A" }, outputs: ["VA"] },
    { id: "make_arm", ...armConstruction, outputs: ["arm"] },
    { id: "make_mark", operator: "right_angle_mark", inputs: { vertex: "V", a: "A", b: "arm" }, outputs: ["mark"] },
  ];
  const visible = ["V", "A", "VA", "arm", "mark"];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "right angle arm" },
    source: { question: "Mark the right angle between VA and the line through V." },
    quantities: [], entities, constructions, relations: [], assertions: [], annotations: [],
    requiredEntityIds: visible, revealGroups: [{ id: "figure", entityIds: visible, dependsOn: [], narrationCue: "figure" }], teachingTimeline: [],
  };
}
function markOutcome(degrees: number, arm: Parameters<typeof rightAngleScene>[1]): { ok: boolean; messages: string[] } {
  const result = replay({ question: "", turnPlan: null, document: rightAngleScene(degrees, arm) });
  return { ok: result.stage === "ok", messages: fatal(result).map((issue) => issue.message) };
}
for (const arm of ["line", "segment", "ray_ahead"] as const) {
  const right = markOutcome(90, arm);
  check(right.ok, `a ${arm} through the vertex at 90° is a right-angle arm: ${right.messages.join(" | ")}`);
  const tilted = markOutcome(80, arm);
  check(!tilted.ok && tilted.messages.some((message) => /perpendicular/.test(message)), `a ${arm} at 80° must stay refused as not perpendicular: ${tilted.messages.join(" | ")}`);
}
{
  const behind = markOutcome(90, "ray_behind");
  check(!behind.ok && behind.messages.some((message) => /angle arm/.test(message)), `a ray that starts past the vertex does not pass through it: ${behind.messages.join(" | ")}`);
  const offset = markOutcome(90, "offset_line");
  check(!offset.ok && offset.messages.some((message) => /angle arm/.test(message)), `a line that misses the vertex is not an arm: ${offset.messages.join(" | ")}`);
}

// ------------------------------------------------------------ river crossing
type Plan = { question: string; givens: Raw[]; derived: Raw[]; unknowns?: Raw[] } & Raw;
function riverPlan(question: string, extras: Array<[string, number, string]>, givens: Array<[string, number, string]>): Plan {
  const quantity = ([symbol, value, unit]: [string, number, string], provenance: string) => ({ id: symbol, symbol, value, unit, provenance });
  return {
    schemaVersion: "turn-plan/v3", subject: "physics", question,
    givens: givens.map((given) => quantity(given, "given")), unknowns: [],
    derived: extras.map((extra) => quantity(extra, "derived")),
    qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  };
}
function riverTime(plan: Plan): { t: unknown; corrections: string[]; codes: string[] } {
  const result = engine.applySourceQuantityAuthority(plan as unknown as TurnPlanV3, null, plan.question);
  const outcome = result.outcomes.find((candidate: { topic: string }) => candidate.topic === "physics|2|relative-velocity-in-a-plane");
  const after = result.plan as unknown as Plan;
  return {
    t: [...after.givens, ...after.derived].find((quantity) => quantity.symbol === "t")?.value,
    corrections: (outcome?.corrections ?? []).map((correction: { symbol: string; corrected: number }) => `${correction.symbol}=${correction.corrected}`),
    codes: outcome?.issueCodes ?? [],
  };
}
const riverPlans = JSON.parse(readFileSync(join(here, "fixtures/river-crossing-heading-plans.json"), "utf8")) as Plan[];
check(riverPlans.length === 2, "two recorded p2c-t2 plans");
for (const [index, plan] of riverPlans.entries()) {
  const result = riverTime(plan);
  check(result.t === 25 && result.corrections.length === 0, `p2c-t2 plan ${index}: heads due north is the least-time crossing; t = 25 s must stand, got ${JSON.stringify(result)}`);
  check(!result.codes.some((code) => /withdrawn|unbound/.test(code)), `p2c-t2 plan ${index}: no value of either crossing is withdrawn: ${result.codes.join(", ")}`);
}
check(engine.riverNormalHeadingStated(riverPlans[0]!.question) && engine.riverShortestPathAsked(riverPlans[0]!.question), "p2c-t2 states the normal heading and asks the straight-across heading");

const RIVER = [["vb", 5, "m/s"], ["vc", 3, "m/s"], ["w", 120, "m"]] as Array<[string, number, string]>;
const STRAIGHT = "A boat can row at 5 m/s in still water. A river 120 m wide flows at 3 m/s. The boatman wants to go straight across to the point directly opposite. Find the time taken to cross.";
const LEAST = "A boat can row at 5 m/s in still water. A river 120 m wide flows at 3 m/s. Find the minimum time to cross the river and the drift.";
const HEADS_ACROSS = "A boat that moves at 5 m/s in still water heads straight across a river 120 m wide that flows at 3 m/s. Find the time to cross and the drift.";
check(riverTime(riverPlan(STRAIGHT, [["t", 24, "s"]], RIVER)).t === 30, "pure straight across: t = w/√(v²−u²) = 30 s");
check(riverTime(riverPlan(LEAST, [["t", 30, "s"]], RIVER)).t === 24, "pure least time: t = w/v = 24 s");
check(riverTime(riverPlan(HEADS_ACROSS, [["t", 30, "s"]], RIVER)).t === 24, "a heading straight across is the least-time crossing: t = 24 s");
for (const [stem, normal] of [
  ["A river flows east at 3 m/s and a boat heads due north at 5 m/s relative to the water.", true],
  ["A river flows east at 3 m/s and a boat heads south at 5 m/s relative to the water.", true],
  ["A river flows east at 3 m/s and a boat heads north-east at 5 m/s relative to the water.", false],
  ["A river flows east at 3 m/s and a boat heads north of west at 5 m/s relative to the water.", false],
  ["A river flows east at 3 m/s and a boat heads due east at 5 m/s relative to the water.", false],
  ["A swimmer swims perpendicular to the current at 2 m/s in a river flowing at 1 m/s.", true],
  ["A swimmer wants to swim straight across a river flowing at 1 m/s; he swims at 2 m/s.", false],
  ["A river 100 m wide flows at 3 m/s. Find the heading to go straight across for a boat of speed 4 m/s.", false],
] as Array<[string, boolean]>) {
  check(engine.riverNormalHeadingStated(stem) === normal, `riverNormalHeadingStated(${JSON.stringify(stem)}) must be ${normal}`);
}
check(engine.riverShortestPathAsked("A swimmer wants to swim straight across a river flowing at 1 m/s."), "a desired path straight across is still the shortest-path case");
check(!engine.riverShortestPathAsked(HEADS_ACROSS), "a heading straight across is not a path request");

// "The point directly across" is a place, and a heading after "to" is an
// intent: neither may turn a straight-across question into the least-time
// crossing (v = 5, u = 3, w = 400: straight across t = 100 s, least time 80 s).
const RIVER_400 = [["vb", 5, "m/s"], ["vc", 3, "m/s"], ["w", 400, "m"]] as Array<[string, number, string]>;
for (const [stem, path, heading, t] of [
  ["A boat moves at 5 m/s in still water. A river 400 m wide flows at 3 m/s. The boat must reach the point directly across the river. Find the time taken to cross.", true, false, 100],
  ["To steer straight across a 400 m wide river flowing at 3 m/s, a boat that moves at 5 m/s in still water must head upstream at what angle? Find the time taken to cross.", true, false, 100],
  ["A boatman wants to head straight across a 400 m wide river flowing at 3 m/s. His boat moves at 5 m/s in still water. Find the time taken to cross.", true, false, 100],
  ["A river 400 m wide flows east at 3 m/s. A man who can swim at 5 m/s in still water wishes to swim due north. In which direction should he head? Find the time taken to cross.", false, false, null],
  ["A river 400 m wide flows east at 3 m/s. A boat which can row at 5 m/s in still water wants to row due north. In which direction should it head? Find the time taken to cross.", false, false, null],
  ["A boat that moves at 5 m/s in still water heads straight across a river 400 m wide that flows at 3 m/s. Find the time to cross.", false, true, 80],
  ["A boat that moves at 5 m/s in still water aims directly across a river 400 m wide that flows at 3 m/s. Find the time to cross.", false, true, 80],
  ["A boat that moves at 5 m/s in still water heads straight across a river 400 m wide that flows at 3 m/s. Will it reach the point directly opposite? Find the time to cross.", true, true, null],
] as Array<[string, boolean, boolean, number | null]>) {
  check(engine.riverShortestPathAsked(stem) === path, `riverShortestPathAsked(${JSON.stringify(stem)}) must be ${path}`);
  check(engine.riverNormalHeadingStated(stem) === heading, `riverNormalHeadingStated(${JSON.stringify(stem)}) must be ${heading}`);
  // One crossing read: the other crossing's t is rewritten to it. Both read:
  // t is unbound, so either crossing's t stands untouched.
  for (const planned of [80, 100]) {
    const result = riverTime(riverPlan(stem, [["t", planned, "s"]], RIVER_400));
    const expected = t === null ? planned : t;
    check(result.t === expected && (t !== null || result.corrections.length === 0), `${JSON.stringify(stem)} with plan t = ${planned}: t must be ${expected} s, got ${JSON.stringify(result)}`);
  }
}

// ------------------------------------------------------------ optional full count
const recordedFlag = process.argv.indexOf("--recorded");
if (recordedFlag >= 0) {
  const all = JSON.parse(readFileSync(process.argv[recordedFlag + 1]!, "utf8")) as Recorded[];
  const stages = all.map((document) => replay(document).stage);
  const count = (stage: Replay["stage"][]) => stages.filter((value) => stage.includes(value)).length;
  console.log(JSON.stringify({ total: all.length, validate: count(["compile", "proof", "ok"]), compile: count(["proof", "ok"]), proof: count(["ok"]) }));
}

console.log(`verify-v3-scene-validity: ${checks} checks passed`);
