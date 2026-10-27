/**
 * #302's review repros, pinned with the full ProblemIR and without one.
 *
 * #302 binds a ProblemIR body name ("parabolic trajectory", "near bank") to a
 * body the certified archetype built. Its review repros were checked with a
 * real ProblemIR only by a one off script; this gate keeps them. Each repro
 * runs every path the live turn can take:
 *
 * - `synthesizeFamilyScene` with the review's ProblemIR and with none;
 * - the fast figure (reconcile with the solver, audit, then
 *   `selectFastVerifiedRepresentation`) with and without ProblemIR;
 * - `selectProductionScene` with `candidateValidation: null` and no fast
 *   figure, and, without ProblemIR, handed the fast path's null authority
 *   figure.
 *
 * Every path asserts exactly its recorded outcome: a decline asserts no
 * figure; a drawing asserts the family, the tier, every label, the
 * perpendicular heading and no α for the river, and the H and R labels
 * against the hand computed values (g = 10: H 5 m, R 34.6 m; g = 1.6: H 31.2 m,
 * R 217 m). Two controls draw with the ProblemIR so its path is really run.
 *
 * Two mutations run on a copy of scene-engine's src (nothing in the worktree
 * is edited), loaded through a temporary tsconfig: switching off "each
 * certified body binds at most once" turns the two rivers row red, and
 * reverting the single letter filler rule lets "projectile A" bind and turns
 * its row red. An unmutated copy runs first and must stay green, so the red
 * rows come from the mutation and not from the copy.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  reconcileTurnPlanV3ExplicitArithmetic,
  reconcileTurnPlanWithSolver,
  synthesizeFamilyScene,
  validateTurnPlanV3,
  verifyTurnPlanAgainstSolver,
  type ProblemIR,
  type SolverResult,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const CHILD = process.env.OBLIGATION_REPROS_CHILD === "1";

type Quantity = TurnPlanV3["givens"][number];
const given = (symbol: string, value: number, unit: string, sourceText = `${symbol} = ${value} ${unit}`): Quantity =>
  ({ id: symbol.replace(/[^a-z0-9_]/gi, "") || "q", symbol, value, unit, provenance: "given", sourceText }) as Quantity;
const derived = (symbol: string, value: number, unit: string): Quantity =>
  ({ id: symbol, symbol, value, unit, provenance: "derived", dependsOn: [], sourceText: `${symbol} = ${value} ${unit}` }) as Quantity;
const plan = (question: string, givens: Quantity[] = [], derivedValues: Quantity[] = [], lawIds: string[] = []): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, givens, unknowns: [], derived: derivedValues,
  qualitativeClaims: [], lawIds, assumptions: [], visualRequirement: "required",
}) as TurnPlanV3;

const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/fast-figure-authority.json"), "utf8")) as {
  cases: Array<{ id: string; question: string; turnPlan: TurnPlanV3; authority: { problemIR: ProblemIR; solverResult: SolverResult } | null }>;
};
const captured = (id: string) => {
  const found = fixture.cases.find((item) => item.id === id);
  assert.ok(found?.authority, `guard: fixture case ${id} with its captured authority`);
  return found as typeof found & { authority: { problemIR: ProblemIR; solverResult: SolverResult } };
};
const symbolic = captured("derive_symbolic");
const omit45 = captured("derive_claims_omit_45");
const riverCase = captured("river_numeric");
const solved: SolverResult = symbolic.authority.solverResult;

/** The captured ProblemIR, asked of a re-stemmed question. */
const restemIR = (ir: ProblemIR, question: string): ProblemIR => ({ ...structuredClone(ir), question } as ProblemIR);
/** Descriptor names: the derive_symbolic bodies under one intent, no facts. */
function descriptorIR(question: string, labels = ["projectile (point mass)", "parabolic trajectory", "level ground"]): ProblemIR {
  const kinds = ["point", "curve", "line"];
  const entities = labels.map((label, index) => ({ id: `e${index}`, kind: kinds[index] ?? "point", label, evidenceFactIds: [] }));
  return {
    schemaVersion: "problem-ir/v1", id: "problem", question, facts: [], entities, expressions: [], constraints: [],
    representationIntents: [{ id: "i0", kind: "graph", entityIds: entities.map((entity) => entity.id), evidenceFactIds: [] }],
    solveRequests: [],
  } as unknown as ProblemIR;
}
/** River bodies boat, river, near bank, far bank, no constraints. */
function riverIR(question: string): ProblemIR {
  const ir = restemIR(riverCase.authority.problemIR, question);
  return { ...ir, constraints: [] } as ProblemIR;
}
/** The river ProblemIR naming a second river region: one drawn river cannot stand for both. */
function twoRiverIR(question: string): ProblemIR {
  const ir = riverIR(question);
  const first = ir.entities.find((entity) => entity.id === "river");
  assert.ok(first, "guard: the captured river ProblemIR names a river");
  return {
    ...ir,
    entities: [...ir.entities, { ...first, id: "river2" }],
    representationIntents: ir.representationIntents.map((intent) =>
      intent.entityIds.includes("river") ? { ...intent, entityIds: [...intent.entityIds, "river2"] } : intent),
  } as ProblemIR;
}

/** One recorded drawing. Labels are the label and dimension texts in render order. */
/** `boatPerp`: the river heading is asserted perpendicular, never straight across, and no α is drawn. */
/** `collinear`: the legacy along-stream arrows vd and vu are vb+vc downstream and vb−vc upstream, to scale with vb and vc. */
interface Figure { tier: string; family: string; labels: string[]; boatPerp?: boolean; tower?: boolean; collinear?: { vb: number; vc: number } }
const RIVER: Figure = { tier: "exact_verified", family: "vector_diagram", labels: ["bank", "bank", "current", "boat", "vb=5 m/s", "vc=3 m/s", "v"], boatPerp: true };
const numericProjectile = (h: string, r: string): Figure => ({
  tier: "exact_verified", family: "contact_body",
  labels: ["level ground", "projectile", "trajectory", "H", "B", "u=20 m/s", "θ=30°", "A", `H=${h} m`, `R=${r} m`],
});
const G10 = numericProjectile("5", "34.6");
const G16 = numericProjectile("31.2", "217");
const G98 = numericProjectile("5.1", "35.3");
const SYMBOLIC: Figure = { tier: "qualitative_verified", family: "contact_body", labels: ["level ground", "projectile", "trajectory", "H", "B", "u", "θ", "A", "H", "R"] };
// Downstream at vb+vc = 8 and upstream at vb−vc = 2, for 5 and 3 m/s (5 + 3 = 8, 5 − 3 = 2).
const ALONG_STREAM_FIG: Figure = { tier: "exact_verified", family: "vector_diagram", labels: ["bank", "bank", "current", "boat", "vb+vc=8", "boat", "vb−vc=2", "vc"] };
// The legacy along-stream sketch, for vb 5 and vc 3: its arrows are checked as vb+vc and vb−vc.
const LEGACY_ALONG_STREAM_FIG: Figure = { tier: "qualitative_verified", family: "vector_diagram", labels: ["bank", "bank", "boat", "vc", "vb", "down", "up"], collinear: { vb: 5, vc: 3 } };
const TOWER_FIG: Figure = { tier: "qualitative_verified", family: "contact_body", labels: ["level ground", "projectile", "h", "trajectory", "H", "B", "u", "θ", "A", "H", "R"], tower: true };

