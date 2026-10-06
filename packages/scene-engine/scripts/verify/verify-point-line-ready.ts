// maths|10|point-to-line-distance TOPIC-READY gate (agent #2, 4 Oct 2026).
//
// Runs realistic source questions through the same public seams the live
// turn uses: scene-document validation, TurnPlan scene proofs (which carry the
// source lineage guard), the compiler, and the deterministic ProblemIR solver.
// Every expected distance and foot is hand computed below, independently of
// the engine. Controls prove the guard binds the drawn line and point to the
// source, not merely a matching scalar.

import assert from "node:assert/strict";
import { evaluateAnalyticLineConstruction } from "../../src/compile/analyticLineGeometry";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateTurnPlanSceneProofs } from "../../src/contracts/contractsV3";
import { validateSceneDocument } from "../../src/document/validation";
import { readPointLineSourceLiterals, validatePointLineSourceInputs } from "../../src/ir/pointLineSource";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import type { SceneDocument } from "../../src/types";

type LineInput = Record<string, unknown>;
interface Case {
  id: string;
  question: string;
  /** Exactly as a planner would author it: drawn line producer inputs. */
  line: LineInput;
  /** Coefficients handed to point_line_distance. */
  abc: [number, number, number];
  point: [number, number];
  pointName: string;
  distance: number;
  foot: [number, number];
}

const SQRT5 = Math.sqrt(5);
// Hand computation for each case (d = |a x0 + b y0 + c| / sqrt(a^2 + b^2),
// foot = P - (a x0 + b y0 + c) (a, b) / (a^2 + b^2)):
// general:   3x+4y-25=0, P(0,0): s=-25, |n|^2=25, d=5, foot=(0+3,0+4)=(3,4).
// slope:     y=2x+5 -> 2x-y+5=0, (1,2): s=5, |n|^2=5, d=5/sqrt5=sqrt5, foot=(1-2,2+1)=(-1,3).
// vertical:  x=7 -> x-7=0, A(2,-3): s=-5, d=5, foot=(7,-3).
// pointSlope written form: y-3=2(x-1) -> 2x-y+1=0, origin: s=1, d=1/sqrt5, foot=(-2/5,1/5).
// onLine:    3x+4y-25=0, P(3,4): s=0, d=0, foot=(3,4).
const cases: Case[] = [
  {
    id: "general-form",
    question: "Find the perpendicular distance of the point P(0, 0) from the line 3x + 4y - 25 = 0, and the foot of the perpendicular.",
    line: { form: "general", a: 3, b: 4, c: -25 },
    abc: [3, 4, -25], point: [0, 0], pointName: "P", distance: 5, foot: [3, 4],
  },
  {
    id: "slope-intercept",
    question: "Find the distance of the point (1, 2) from the line y = 2x + 5.",
    line: { form: "pointSlope", point: [0, 5], slope: 2 },
    abc: [2, -1, 5], point: [1, 2], pointName: "Q", distance: SQRT5, foot: [-1, 3],
  },
  {
    id: "vertical-line",
    question: "How far is A(2, -3) from the line x = 7? Mark the foot of the perpendicular.",
    line: { form: "general", a: 1, b: 0, c: -7 },
    abc: [1, 0, -7], point: [2, -3], pointName: "A", distance: 5, foot: [7, -3],
  },
  {
    id: "point-slope-from-origin",
    question: "Find the distance of the line y − 3 = 2(x − 1) from the origin.",
    line: { form: "pointSlope", point: [1, 3], slope: 2 },
    abc: [-2, 1, -1], point: [0, 0], pointName: "O", distance: 1 / SQRT5, foot: [-2 / 5, 1 / 5],
  },
  {
    id: "point-on-line",
    question: "Show that P(3, 4) lies on 3x + 4y − 25 = 0 by finding its distance from the line.",
    line: { form: "general", a: 3, b: 4, c: -25 },
    abc: [3, 4, -25], point: [3, 4], pointName: "P", distance: 0, foot: [3, 4],
  },
];

