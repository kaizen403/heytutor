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
interface Figure { tier: string; family: string; labels: string[]; boatPerp?: boolean; tower?: boolean }
const RIVER: Figure = { tier: "exact_verified", family: "vector_diagram", labels: ["bank", "bank", "current", "boat", "vb=5 m/s", "vc=3 m/s", "v"], boatPerp: true };
const numericProjectile = (h: string, r: string): Figure => ({
  tier: "exact_verified", family: "contact_body",
  labels: ["level ground", "projectile", "trajectory", "H", "B", "u=20 m/s", "θ=30°", "A", `H=${h} m`, `R=${r} m`],
});
const G10 = numericProjectile("5", "34.6");
const G16 = numericProjectile("31.2", "217");
const G98 = numericProjectile("5.1", "35.3");
const SYMBOLIC: Figure = { tier: "qualitative_verified", family: "contact_body", labels: ["level ground", "projectile", "trajectory", "H", "B", "u", "θ", "A", "H", "R"] };
// Downstream at vb+vc = 8 and upstream at vb−vc = 2, for 5 and 3 m/s.
const ALONG_STREAM_FIG: Figure = { tier: "exact_verified", family: "vector_diagram", labels: ["bank", "bank", "current", "boat", "vb+vc=8", "boat", "vb−vc=2", "vc"] };
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

type Primitive = { kind: string; text?: string };
type Drawn = { tier: string; family?: string; renderScene: { primitives: ReadonlyArray<Primitive> }; document?: unknown; sceneDocument?: unknown } | null | undefined;
interface Shown { tier: string; family?: string; labels: string[]; ids: string[]; assertions: string[] }
const show = (figure: Drawn): Shown | null => {
  if (!figure) return null;
  const document = (figure.sceneDocument ?? figure.document) as { entities: Array<{ id: string }>; assertions: Array<{ id: string }> } | undefined;
  const labels = figure.renderScene.primitives.flatMap((primitive) =>
    (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text ? [primitive.text] : []);
  return { tier: figure.tier, family: figure.family, labels, ids: document?.entities.map((entity) => entity.id) ?? [], assertions: document?.assertions.map((row) => row.id) ?? [] };
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

interface Edit { file: string; from: string; to: string }
interface Mutation { name: string; edits: Edit[]; red: string[] }
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
    red: [ALONG_STREAM_ROW],
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
    red: CROSSING_ROWS,
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
    for (const edit of mutation.edits) {
      const target = join(copy, "src", edit.file);
      const original = readFileSync(target, "utf8");
      assert.equal(original, readFileSync(join(engine, "src", edit.file), "utf8"), "guard: the copy starts equal to src");
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