/** The paths one repro runs: three per ProblemIR variant, then four with none. */
const irPaths = (tag: string) => [`family ${tag}`, `production ${tag} fast=null`, `fast ${tag}`];
const NO_IR_PATHS = ["family noIR", "fast noIR", "production noIR fast=null", "production noIR fast=given"];
const isNoIR = (path: string) => path.split(" ")[1] === "noIR";
const isFast = (path: string) => path.startsWith("fast ");
type Expected = (path: string) => Figure | null;
const everywhere = (figure: Figure | null): Expected => () => figure;
/** ProblemIR refuses on every ProblemIR path; the no ProblemIR paths draw. */
const refusedWithIR = (noIR: Figure, fastNoIR: Figure | null = noIR): Expected => (path) =>
  !isNoIR(path) ? null : isFast(path) ? fastNoIR : noIR;
/** A numeric projectile: every family and production path draws it, the fast path declines. */
const numericOnly = (figure: Figure): Expected => (path) => isFast(path) ? null : figure;

/** Launch speed, angle above the horizontal, and g for each numeric projectile figure, to check H and R by hand. */
const LAUNCH = new Map<Figure, { u: number; degrees: number; g: number }>([
  [G10, { u: 20, degrees: 30, g: 10 }],
  [G16, { u: 20, degrees: 30, g: 1.6 }],
  [G98, { u: 20, degrees: 30, g: 9.8 }],
]);

/** `irs`: the ProblemIR variants, by tag. `audit` pins the solver audit of a single "IR" variant. */
interface Repro { name: string; question: string; turnPlan: TurnPlanV3; irs: Array<{ tag: string; ir: ProblemIR }>; audit?: string; expected: Expected }

const RIVER_GIVENS = [given("v_b", 5, "m/s", "5 m/s in still water"), given("w", 100, "m", "100 m wide"), given("v_r", 3, "m/s", "flowing at 3 m/s")];
const POINTED = "A boat moves at 5 m/s in still water. It crosses a 100 m wide river flowing at 3 m/s, keeping his boat pointed straight across. Where does he land?";
const SLOW = "A boat moves at 3 m/s in still water. It crosses a 100 m wide river flowing at 5 m/s. Find the minimum drift.";
const VERTICAL = "A ball is projected at 20 m/s at 30 degrees with the vertical from level ground. Find the time of flight. Take g = 10 m/s^2.";
const G10_STEM = "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. Find the time of flight. Take g = 10 m/s^2.";
const G16_STEM = G10_STEM.replace("g = 10", "g = 1.6");
const restem = (question: string, from: string, to: string) => {
  assert.ok(question.includes(from), `guard: the captured stem contains "${from}"`);
  return question.replace(from, to);
};
const LEVEL_THETA = "at angle theta on level ground";
const THETA_V = restem(symbolic.question, LEVEL_THETA, "at angle theta to the vertical on level ground");
const ALPHA_V = restem(symbolic.question, LEVEL_THETA, "at angle alpha with the vertical on level ground");
const OMIT_V = restem(omit45.question, LEVEL_THETA, "at angle theta to the vertical on level ground");
const TOWER = restem(symbolic.question, LEVEL_THETA, "at angle theta from the top of a tower of height h");
const LEVEL = "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. Find the range.";
const TWO = "Projectile A is launched at 20 m/s at 30 degrees above the horizontal and projectile B at 20 m/s at 60 degrees above the horizontal from level ground. Find each range.";
const riverPlan = (question: string, derivedValues: Quantity[] = []) => plan(question, RIVER_GIVENS, derivedValues);
const launchPlan = (question: string, angleText: string, g: number | null, time: number | null) => plan(question,
  [given("u", 20, "m/s", "20 m/s"), given("θ", 30, "°", angleText), ...(g === null ? [] : [given("g", g, "m/s^2", g === 10 ? "Take g = 10 m/s^2" : `g = ${g} m/s^2`)])],
  time === null ? [] : [derived("T", time, "s")]);

const TWO_RIVERS = "river: two rivers in the ProblemIR, one drawn river";
const PROJECTILE_A = "projectile A (single letter body) on the symbolic stem";

const repros: Repro[] = [
  { name: "river: heading perpendicular to the banks", question: riverCase.question, turnPlan: riverPlan(riverCase.question, [derived("t", 20, "s"), derived("d", 60, "m")]), irs: [{ tag: "IR", ir: riverIR(riverCase.question) }], audit: "incomplete", expected: everywhere(RIVER) },
  { name: "river: pointed straight across", question: POINTED, turnPlan: riverPlan(POINTED), irs: [{ tag: "IR", ir: riverIR(POINTED) }], audit: "incomplete", expected: everywhere(RIVER) },
  { name: "river: vb 3 < vc 5, minimum drift", question: SLOW, turnPlan: plan(SLOW, [given("v_b", 3, "m/s", "3 m/s in still water"), given("w", 100, "m", "100 m wide"), given("v_r", 5, "m/s", "flowing at 5 m/s")]), irs: [{ tag: "IR", ir: riverIR(SLOW) }], audit: "incomplete", expected: everywhere(null) },
  { name: "projectile: theta to the vertical (symbolic)", question: THETA_V, turnPlan: { ...symbolic.turnPlan, question: THETA_V }, irs: [{ tag: "IR", ir: restemIR(symbolic.authority.problemIR, THETA_V) }], audit: "not_applicable", expected: everywhere(null) },
  { name: "projectile: alpha with the vertical (symbolic)", question: ALPHA_V, turnPlan: { ...symbolic.turnPlan, question: ALPHA_V }, irs: [{ tag: "IR", ir: restemIR(symbolic.authority.problemIR, ALPHA_V) }], audit: "incomplete", expected: everywhere(null) },
  { name: "projectile: claims_omit_45, theta to the vertical", question: OMIT_V, turnPlan: { ...omit45.turnPlan, question: OMIT_V }, irs: [{ tag: "IR", ir: restemIR(omit45.authority.problemIR, OMIT_V) }], audit: "not_applicable", expected: everywhere(null) },
  { name: "projectile: 30 degrees with the vertical, u=20, g=10", question: VERTICAL, turnPlan: launchPlan(VERTICAL, "30 degrees with the vertical", 10, 3.464), irs: [{ tag: "IR", ir: descriptorIR(VERTICAL) }], audit: "incomplete", expected: everywhere(null) },
  { name: "projectile: Take g = 10", question: G10_STEM, turnPlan: launchPlan(G10_STEM, "30 degrees", 10, 2), irs: [{ tag: "IR", ir: descriptorIR(G10_STEM) }], audit: "incomplete", expected: numericOnly(G10) },
  { name: "projectile: g = 1.6", question: G16_STEM, turnPlan: launchPlan(G16_STEM, "30 degrees", 1.6, 12.5), irs: [{ tag: "IR", ir: descriptorIR(G16_STEM) }], audit: "incomplete", expected: numericOnly(G16) },
  { name: "projectile: from the top of a tower of height h", question: TOWER, turnPlan: { ...symbolic.turnPlan, question: TOWER }, irs: [{ tag: "IR", ir: restemIR(symbolic.authority.problemIR, TOWER) }], audit: "incomplete", expected: everywhere(TOWER_FIG) },
  { name: PROJECTILE_A, question: symbolic.question, turnPlan: symbolic.turnPlan, irs: [{ tag: "IR", ir: descriptorIR(symbolic.question, ["projectile A", "parabolic trajectory", "level ground"]) }], audit: "incomplete", expected: refusedWithIR(SYMBOLIC) },
  { name: "projectile A and B, two launches", question: TWO, turnPlan: plan(TWO, [given("u", 20, "m/s", "20 m/s"), given("θ_A", 30, "°", "30 degrees"), given("θ_B", 60, "°", "60 degrees")]), irs: [{ tag: "IR", ir: descriptorIR(TWO, ["projectile A", "projectile B", "level ground"]) }], audit: "incomplete", expected: refusedWithIR(G98, null) },
  // Added with this gate: the at most once rule's own row, on the live river path.
  { name: TWO_RIVERS, question: riverCase.question, turnPlan: riverPlan(riverCase.question, [derived("t", 20, "s"), derived("d", 60, "m")]), irs: [{ tag: "IR", ir: twoRiverIR(riverCase.question) }], audit: "incomplete", expected: refusedWithIR(RIVER) },
  // Controls: the ProblemIR path draws, so the refusals above are its own.
  { name: "control: captured derive_symbolic", question: symbolic.question, turnPlan: symbolic.turnPlan, irs: [{ tag: "IR", ir: symbolic.authority.problemIR }], audit: "not_applicable", expected: everywhere(SYMBOLIC) },
  { name: "control: 30 degrees above the horizontal, no g", question: LEVEL, turnPlan: launchPlan(LEVEL, "30 degrees", null, null), irs: [{ tag: "IR", ir: descriptorIR(LEVEL) }], audit: "incomplete", expected: numericOnly(G98) },
];