let checks = 0;
function close(actual: number | undefined, expected: number, message: string): void {
  checks += 1;
  assert(actual !== undefined && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}

function sceneFor(test: Case, overrides: { abc?: [number, number, number]; point?: [number, number]; line?: LineInput; label?: string; question?: string; pointName?: string } = {}): SceneDocument {
  test = overrides.pointName ? { ...test, pointName: overrides.pointName } : test;
  const [a, b, c] = overrides.abc ?? test.abc;
  const point = overrides.point ?? test.point;
  const question = overrides.question ?? test.question;
  // The connector is a point exactly when the point lies on the operator line.
  const zero = a * point[0] + b * point[1] + c === 0;
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "Show the source line, the source point and its perpendicular to the line" },
    source: { question },
    quantities: [],
    entities: [
      { id: "line", kind: "line", role: "source line" },
      { id: test.pointName, kind: "point", role: "source point", label: test.pointName },
      { id: "distance", kind: zero ? "point" : "segment", role: "perpendicular from the point to its foot", ...(overrides.label ? { label: overrides.label } : {}) },
    ],
    constructions: [
      { id: "line_make", operator: "line_equation", inputs: overrides.line ?? test.line, outputs: ["line"] },
      { id: "point_make", operator: "point", inputs: { x: point[0], y: point[1] }, outputs: [test.pointName] },
      { id: "distance_make", operator: "point_line_distance", inputs: { point: test.pointName, a, b, c }, outputs: ["distance"] },
    ],
    relations: [], assertions: [], annotations: [],
    requiredEntityIds: ["line", test.pointName, "distance"],
    revealGroups: [{ id: "scene", entityIds: ["line", test.pointName, "distance"], dependsOn: [], narrationCue: "Line, point and perpendicular" }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "scene", dependsOn: [], narrationIntent: "Reveal the engine-owned figure" }],
  };
}

/** The live admission chain for a candidate scene: structure, source proofs, compile. */
function admit(document: SceneDocument, question = document.source.question) {
  const structural = validateSceneDocument(document);
  if (!structural.document) return { ok: false as const, codes: structural.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code), compiled: null };
  const proofs = validateTurnPlanSceneProofs(structural.document, null).filter((issue) => issue.severity === "fatal");
  const lineage = validatePointLineSourceInputs(structural.document, question).filter((issue) => issue.severity === "fatal");
  const compiled = compileSceneDocument(structural.document);
  const compileFatal = compiled.report.issues.filter((issue) => issue.severity === "fatal");
  const codes = [...proofs, ...lineage, ...compileFatal].map((issue) => issue.code);
  if (!compiled.ok) assert.equal(compiled.renderScene, null, "a rejected scene must not carry a partial render");
  return { ok: codes.length === 0 && compiled.ok && compiled.renderScene !== null, codes, compiled };
}

function problemFor(test: Case) {
  const [a, b, c] = test.abc;
  const [x, y] = test.point;
  const n = (value: number) => ({ kind: "number", value });
  const mul = (left: unknown, right: unknown) => ({ kind: "binary", operator: "*", left, right });
  const add = (left: unknown, right: unknown) => ({ kind: "binary", operator: "+", left, right });
  const pow2 = (value: number) => ({ kind: "binary", operator: "^", left: n(value), right: n(2) });
  const quote = (text: string) => {
    const start = test.question.indexOf(text);
    assert(start >= 0, `fixture quote ${text} missing from ${test.id}`);
    return { source: "question", start, end: start + text.length, quote: text };
  };
  const lineQuote = test.question.match(/(?:3x \+ 4y [-−] 25 = 0|y = 2x \+ 5|x = 7|y − 3 = 2\(x − 1\))/)![0];
  const pointQuote = test.question.match(/(?:[A-Z]?\(\s*-?\d+,\s*-?\d+\)|origin)/)![0];
  return {
    schemaVersion: "problem-ir/v1",
    id: `pointLine${test.id.replace(/[^A-Za-z0-9]/g, "")}`,
    question: test.question,
    facts: [
      { id: "sourcePoint", kind: "given", statement: pointQuote, evidence: quote(pointQuote) },
      { id: "sourceLine", kind: "given", statement: lineQuote, evidence: quote(lineQuote) },
      { id: "requested", kind: "requested", statement: "how far", evidence: quote(test.question.includes("distance") ? "distance" : "How far") },
    ],
    entities: [],
    expressions: [{
      id: "distanceExpression",
      valueType: "scalar",
      evidenceFactIds: ["sourcePoint", "sourceLine", "requested"],
      root: {
        kind: "binary", operator: "/",
        left: { kind: "call", function: "abs", argument: add(add(mul(n(a), n(x)), mul(n(b), n(y))), n(c)) },
        right: { kind: "call", function: "sqrt", argument: add(pow2(a), pow2(b)) },
      },
    }],
    constraints: [], representationIntents: [],
    solveRequests: [{ id: "distanceRequest", kind: "evaluate", expressionId: "distanceExpression" }],
  };
}