/*
 * Fix rows (added with #302's follow up). Each ran red on origin/main at 99ae9a071, where #302
 * carried a question-only misread onto ProblemIR turns. Each runs with the captured live river
 * ProblemIR (boat, river, near bank, far bank), the projectile descriptor names, and none.
 */
const FIX_IRS = (question: string) => [{ tag: "riverIR", ir: riverIR(question) }, { tag: "descriptorIR", ir: descriptorIR(question) }];
const crossingPlan = (question: string, vb: number, vc: number) =>
  plan(question, [given("v_b", vb, "m/s", `${vb} m/s`), given("v_r", vc, "m/s", `${vc} m/s`)]);

// A crossing stem that never says cross, wide river or heading drew the along-stream picture
// (vb+vc, vb−vc) at exact_verified. The true picture is a crossing; these decline.
const CROSSING_STEMS: Array<[string, number, number]> = [
  ["A river 100 m wide flows at 3 m/s. A boat with speed 5 m/s in still water wants to reach the point directly opposite. Find the direction in which it should be steered.", 5, 3],
  ["A river is 100 m wide and flows at 3 m/s. A boat can travel at 5 m/s in still water. What is the minimum time to reach the other bank?", 5, 3],
  ["A river is 100 m wide and flows at 3 m/s. A boat can travel at 5 m/s in still water. What is the minimum time to reach the opposite bank, and how far downstream does it land?", 5, 3],
  ["A man rows a boat at 4 m/s perpendicular to the banks of a river 80 m wide. The river flows at 2 m/s. Where does he land?", 4, 2],
  ["A boat is rowed at 4 m/s at right angles to the current of a river 80 m wide flowing at 2 m/s. Find the drift.", 4, 2],
  ["A river flows at 3 m/s. A boat can travel at 5 m/s in still water. It is steered perpendicular to the flow. Find its resultant velocity.", 5, 3],
  ["A boat travels at 5 m/s relative to the water in a river flowing at 3 m/s. It points straight towards the opposite bank 100 m away. Find the time taken and the drift.", 5, 3],
  ["A boat can move at 5 m/s in still water. The river flows at 3 m/s. Find the resultant speed when it heads at right angles to the flow.", 5, 3],
];
// A horizontal launch into a pit or onto lower ground drew the landing on level ground at the
// foot of the tower. The drop below the base is unread, so these decline.
const PIT_STEMS = [
  "A ball is thrown horizontally from the top of a 20 m tower into a pit 5 m deep. Find where it lands.",
  "A stone is thrown horizontally from the top of a 20 m tower. It lands 5 m below the base. Find the range.",
  "A stone is thrown horizontally from a 10 m tower into a pit 5 m deep. Find the range.",
  "A stone is thrown horizontally from a 20 m tower into a pit 5 m deep. Find where it lands.",
  "A stone is thrown horizontally from a tower into a pit 5 m deep. Find the range.",
  "A stone is thrown horizontally from a 10 m high wall into a 5 m deep pit. Find where it lands.",
  "A stone is thrown horizontally from the top of a 20 m tower and lands 5 m below the base. Find where it lands.",
  "A stone is thrown horizontally from the top of a 20 m tower. It lands in a pit 5 m deep. Find the range.",
];
const ALONG_STREAM = "A boat's speed in still water is 5 m/s and the river flows at 3 m/s. Find the time to go 100 m downstream and return.";
const ALONG_STREAM_ROW = "fix along stream: the live river ProblemIR keeps main's refusal";
const PROJECTILE_A_MASS = "fix filler: projectile a (point mass) is a named body";

const fixRows: Repro[] = [
  ...CROSSING_STEMS.flatMap(([question, vb, vc], index) => [
    { name: `fix crossing ${index + 1}: ${question}`, question, turnPlan: plan(question), irs: FIX_IRS(question), expected: everywhere(null) },
    { name: `fix crossing ${index + 1} with vb and vc planned`, question, turnPlan: crossingPlan(question, vb, vc), irs: FIX_IRS(question), expected: everywhere(null) },
  ]),
  ...PIT_STEMS.map((question, index) => ({ name: `fix pit ${index + 1}: ${question}`, question, turnPlan: plan(question), irs: FIX_IRS(question), expected: everywhere(null) })),
  // Stated downstream motion: the along-stream picture draws with no ProblemIR, as on main, and
  // binds no model-word body name (main's exact-label rule), so the live river ProblemIR refuses.
  { name: ALONG_STREAM_ROW, question: ALONG_STREAM, turnPlan: crossingPlan(ALONG_STREAM, 5, 3), irs: [{ tag: "riverIR", ir: riverIR(ALONG_STREAM) }], expected: refusedWithIR(ALONG_STREAM_FIG) },
  { name: PROJECTILE_A_MASS, question: symbolic.question, turnPlan: symbolic.turnPlan, irs: [{ tag: "IR", ir: descriptorIR(symbolic.question, ["projectile a (point mass)", "parabolic trajectory", "level ground"]) }], audit: "incomplete", expected: refusedWithIR(SYMBOLIC) },
];
repros.push(...fixRows);
const CROSSING_ROWS = fixRows.filter((row) => row.name.startsWith("fix crossing")).map((row) => row.name);
const PIT_ROWS = fixRows.filter((row) => row.name.startsWith("fix pit")).map((row) => row.name);

/*
 * Along-stream evidence rows (#316's review follow up). The along-stream picture draws only on
 * positive evidence: along-stream wording and no other geometry. Each decline row drew the
 * along-stream picture on origin/main at 60cc40dda on the no ProblemIR paths. Each runs with the
 * captured river ProblemIR with and without its constraints, and none.
 */
const RIVER_IRS = (question: string) => [{ tag: "riverIR", ir: riverIR(question) }, { tag: "riverIRc", ir: restemIR(riverCase.authority.problemIR, question) }];
// Crossing stems in words #316's crossing list did not know: far bank or side, normal to,
// compass headings, aim, an angle in degrees. Rows 1 and 3 say "in still water", so the speed
// reader owns their speeds and only the geometry rule declines them.
const OTHER_GEOMETRY_STEMS: Array<[string, number, number]> = [
  ["A boat rows at 4 m/s in still water normal to the current of a river flowing at 2 m/s. How long does it take to reach the far bank, and how far downstream does it land?", 4, 2],
  ["A boat moves at 5 m/s in still water, pointing north, while the river flows east at 3 m/s. How far downstream does it land?", 5, 3],
  ["A boat rows at 4 m/s in still water normal to the current, which flows at 3 m/s. How far downstream does it go?", 4, 3],
  ["A swimmer swims at 2 m/s in still water in a river flowing at 1 m/s. He reaches the far side. How far downstream is he carried?", 2, 1],
  ["A boat sails north at 5 m/s relative to the water. The river flows east at 3 m/s. How far downstream does it travel in 20 s?", 5, 3],
  ["A boatman aims his boat at the far shore, rowing at 4 m/s in still water. The river flows at 3 m/s. How far downstream does he land?", 4, 3],
  ["A boat moves at 5 m/s in still water at 60 degrees to the current, which flows at 3 m/s. How far downstream does it move in 10 s?", 5, 3],
];
// A length that is not a distance travelled along the stream: a drift.
const OFF_STREAM_LENGTH_STEMS: Array<[string, number, number]> = [
  ["A boat moving at 5 m/s in still water is carried 30 m downstream by a river flowing at 3 m/s. Find its resultant speed.", 5, 3],
];
// A speed over the ground, stated beside along-stream wording, is not the boat's speed in still
// water: read as vb it draws vb+vc = 10 for a boat whose ground speed is 8. The second and third
// stems say "down the river", which is no along-stream evidence (as on origin/main), so they also
// decline for want of evidence.
const GROUND_SPEED_STEMS: Array<[string, number, number] | [string]> = [
  ["A boat goes downstream at 8 m/s. The river flows at 2 m/s. Find the speed of the boat in still water.", 8, 2],
  ["A boat moves at 8 m/s down the river, which flows at 2 m/s. Find its speed in still water.", 8, 2],
  // Greptile on #319: five words between the direction and the speed. The first is refused by the
  // speed reader too; the second binds vb = 8 and drew vb+vc = 10 under a four word window.
  ["A boat moves down the river at a steady speed of 8 m/s. The river flows at 2 m/s. Find its speed in still water.", 8, 2],
  ["A boat goes downstream and the boat moves at 8 m/s. The river flows at 2 m/s. Find its speed in still water.", 8, 2],
];
// A speed a still-water qualifier names is the boat's own, beside along-stream wording or not:
// these draw downstream at vb+vc = 8 and upstream at vb−vc = 2 (Greptile on #319).
const STILL_WATER_STEMS = [
  "A boat rows upstream at 5 m/s in still water. The river flows at 3 m/s. Find its downstream speed.",
];
// The two phrases an earlier round of #319 widened the evidence with, "down the river" and "up the
// stream". Read as evidence they drew the along-stream picture for crossing drift questions ("how
// far does it go down the river" to a jetty ahead) over three review rounds, so the widening is cut
// and these right figures are the accepted cost: they decline everywhere, as on origin/main.
const WIDENED_STEMS = [
  "A boat's speed in still water is 5 m/s and the river flows at 3 m/s. Find its speed down the river and up the stream.",
  "A boat's speed in still water is 5 m/s and the river flows at 3 m/s. Find the time to go 100 m down the river and return.",
  "A swimmer swims at 5 m/s in still water in a river flowing at 3 m/s. How fast does he move up the stream, and how fast down the river?",
];
/*
 * #319's review (classes A to E). Each drew a wrong figure on ca5512eca on the no ProblemIR paths.
 * A: a crossing drift asked in the widened wording ("how far down the river does it land").
 */
const DRIFT_DOWN_THE_RIVER_STEMS: Array<[string, number, number]> = [
  ["A boat rows at 5 m/s in still water in a river flowing at 3 m/s. How far down the river does it land?", 5, 3],
  ["A boat sets off at 5 m/s in still water. The river flows at 3 m/s. How far down the river does it land?", 5, 3],
  ["A boat sets off at 5 m/s in still water for the jetty facing it. The river flows at 3 m/s. How far down the river does it land?", 5, 3],
];
// B: the swimmer stem's speeds under plan symbols the legacy sketch does not alias drew its stock
// 5:2 arrows, where the stem gives 5:3. With the widening cut this stem has no evidence at all, so
// the withhold's own mutation puts the widening back to reach the sketch. (In origin/main's words,
// "move upstream, and how fast downstream", the archetype draws the right 8 and 2 before the sketch.)
const SWIMMER = WIDENED_STEMS[2]!;
const UNSOURCED_SKETCH_PLANS: Array<[string, TurnPlanV3]> = [
  ["no givens", plan(SWIMMER)],
  ["v_s and v_w", plan(SWIMMER, [given("v_s", 5, "m/s", "5 m/s in still water"), given("v_w", 3, "m/s", "flowing at 3 m/s")])],
  ["u and v", plan(SWIMMER, [given("u", 5, "m/s", "5 m/s in still water"), given("v", 3, "m/s", "flowing at 3 m/s")])],
];
// C: a ground speed in a sentence with no along-stream wording drew vb+vc = 10 for a ground speed of 8.
const SPLIT_GROUND_SPEED_STEMS: Array<[string, number, number]> = [
  ["A boat goes downstream. Its speed is 8 m/s. The river flows at 2 m/s. Find the speed of the boat in still water.", 8, 2],
  ["A boat moves at 8 m/s. It goes downstream in a river flowing at 2 m/s. Find its speed in still water.", 8, 2],
  ["A boat goes downstream. The boat moves at 8 m/s and the river flows at 2 m/s. Find the speed in still water.", 8, 2],
];
// D: a boat slower than the current heading upstream drew a forward arrow labelled vb−vc=-1.
const SLOW_BOAT = "A boat with speed 2 m/s in still water tries to go upstream in a river flowing at 3 m/s. What happens?";
// E: crossing wording still missing from the geometry list: a dock facing it, a far edge, an
// island in front, a nose square to the flow, due north, and a landing place.
const CROSSING_WORDING_STEMS: Array<[string, number, number]> = [
  ["A boat with speed 5 m/s in still water sets off for the dock facing it in a river flowing at 3 m/s. How far downstream does it land?", 5, 3],
  ["A ferry leaves the jetty at 5 m/s in still water for the landing stage on the far edge of a river flowing at 3 m/s. How far downstream does it arrive?", 5, 3],
  ["A girl swims at 2 m/s in still water to an island directly in front of her in a river flowing at 1 m/s. How far downstream does she end up?", 2, 1],
  ["A boat moving at 5 m/s in still water keeps its nose square to the flow of a river flowing at 3 m/s. How far downstream does it land?", 5, 3],
  ["A boat moves at 5 m/s in still water due N in a river flowing at 3 m/s due E. How far downstream does it land?", 5, 3],
  ["A boat sets off at 5 m/s in still water. The river flows at 3 m/s. How far downstream does it land?", 5, 3],
];
// Greptile on #319 (round 2): a drift asked along the stream ("how far down the river is it
// swept") is no statement of the boat's motion along it; it drew vb+vc = 8 and vb−vc = 2.
const SWEPT_DRIFT_STEMS: Array<[string, number, number]> = [
  ["A boat rows at 5 m/s in still water towards a pier directly ahead while the river flows at 3 m/s. How far down the river is it swept in 10 s?", 5, 3],
  ["A boat rows at 5 m/s in still water towards a pier directly ahead while the river flows at 3 m/s. How far downstream is it swept in 10 s?", 5, 3],
  ["A boat rows at 5 m/s in still water towards a pier while the river flows at 3 m/s. Find the distance it is swept downstream in 10 s.", 5, 3],
];
/*
 * #319's delta review (round 3): a crossing drift asked as "how far does it go / move / travel /
 * swim down the river" for a boat or swimmer making for a pier, jetty or friend straight ahead.
 * Each drew the along-stream picture on 5c0541ea3 (the widened evidence plus a travel verb), where
 * origin/main declines. Both the cut and the "how far" rule decline them.
 */