async function main(): Promise<void> {
  const solver = new LocalDeterministicSolverProvider();
  for (const test of cases) {
    const literals = readPointLineSourceLiterals(test.question);
    assert(literals && literals.lines.length === 1, `${test.id}: source line must be read`);
    const result = admit(sceneFor(test));
    assert(result.ok, `${test.id}: positive must be admitted: ${result.codes.join(", ")}`);
    // Engine numbers come from the same evaluator the compiler dispatches to.
    const [engine] = evaluateAnalyticLineConstruction("point_line_distance", { point: test.point, a: test.abc[0], b: test.abc[1], c: test.abc[2] }, {
      number: (value) => value as number, point: () => { throw new Error("literal points only"); }, geometry: () => undefined,
    });
    close(engine!.analyticLine.distance, test.distance, `${test.id} engine distance`);
    close(engine!.analyticLine.foot?.x, test.foot[0], `${test.id} engine foot x`);
    close(engine!.analyticLine.foot?.y, test.foot[1], `${test.id} engine foot y`);
    // Independent arithmetic: the hand foot is on the source line and the
    // segment P->foot is parallel to the normal.
    const [a, b, c] = test.abc;
    close(a * test.foot[0] + b * test.foot[1] + c, 0, `${test.id} hand foot on line`);
    close(Math.hypot(test.point[0] - test.foot[0], test.point[1] - test.foot[1]), test.distance, `${test.id} hand |P-foot|`);
    for (const primitive of result.compiled!.renderScene!.primitives) {
      for (const point of primitive.points) {
        checks += 1;
        assert(point.x >= 400 && point.x <= 1160 && point.y >= 0 && point.y <= 700, `${test.id}: ink outside the diagram zone`);
      }
    }
    // The measured line reads as a line: its clipped ink crosses the frame
    // at least 1.5 times the connector's length (and 150 px when d = 0).
    const ink = (id: string) => result.compiled!.renderScene!.primitives.find((primitive) => primitive.entityId === id && primitive.kind !== "label");
    const span = (id: string) => { const points = ink(id)?.points ?? []; return points.length >= 2 ? Math.hypot(points.at(-1)!.x - points[0]!.x, points.at(-1)!.y - points[0]!.y) : 0; };
    const lineInk = span("line");
    const connectorInk = span("distance");
    assert(lineInk >= Math.max(1.5 * connectorInk, 150), `${test.id}: measured line drawn as a stub (${lineInk.toFixed(1)} px vs connector ${connectorInk.toFixed(1)} px)`);
    checks += 1;
    // Engine-owned value label: "=" only for an exactly shown value, "≈" when rounded.
    if (test.distance > 0) {
      const texts = result.compiled!.renderScene!.primitives.filter((primitive) => primitive.entityId === "distance" && primitive.kind === "label").map((primitive) => primitive.text);
      const expected = Number.isInteger(test.distance) ? `d=${test.distance}` : `d≈${(Math.round(test.distance * 1000) / 1000).toString()}`;
      assert(texts.includes(expected), `${test.id}: engine label ${expected} expected, got ${JSON.stringify(texts)}`);
      checks += 1;
    }
    assert.deepEqual(compileSceneDocument(sceneFor(test)).renderScene, result.compiled!.renderScene, `${test.id}: compile must be deterministic`);
    // Coefficient scaling of the same source line is the same line.
    const scaled = admit(sceneFor(test, { abc: [a * -3, b * -3, c * -3] }));
    assert(scaled.ok, `${test.id}: scaled coefficients are the same source line: ${scaled.codes.join(", ")}`);
    // Deterministic numeric authority.
    const solved = await solver.solve(problemFor(test));
    assert.equal(solved.status, "solved", `${test.id}: solver ${JSON.stringify(solved.issues)}`);
    close(solved.values[0]!.approximate as number, test.distance, `${test.id} solver distance`);
    // A correct derived label is admitted; a stated distance contradicting
    // the source is refused by the derived-value label authority.
    if (test.distance > 0) {
      const exact = Number.isInteger(test.distance);
      const labelled = admit(sceneFor(test, { label: exact ? `d = ${test.distance}` : `d ≈ ${test.distance.toFixed(3)}` }));
      assert(labelled.ok, `${test.id}: correct distance label admitted: ${labelled.codes.join(", ")}`);
      const wrong = admit(sceneFor(test, { label: `d = ${test.distance + 2}` }));
      assert(!wrong.ok && wrong.codes.includes("invalid_derived_value_label"), `${test.id}: contradicting label must reject: ${wrong.codes.join(", ")}`);
      checks += 2;
    }
  }

  const base = cases[0]!;
  const controls: Array<{ id: string; document: SceneDocument; code: string | string[] }> = [
    // Same scalar distance (5) from P(0,0), different line: lineage, not distance.
    { id: "same-distance-other-line", document: sceneFor(base, { abc: [4, 3, -25], line: { form: "general", a: 4, b: 3, c: -25 } }), code: "point_line_source_line_mismatch" },
    // The documented HEY83 gap: only the operator's c changed, drawn line unchanged.
    { id: "operator-coefficient-mutated", document: sceneFor(base, { abc: [3, 4, -50] }), code: ["point_line_source_line_mismatch", "invalid_point_line_distance_a"] },
    // Operator measures to the source line, but the drawn line is another line.
    { id: "drawn-line-differs", document: sceneFor(base, { line: { form: "general", a: 3, b: 4, c: -50 } }), code: ["point_line_drawn_line_mismatch", "invalid_point_line_distance_a"] },
    // Reviewer probe (reviews/probes/pointline-lineage.mts): draws x=2, measures to y=2, both 2 from O.
    {
      id: "reviewer-lineage-swap",
      document: sceneFor(base, { question: "Find the distance of the origin from the line x=2.", point: [0, 0], line: { form: "general", a: 1, b: 0, c: -2 }, abc: [0, 1, -2] }),
      code: ["invalid_point_line_distance_a", "point_line_source_line_mismatch"],
    },
    // P relabelled with Q's coordinates when the source names both.
    {
      id: "point-identity-swapped",
      document: sceneFor(base, { point: [6, 8], question: "Given P(0, 0) and Q(6, 8), find the distance of P from 3x + 4y - 25 = 0." }),
      code: ["point_line_source_point_mismatch", "point_line_source_ambiguous"],
    },
    // Reviewer role probes (reviews/probes/pointline-source.mts): several stated
    // literals cannot be bound to roles by value, so the scene declines.
    {
      id: "two-points-measures-other",
      document: sceneFor({ ...base, pointName: "B" }, { point: [5, 1], abc: [3, 4, -10], line: { form: "general", a: 3, b: 4, c: -10 }, question: "Points A(2,3) and B(5,1) are given. Find the distance of A from the line 3x+4y-10=0." }),
      code: "point_line_source_ambiguous",
    },
    {
      id: "two-points-measures-asked",
      document: sceneFor({ ...base, pointName: "A" }, { point: [2, 3], abc: [3, 4, -10], line: { form: "general", a: 3, b: 4, c: -10 }, question: "Points A(2,3) and B(5,1) are given. Find the distance of A from the line 3x+4y-10=0." }),
      code: "point_line_source_ambiguous",
    },
    {
      id: "two-lines-measures-other",
      document: sceneFor({ ...base, pointName: "O" }, { point: [0, 0], abc: [1, 0, -4], line: { form: "general", a: 1, b: 0, c: -4 }, question: "The lines x=2 and x=4 are given. Find the distance of the origin from the line x=2." }),
      code: "point_line_source_ambiguous",
    },
    {
      id: "unread-equation-beside-line",
      document: sceneFor(base, { question: "Find the distance of P(0, 0) from 3x + 4y - 25 = 0 and from kx + y = 3." }),
      code: "point_line_source_ambiguous",
    },
    { id: "point-not-in-source", document: sceneFor(base, { point: [1, 1] }), code: "point_line_source_point_mismatch" },
    // A name the source does not use cannot relabel a point the source names.
    {
      id: "named-point-renamed",
      document: sceneFor(base, { point: [6, 8], pointName: "R", question: "Given P(0, 0) and Q(6, 8), find the distance of Q from 3x + 4y - 25 = 0." }),
      code: ["point_line_source_point_mismatch", "point_line_source_ambiguous"],
    },
    { id: "invented-name-for-named-point", document: sceneFor(base, { pointName: "R" }), code: "point_line_source_point_mismatch" },
    // A line stated only through two points is not bindable: decline honestly.
    {
      id: "two-point-line-declines",
      document: sceneFor(base, {
        question: "Find the distance of P(0, 0) from the line through A(3, 4) and B(7, 1).",
        line: { form: "twoPoint", p: [3, 4], q: [7, 1] },
        abc: [3, 4, -25],
      }),
      code: "point_line_source_unsupported",
    },
    // Slope given in words: no literal equation to bind.
    {
      id: "slope-in-words-declines",
      document: sceneFor(cases[1]!, { question: "Find the distance of the point (1, 2) from the line with slope 2 and y-intercept 5." }),
      code: "point_line_source_unsupported",
    },
  ];
  for (const control of controls) {
    const result = admit(control.document);
    assert(!result.ok, `${control.id}: must reject`);
    const accepted = Array.isArray(control.code) ? control.code : [control.code];
    assert(accepted.some((code) => result.codes.includes(code)), `${control.id}: expected ${accepted.join(" or ")}, got ${result.codes.join(", ")}`);
    assert.equal(result.compiled?.renderScene ?? null, result.compiled?.ok ? result.compiled.renderScene : null);
    checks += 1;
  }
  // Identity positives: a free label on the origin is fine, and the origin
  // restated as O(0, 0) is one point, not two.
  for (const [id, document] of [
    ["origin-free-label", sceneFor(cases[3]!, { pointName: "P" })],
    ["origin-repeated-as-pair", sceneFor(cases[3]!, { question: "Find the distance of the line y − 3 = 2(x − 1) from the origin O(0, 0)." })],
  ] as const) {
    const result = admit(document);
    assert(result.ok, `${id}: must be admitted: ${result.codes.join(", ")}`);
    checks += 1;
  }
  // a = b = 0 is not a line: the compiler refuses atomically.
  const degenerate = admit(sceneFor(base, { abc: [0, 0, 5] }));
  assert(!degenerate.ok, "a=b=0 must reject");
  checks += 1;
  // Readers refuse what they cannot model rather than guessing.
  for (const text of ["x^2 + y = 3", "kx + y = 3", "f(x) = 2x + 1", "0x + 0y + 5 = 0"]) {
    const literals = readPointLineSourceLiterals(`Find the distance of (1, 2) from ${text}.`);
    assert.equal(literals?.lines.length, 0, `${text} must not be read as a line`);
    checks += 1;
  }

  // Regression: a negative literal base under ^ once evaluated as -(b^2) in the
  // approximate value while the exact value was right ((-1)^2 -> -1).
  for (const [base, exponent, expected] of [[-1, 2, 1], [-3, 2, 9], [-2, 3, -8]] as const) {
    const question = "Evaluate the power.";
    const solved = await solver.solve({
      schemaVersion: "problem-ir/v1", id: "negativePower", question,
      facts: [{ id: "requested", kind: "requested", statement: "Evaluate", evidence: { source: "question", start: 0, end: 8, quote: "Evaluate" } }],
      entities: [], constraints: [], representationIntents: [],
      expressions: [{ id: "power", valueType: "scalar", evidenceFactIds: ["requested"], root: { kind: "binary", operator: "^", left: { kind: "number", value: base }, right: { kind: "number", value: exponent } } }],
      solveRequests: [{ id: "powerRequest", kind: "evaluate", expressionId: "power" }],
    });
    close(solved.values[0]?.approximate as number, expected, `(${base})^${exponent} approximate`);
  }

  console.log(JSON.stringify({ gate: "point-line-ready", cases: cases.length, controls: controls.length + 5, checks, studentRun: "not_claimed_here" }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