const HOW_FAR_DOWN_THE_RIVER_STEMS: Array<[string, number, number]> = [
  ["A boat rows at 5 m/s in still water towards a pier directly ahead while the river flows at 3 m/s. How far does it go down the river in 10 s?", 5, 3],
  ["A boat with speed 5 m/s in still water sets off to reach the jetty directly ahead in a river flowing at 3 m/s. How far does it move down the river?", 5, 3],
  ["A boat with speed 5 m/s in still water sets out for the far jetty in a river flowing at 3 m/s. How far does it go down the river?", 5, 3],
  ["A boat with speed 5 m/s in still water makes for the jetty that faces it in a river flowing at 3 m/s. How far does it move down the river?", 5, 3],
  ["A boat with speed 5 m/s in still water goes straight out into a river flowing at 3 m/s. How far does it move down the river in 10 s?", 5, 3],
  ["A boat with speed 5 m/s in still water is swept by a river flowing at 3 m/s as it goes over to the jetty. How far does it go down the river?", 5, 3],
  ["A swimmer swims at 2 m/s in still water toward the jetty straight ahead in a river flowing at 1 m/s. How far does she travel down the river in 20 s?", 2, 1],
  ["A swimmer swims at 2 m/s in still water to get to her friend directly ahead in a river flowing at 1 m/s. How far does she swim down the river?", 2, 1],
  // Ambiguous in the review (a jetty reached at the end of a trip along the river, or a crossing); declined.
  ["A boat rows at 5 m/s in still water in a river flowing at 3 m/s. How far does it travel down the river before it reaches the jetty?", 5, 3],
];
// The same drift questions spelled "downstream": each drew the along-stream picture on origin/main
// and on 5c0541ea3 (a travel verb right before "downstream"). Only the "how far" rule declines them.
const HOW_FAR_DOWNSTREAM_STEMS: Array<[string, number, number]> = [
  ["A boat rows at 5 m/s in still water towards a pier directly ahead while the river flows at 3 m/s. How far does it go downstream in 10 s?", 5, 3],
  ["A boat with speed 5 m/s in still water sets off to reach the jetty directly ahead in a river flowing at 3 m/s. How far does it move downstream?", 5, 3],
  ["A swimmer swims at 2 m/s in still water toward the jetty straight ahead in a river flowing at 1 m/s. How far does she travel downstream in 20 s?", 2, 1],
  ["A boat with speed 5 m/s in still water makes for the pier in line with it in a river flowing at 3 m/s. How far does it move downstream?", 5, 3],
  ["A boat with speed 5 m/s in still water sets out for the jetty dead ahead in a river flowing at 3 m/s. How far does it travel downstream on the way?", 5, 3],
  ["A boat with speed 5 m/s in still water goes towards the jetty over the water in a river flowing at 3 m/s. How far does it go downstream?", 5, 3],
  ["A boat with speed 5 m/s in still water is in a river flowing at 3 m/s. How far does it go downstream by the time it arrives at the jetty?", 5, 3],
  // Ambiguous in the review (a jetty reached at the end of a trip along the river, or a crossing); declined.
  ["A boat rows at 5 m/s in still water in a river flowing at 3 m/s. How far does it travel downstream before it reaches the jetty?", 5, 3],
];
// A boat exactly as fast as the current, heading upstream, stays put: main drew a forward arrow labelled vb−vc=0.
const EQUAL_BOAT = "A boat with speed 3 m/s in still water goes upstream in a river flowing at 3 m/s.";
const declineRows = (tag: string, stems: Array<[string, number, number] | [string]>): Repro[] => stems.flatMap(([question, vb, vc], index) => [
  { name: `${tag} ${index + 1}: ${question}`, question, turnPlan: plan(question), irs: RIVER_IRS(question), expected: everywhere(null) },
  ...(vb === undefined || vc === undefined ? [] : [
    { name: `${tag} ${index + 1} with vb and vc planned`, question, turnPlan: crossingPlan(question, vb, vc), irs: RIVER_IRS(question), expected: everywhere(null) }]),
]);
const evidenceRows: Repro[] = [
  ...declineRows("evidence other geometry", OTHER_GEOMETRY_STEMS),
  ...declineRows("evidence off stream length", OFF_STREAM_LENGTH_STEMS),
  ...declineRows("evidence ground speed", GROUND_SPEED_STEMS),
  ...declineRows("evidence drift down the river", DRIFT_DOWN_THE_RIVER_STEMS),
  ...UNSOURCED_SKETCH_PLANS.map(([tag, turnPlan], index) => ({ name: `evidence unsourced sketch ${index + 1}: swimmer, ${tag}`, question: SWIMMER, turnPlan, irs: RIVER_IRS(SWIMMER), expected: everywhere(null) })),
  ...declineRows("evidence split ground speed", SPLIT_GROUND_SPEED_STEMS),
  { name: `evidence slow boat 1: ${SLOW_BOAT}`, question: SLOW_BOAT, turnPlan: plan(SLOW_BOAT), irs: RIVER_IRS(SLOW_BOAT), expected: everywhere(null) },
  // With vb and vc planned the legacy sketch draws it: its "up" arrow runs vc − vb = 1 downstream.
  { name: "evidence slow boat 1 with vb and vc planned", question: SLOW_BOAT, turnPlan: crossingPlan(SLOW_BOAT, 2, 3), irs: RIVER_IRS(SLOW_BOAT), expected: refusedWithIR({ ...LEGACY_ALONG_STREAM_FIG, collinear: { vb: 2, vc: 3 } }, null) },
  ...declineRows("evidence crossing wording", CROSSING_WORDING_STEMS),
  ...declineRows("evidence swept drift", SWEPT_DRIFT_STEMS),
  ...declineRows("evidence how far down the river", HOW_FAR_DOWN_THE_RIVER_STEMS),
  ...declineRows("evidence how far downstream", HOW_FAR_DOWNSTREAM_STEMS),
  { name: `evidence equal boat 1: ${EQUAL_BOAT}`, question: EQUAL_BOAT, turnPlan: plan(EQUAL_BOAT), irs: RIVER_IRS(EQUAL_BOAT), expected: everywhere(null) },
  // Drawn with no ProblemIR; the live river ProblemIR keeps main's refusal, as for "downstream".
  // The swimmer stem is the legacy sketch's alone: the fast path declines it.
  ...STILL_WATER_STEMS.map((question, index) => ({ name: `evidence still water ${index + 1}: ${question}`, question, turnPlan: crossingPlan(question, 5, 3), irs: RIVER_IRS(question), expected: refusedWithIR(ALONG_STREAM_FIG) })),
  // The cut widening: declined everywhere with vb and vc planned, as on origin/main.
  ...WIDENED_STEMS.map((question, index) => ({
    name: `evidence widened ${index + 1}: ${question}`, question, turnPlan: crossingPlan(question, 5, 3), irs: RIVER_IRS(question), expected: everywhere(null),
  })),
];
repros.push(...evidenceRows);
const evidenceNames = (tag: string) => evidenceRows.filter((row) => row.name.startsWith(`evidence ${tag}`)).map((row) => row.name);
const OTHER_GEOMETRY_ROWS = evidenceNames("other geometry");
const OFF_STREAM_LENGTH_ROWS = evidenceNames("off stream length");
const GROUND_SPEED_ROWS = evidenceNames("ground speed");
const WIDENED_ROWS = evidenceNames("widened");
const STILL_WATER_ROWS = evidenceNames("still water");
const DRIFT_DOWN_THE_RIVER_ROWS = evidenceNames("drift down the river");
const UNSOURCED_SKETCH_ROWS = evidenceNames("unsourced sketch");
const SPLIT_GROUND_SPEED_ROWS = evidenceNames("split ground speed");
const SLOW_BOAT_ROWS = evidenceNames("slow boat");
const CROSSING_WORDING_ROWS = evidenceNames("crossing wording");
const SWEPT_DRIFT_ROWS = evidenceNames("swept drift");
const HOW_FAR_DOWN_THE_RIVER_ROWS = evidenceNames("how far down the river");
const HOW_FAR_DOWNSTREAM_ROWS = evidenceNames("how far downstream");
const EQUAL_BOAT_ROWS = evidenceNames("equal boat");
// The review's wording rows the geometry list declines: a landing place, facing, front, edge, square, island, due.
const NEW_GEOMETRY_ROWS = [...DRIFT_DOWN_THE_RIVER_ROWS, ...CROSSING_WORDING_ROWS];
// The ground speed rows that draw without the rule: Greptile's own stem (3) the speed reader refuses too.
const GROUND_SPEED_DRAWN_ROWS = GROUND_SPEED_ROWS.filter((name) => !name.startsWith("evidence ground speed 3"));
// The swimmer drift rows (7 and 8) with no plan never reached a figure, even on 5c0541ea3.
const HOW_FAR_DOWN_THE_RIVER_DRAWN_ROWS = HOW_FAR_DOWN_THE_RIVER_ROWS.filter((name) => !/^evidence how far down the river [78]:/.test(name));
// Every other decline row draws the along-stream picture with no evidence check at all.
const ALONG_STREAM_CALL_ROWS = [...OTHER_GEOMETRY_ROWS, ...OFF_STREAM_LENGTH_ROWS, ...GROUND_SPEED_DRAWN_ROWS, ...DRIFT_DOWN_THE_RIVER_ROWS, ...SPLIT_GROUND_SPEED_ROWS, ...CROSSING_WORDING_ROWS, ...SWEPT_DRIFT_ROWS,
  ...HOW_FAR_DOWN_THE_RIVER_DRAWN_ROWS, ...HOW_FAR_DOWNSTREAM_ROWS, ...WIDENED_ROWS];
/*
 * Under ANY_ALONG_STREAM (bare main evidence words, no motion and no "how far" rule) a row that says
 * "down the river" has no evidence at all, so it stays declined: the drift down the river rows, swept
 * drift 1 and ground speed 2 and 3. The "how far downstream" drift rows, which only the "how far"
 * rule declines, go red with every such mutation.
 */
const DOWNSTREAM_SPELLED = (name: string) => !/^evidence (?:drift down the river|swept drift 1|ground speed [23])\b/.test(name);
const MAIN_WORDS = (rows: string[]) => rows.filter(DOWNSTREAM_SPELLED);

type Primitive = { kind: string; id?: string; text?: string; points?: ReadonlyArray<{ x: number; y: number }> };
type Drawn = { tier: string; family?: string; renderScene: { primitives: ReadonlyArray<Primitive> }; document?: unknown; sceneDocument?: unknown } | null | undefined;
/** `run`: each drawn vector's signed horizontal run on the board, by primitive id. */
interface Shown { tier: string; family?: string; labels: string[]; ids: string[]; assertions: string[]; run: Record<string, number> }
const show = (figure: Drawn): Shown | null => {
  if (!figure) return null;
  const document = (figure.sceneDocument ?? figure.document) as { entities: Array<{ id: string }>; assertions: Array<{ id: string }> } | undefined;
  const labels = figure.renderScene.primitives.flatMap((primitive) =>
    (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text ? [primitive.text] : []);
  const run = Object.fromEntries(figure.renderScene.primitives.flatMap((primitive) =>
    primitive.kind === "vector" && primitive.id && primitive.points?.length === 2 ? [[primitive.id, primitive.points[1]!.x - primitive.points[0]!.x]] : []));
  return { tier: figure.tier, family: figure.family, labels, ids: document?.entities.map((entity) => entity.id) ?? [], assertions: document?.assertions.map((row) => row.id) ?? [], run };
};
const fmt = (shown: Shown | null) => shown ? `${shown.tier}/${shown.family ?? "?"} [${shown.labels.join(", ")}]` : "none";

/** Problems with one path's outcome against its recorded outcome; empty when it holds. */
function mismatches(shown: Shown | null, expected: Figure | null): string[] {
  if (!expected) return shown ? [`declines, but drew ${fmt(shown)}`] : [];
  if (!shown) return [`draws ${expected.tier}/${expected.family}, but declined`];
  const problems: string[] = [];
  if (shown.tier !== expected.tier) problems.push(`tier ${shown.tier}, recorded ${expected.tier}`);
  if (shown.family !== expected.family) problems.push(`family ${shown.family}, recorded ${expected.family}`);
  if (JSON.stringify(shown.labels) !== JSON.stringify(expected.labels)) problems.push(`labels [${shown.labels.join(", ")}], recorded [${expected.labels.join(", ")}]`);
  if (shown.ids.includes("tower") !== Boolean(expected.tower)) problems.push(expected.tower ? "no tower drawn" : "a tower drawn");
  if (expected.boatPerp) {
    if (!shown.assertions.includes("boat_perp")) problems.push("the heading is not asserted perpendicular (boat_perp)");
    if (shown.assertions.includes("straight_across")) problems.push("the resultant is asserted straight across");
    if (shown.labels.some((label) => label.includes("α"))) problems.push("an α is drawn on the river");
  }
  if (expected.collinear) {
    const { vb, vc } = expected.collinear;
    const boat = shown.run.primitive_vb;
    const want: Record<string, number> = { primitive_vc: vc / vb, primitive_vd: (vb + vc) / vb, primitive_vu: -(vb - vc) / vb };
    if (!boat || boat <= 0) problems.push("no vb arrow pointing downstream");
    else for (const [id, ratio] of Object.entries(want)) {
      const drawn = (shown.run[id] ?? Number.NaN) / boat;
      if (!(Math.abs(drawn - ratio) <= 0.01)) problems.push(`${id} runs ${drawn.toFixed(3)} vb, recorded ${ratio.toFixed(3)} vb`);
    }
  }
  return problems;
}

/** The H and R labels a numeric projectile figure carries must be the hand computed values to 3 s.f. */
function checkLaunchNumbers(figure: Figure): void {
  const launch = LAUNCH.get(figure);
  if (!launch) return;
  const radians = (launch.degrees * Math.PI) / 180;
  const truth = {
    H: (launch.u ** 2 * Math.sin(radians) ** 2) / (2 * launch.g),
    R: (launch.u ** 2 * Math.sin(2 * radians)) / launch.g,
  };
  for (const [symbol, value] of Object.entries(truth)) {
    const label = figure.labels.find((text) => text.startsWith(`${symbol}=`));
    assert.ok(label, `guard: the recorded figure labels ${symbol}`);
    const drawn = Number(label.slice(symbol.length + 1).replace(/\s*m$/, ""));
    // 3 s.f.: 31.25 is 31.2499... in floating point, so the board's 31.2 is the rounded value.
    assert.ok(Math.abs(drawn - value) <= 0.005 * Math.abs(value) + 1e-9,
      `hand check: ${symbol} = ${value.toFixed(3)} m for u=${launch.u}, ${launch.degrees}°, g=${launch.g}, recorded ${label}`);
  }
}

interface RowResult { name: string; red: string[]; cells: ReadonlyArray<readonly [string, string]>; audit: string }

function runRepro(repro: Repro): RowResult {
  const reconciled = reconcileTurnPlanV3ExplicitArithmetic({ ...repro.turnPlan, question: repro.question }).plan as TurnPlanV3;
  const red: string[] = [];
  if (!validateTurnPlanV3(reconciled, repro.question).plan) red.push("the turn plan no longer validates");
  const shown = new Map<string, Shown | null>();
  let audit = "";
  for (const variant of [...repro.irs, { tag: "noIR", ir: null }]) {
    const problemIR = variant.ir;
    let turnPlan = reconciled;
    let status: string | null = null;
    if (problemIR) {
      turnPlan = reconcileTurnPlanWithSolver(turnPlan, problemIR, solved);
      status = verifyTurnPlanAgainstSolver(problemIR, solved, turnPlan, repro.question).status;
      if (variant.tag === "IR") audit = status;
    }
    const tag = variant.tag;
    shown.set(`family ${tag}`, show(synthesizeFamilyScene({ question: repro.question, turnPlan, problemIR }) as Drawn));
    const families = inferSceneCapabilities(repro.question, { lawIds: turnPlan.lawIds, problemIR, turnPlan }).families;
    const fast = status === "contradiction" ? null : selectFastVerifiedRepresentation({ question: repro.question, turnPlan, problemIR, families });
    shown.set(`fast ${tag}`, show(fast as Drawn));
    const production = (fastRepresentation: typeof fast) => selectProductionScene({
      question: repro.question, turnPlan, problemIR, candidateValidation: null, fastRepresentation,
      exactFigureSource: "planner", solverAuthorityBlocked: false, requiredRetryEnabled: true,
    }).representation;
    shown.set(`production ${tag} fast=null`, show(production(null) as Drawn));
    // The fast path's null authority: the fast figure computed with no ProblemIR, handed to production.
    if (!problemIR) shown.set("production noIR fast=given", show(production(fast) as Drawn));
  }
  if (repro.audit !== undefined && audit !== repro.audit) red.push(`solver audit ${audit}, recorded ${repro.audit}`);
  const paths = [...repro.irs.flatMap((variant) => irPaths(variant.tag)), ...NO_IR_PATHS];
  for (const path of paths) for (const problem of mismatches(shown.get(path) ?? null, repro.expected(path))) red.push(`${path}: ${problem}`);
  const cells = paths.map((path) => [path, fmt(shown.get(path) ?? null)] as const);
  return { name: repro.name, red, cells, audit };
}

const results = repros.map(runRepro);

if (CHILD) {
  // A run against a copy of src: report the red rows, the parent judges them.
  console.log(`REPRO_RED ${JSON.stringify(results.filter((row) => row.red.length).map((row) => row.name))}`);
  process.exit(0);
}

for (const figure of LAUNCH.keys()) checkLaunchNumbers(figure);
for (const row of results) {
  console.log(`${row.red.length ? "RED " : "ok  "} ${row.name}${row.audit ? ` (audit ${row.audit})` : ""}`);
  for (const [path, cell] of row.cells) console.log(`       ${path.padEnd(36)} ${cell}`);
  for (const problem of row.red) console.log(`       !! ${problem}`);
}
const redRows = results.filter((row) => row.red.length).map((row) => row.name);
assert.deepEqual(redRows, [], "every repro must keep its recorded outcome on every path");
const controls = results.filter((row) => row.name.startsWith("control:"));
assert.equal(controls.length, 2, "guard: both controls run");
for (const control of controls) {
  const cell = (path: string) => control.cells.find(([name]) => name === path)?.[1];
  assert.ok(cell("family IR") && cell("family IR") !== "none", `guard: ${control.name} draws with its ProblemIR`);
  assert.ok(cell("production IR fast=null") && cell("production IR fast=null") !== "none", `guard: ${control.name} reaches production with its ProblemIR`);
}

// Mutations on a copy of scene-engine's src.
const appRoot = resolve(__dirname, "../..");
const engine = resolve(appRoot, "../../packages/scene-engine");
const IDENTITY = "archetypes/obligationIdentity.ts";
const MECHANICS = "archetypes/generators/mechanics.ts";
const LEGACY = "synthesize/familyScene.ts";
const CLASSIFY = "synthesize/familyClassification.ts";

interface Edit { file: string; from: string; to: string }
/**
 * Any along-stream wording is evidence again, not only the boat's own motion, and a "how far"
 * question is read again. A drift asked along the stream ("how far downstream does it land") is
 * declined by those rules too, so each other evidence rule is measured with them switched off,
 * and the swept drift and "how far downstream" rows, which only those rules decline, go red with each.
 */
const HOW_FAR_LINE = "  return ALONG_STREAM_MOTION.test(text.replace(/\\bhow\\s+far\\b[^.;:?!]*/gi, \" \"));\n";
const ANY_ALONG_STREAM: Edit = { file: CLASSIFY, from: HOW_FAR_LINE, to: "  return new RegExp(String.raw`\\b${ALONG_STREAM_EVIDENCE}\\b`, \"i\").test(text);\n" };
interface Mutation { name: string; edits: Edit[]; red: string[] }
/** The cut widening of the evidence words, put back. */
const WIDEN: Edit = { file: CLASSIFY, from: "(?:downstream|upstream|along", to: "(?:downstream|upstream|down the river|up the stream|along" };
/** The "how far" rule dropped: the boat's own motion is read in the whole stem again. */
const DROP_HOW_FAR: Edit = { file: CLASSIFY, from: HOW_FAR_LINE, to: "  return ALONG_STREAM_MOTION.test(text);\n" };
const FILLER_NOW = [
  "  const tokens = problemLabel.replace(/[()]/g, \" \").trim().split(/\\s+/).filter(Boolean);",
  "  const words = tokens",
  "    .filter((token, index) => !(FILLER.has(token) && index < tokens.length - 1",
  "      && (token === \"of\" || index === 0 || tokens[index - 1] === \"of\")))",
  "    .map((token) => token.toLowerCase());",
].join("\n");
const mutations: Mutation[] = [
  { name: "unmutated copy", edits: [], red: [] },
  {
    name: "#302: each certified body binds at most once, switched off",
    edits: [{ file: IDENTITY, from: "    if (usedBodies.has(body)) continue;\n", to: "" }],
    red: [TWO_RIVERS],
  },
  {
    name: "#302: single letter filler rule reverted (articles dropped after lower casing)",
    edits: [{ file: IDENTITY, from: FILLER_NOW, to: "  const words = problemLabel.toLowerCase().replace(/[()]/g, \" \").trim().split(/\\s+/).filter((word) => word && !FILLER.has(word));" }],
    red: [PROJECTILE_A, PROJECTILE_A_MASS],
  },
  {
    name: "fix: an inner article is filler again",
    edits: [{ file: IDENTITY, from: "\n      && (token === \"of\" || index === 0 || tokens[index - 1] === \"of\")))", to: "))" }],
    red: [PROJECTILE_A_MASS],
  },
  {
    name: "fix: the along-stream picture records its bodies again",
    edits: [{ file: MECHANICS, from: "  if (variant === \"along_stream\") return scene.build();\n", to: "" }],
    red: [ALONG_STREAM_ROW, ...STILL_WATER_ROWS],
  },
  {
    name: "fix: a horizontal launch with an unread numeric drop draws again",
    edits: [{ file: MECHANICS, from: "(\"numeric\" in height && height.numeric)))", to: "(\"numeric\" in height && height.numeric && theta !== 0)))" }],
    red: PIT_ROWS,
  },
  {
    name: "fix: along stream drawn without stated along-stream motion again",
    edits: [
      { file: MECHANICS, from: "  if (variant === \"along_stream\" && !riverAlongStreamStated(context.question)) return null;\n", to: "" },
      { file: LEGACY, from: "  if (variant === \"along_stream\" && !riverAlongStreamStated(question)) return true;\n", to: "" },
    ],
    red: [...CROSSING_ROWS, ...ALONG_STREAM_CALL_ROWS],
  },
  {
    name: "evidence: a stem naming other river geometry draws the along-stream picture again",
    edits: [{ file: CLASSIFY, from: "  if (RIVER_OTHER_GEOMETRY.test(text)) return false;\n", to: "" }, ANY_ALONG_STREAM],
    red: [...OTHER_GEOMETRY_ROWS, ...MAIN_WORDS(NEW_GEOMETRY_ROWS), ...MAIN_WORDS(SWEPT_DRIFT_ROWS), ...HOW_FAR_DOWNSTREAM_ROWS],
  },
  {
    name: "evidence: landing, facing, front, edge, square, island and due compass wording are not other geometry again",
    edits: [{ file: CLASSIFY, from: "land(?:s|ed|ing)?|facing|front|edges?|square|islands?|due\\s+[nsew]|", to: "" }, ANY_ALONG_STREAM],
    red: [...MAIN_WORDS(NEW_GEOMETRY_ROWS), ...MAIN_WORDS(SWEPT_DRIFT_ROWS), ...HOW_FAR_DOWNSTREAM_ROWS],
  },
  {
    name: "evidence: a length not travelled along the stream draws again",
    edits: [{ file: CLASSIFY, from: "  if (!riverLengthsAlongStream(text)) return false;\n", to: "" }, ANY_ALONG_STREAM],
    red: [...OFF_STREAM_LENGTH_ROWS, ...MAIN_WORDS(SWEPT_DRIFT_ROWS), ...HOW_FAR_DOWNSTREAM_ROWS],
  },
  {
    name: "evidence: a speed over the ground read as the boat's speed again",
    edits: [{ file: CLASSIFY, from: "  if (riverSpeedAlongStream(text)) return false;\n", to: "" }, ANY_ALONG_STREAM],
    red: [...MAIN_WORDS(GROUND_SPEED_DRAWN_ROWS), ...SPLIT_GROUND_SPEED_ROWS, ...MAIN_WORDS(SWEPT_DRIFT_ROWS), ...HOW_FAR_DOWNSTREAM_ROWS],
  },
  {
    name: "evidence: only a sentence with along-stream wording has its speeds read again",
    edits: [{
      file: CLASSIFY,
      from: "  if (!new RegExp(evidence.source, \"i\").test(text)) return false;\n  return text.split(/(?<=[.;:?!])\\s+/).some((sentence) => {\n    const blanked = sentence.replace(evidence, (phrase) => \" \".repeat(phrase.length));\n",
      to: "  return text.split(/(?<=[.;:?!])\\s+/).some((sentence) => {\n    const blanked = sentence.replace(evidence, (phrase) => \" \".repeat(phrase.length));\n    if (blanked === sentence) return false;\n",
    }, ANY_ALONG_STREAM],
    red: [...SPLIT_GROUND_SPEED_ROWS, ...MAIN_WORDS(SWEPT_DRIFT_ROWS), ...HOW_FAR_DOWNSTREAM_ROWS],
  },
  {
    name: "evidence: a boat no faster than the current draws a forward upstream arrow again",
    edits: [{ file: MECHANICS, from: "  if (variant === \"along_stream\" && vb <= vc) return null;\n", to: "" }],
    red: [...SLOW_BOAT_ROWS, ...EQUAL_BOAT_ROWS],
  },
  {
    name: "evidence: the legacy sketch draws stated speeds the plan does not name at its stock 5:2 again",
    // The widening is put back too, so the review's swimmer reaches the sketch again (with it cut,
    // that stem has no evidence); the widened rows draw under it as in the cut mutation below.
    edits: [{ file: LEGACY, from: "  if (variant === \"along_stream\" && !riverSpeeds(quantities).sourced) return true;\n", to: "" }, WIDEN],
    red: [...UNSOURCED_SKETCH_ROWS, SLOW_BOAT_ROWS[0]!, ...EQUAL_BOAT_ROWS, ...WIDENED_ROWS],
  },
  {
    name: "evidence: any along-stream wording counts again, not only the boat's own motion",
    edits: [ANY_ALONG_STREAM],
    red: [...MAIN_WORDS(SWEPT_DRIFT_ROWS), ...HOW_FAR_DOWNSTREAM_ROWS],
  },
  {
    name: "evidence: a still-water qualifier after a speed no longer names the boat's own speed",
    edits: [{ file: CLASSIFY, from: "      if (STILL_WATER_AFTER.test(sentence.slice(end))) return false;\n", to: "" }],
    // Every sentence's speeds are read once the stem has along-stream wording, so the qualifier
    // also owns the drawn rows whose "5 m/s in still water" sits in a sentence without it.
    red: [SLOW_BOAT_ROWS[1]!, ...STILL_WATER_ROWS],
  },
  // The cut widening, put back: its right figures draw again (and nothing else, the "how far" rule
  // still declines the drift questions).
  {
    name: "cut: down the river and up the stream are along-stream evidence again",
    edits: [WIDEN],
    red: WIDENED_ROWS,
  },
  {
    name: "how far: the boat's own motion is read inside a how far question again",
    edits: [DROP_HOW_FAR],
    red: HOW_FAR_DOWNSTREAM_ROWS,
  },
  {
    name: "cut and how far: the widening is back and a how far question is read again",
    edits: [WIDEN, DROP_HOW_FAR],
    red: [...HOW_FAR_DOWN_THE_RIVER_DRAWN_ROWS, ...HOW_FAR_DOWNSTREAM_ROWS, ...WIDENED_ROWS],
  },
  {
    name: "evidence: a boat exactly as fast as the current draws a forward upstream arrow again",
    edits: [{ file: MECHANICS, from: "  if (variant === \"along_stream\" && vb <= vc) return null;\n", to: "  if (variant === \"along_stream\" && vb < vc) return null;\n" }],
    red: EQUAL_BOAT_ROWS,
  },
];

const tsx = join(appRoot, "node_modules/.bin/tsx");
const tutorConfig = JSON.parse(readFileSync(join(appRoot, "tsconfig.json"), "utf8")) as { compilerOptions: { paths: Record<string, string[]> } };
for (const mutation of mutations) {
  const root = mkdtempSync(join(tmpdir(), "heytutor-obligation-repros-"));
  try {
    const copy = join(root, "scene-engine");
    cpSync(join(engine, "src"), join(copy, "src"), { recursive: true });
    copyFileSync(join(engine, "package.json"), join(copy, "package.json"));
    symlinkSync(join(engine, "node_modules"), join(copy, "node_modules"), "dir");
    const touched = new Set<string>();
    for (const edit of mutation.edits) {
      const target = join(copy, "src", edit.file);
      const original = readFileSync(target, "utf8");
      // A file's first edit starts from src; a later edit to the same file starts from the earlier one.
      if (!touched.has(edit.file)) assert.equal(original, readFileSync(join(engine, "src", edit.file), "utf8"), "guard: the copy starts equal to src");
      touched.add(edit.file);
      assert.equal(original.split(edit.from).length - 1, 1, `${mutation.name}: the mutated text occurs exactly once in ${edit.file}`);
      writeFileSync(target, original.replace(edit.from, edit.to));
      const written = readFileSync(target, "utf8");
      assert.notEqual(written, original, `${mutation.name}: the copy of ${edit.file} changed`);
      assert.equal(written.split(edit.from).length - 1, edit.to.includes(edit.from) ? 1 : 0, `${mutation.name}: the copy of ${edit.file} carries the mutation`);
    }
    // Every alias as the tutor maps it, with scene-engine pointed at the copy.
    const paths = Object.fromEntries(Object.entries(tutorConfig.compilerOptions.paths).map(([alias, [entry]]) =>
      [alias, [alias === "@heytutor/scene-engine" ? join(copy, "src/index.ts") : resolve(appRoot, entry!)]]));
    const config = join(root, "tsconfig.json");
    writeFileSync(config, JSON.stringify({ extends: join(appRoot, "tsconfig.json"), compilerOptions: { paths } }));
    const run = spawnSync(tsx, ["--tsconfig", config, __filename], {
      cwd: appRoot, encoding: "utf8", env: { ...process.env, OBLIGATION_REPROS_CHILD: "1" }, maxBuffer: 64 * 1024 * 1024,
    });
    const line = run.stdout.split("\n").find((text) => text.startsWith("REPRO_RED "));
    assert.ok(run.status === 0 && line, `${mutation.name}: the copy run failed (${run.status})\n${run.stderr.slice(-2000)}`);
    const red = JSON.parse(line.slice("REPRO_RED ".length)) as string[];
    console.log(`mutation: ${mutation.name}: ${red.length} red rows`);
    assert.deepEqual(red, mutation.red, `${mutation.name}: red rows`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(`verify-obligation-binding-repros: ok (${results.length} rows, ${mutations.length - 1} mutations red)`);
