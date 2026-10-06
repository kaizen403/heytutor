import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applySourceQuantityAuthority, compileSceneDocument, synthesizeFamilyScene, validateSceneQuantityAgreement, relativeMotionCallerIssues, type ExpressionNodeIR, type ProblemIR, type TurnPlanV3, } from "@heytutor/scene-engine";
import { selectFastVerifiedRepresentation, selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
type Input = {
  question: string;
  turnPlan: TurnPlanV3;
  problemIR: ProblemIR;
};
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const originals = read("w2-relative-whole-callers.json") as Input[];
const negatives = read("w2-relative-whole-negatives.json") as Array<{
  name: string;
  input: Input;
}>;
const fixture = originals[0]!;
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`PASS ${name}`); }
function freeze<T>(input: T): T {
  if (input && typeof input === "object") {
    for (const value of Object.values(input))
      freeze(value);
    Object.freeze(input);
  }
  return input;
}
const texts = (scene: NonNullable<ReturnType<typeof compileSceneDocument>["renderScene"]>): string[] => scene.primitives.flatMap(p => (p.kind === "label" || p.kind === "dimension") && typeof p.text === "string" ? [p.text] : []);
const candidate = synthesizeFamilyScene(fixture)!;
const compiled = compileSceneDocument(candidate.document, { sourceAuthority: fixture });
assert.ok(compiled.ok && compiled.renderScene);
const labels = texts(compiled.renderScene);
function accept(name: string, input: Input, expectedTime: number, expectedTravel: number, marks?: number): void {
  check(name, () => {
    const before = JSON.stringify(input);
    freeze(input);
    assert.deepEqual(relativeMotionCallerIssues(input.question, input.problemIR, input.turnPlan), []);
    const authority = applySourceQuantityAuthority(input.turnPlan,input.problemIR,input.question);
    assert.equal(authority.plan,input.turnPlan);
    assert.ok(authority.outcomes.some(outcome=>outcome.topic==="physics|2|relative-velocity" && !outcome.declineFigure && !outcome.corrections.length));
    const fast = selectFastVerifiedRepresentation(input), normal = selectVerifiedRepresentation(input);
    assert.ok(fast, normal.reason);
    assert.equal(fast.tier, "exact_verified");
    assert.equal(JSON.stringify(fast.sceneDocument), JSON.stringify(normal.sceneDocument));
    assert.equal(JSON.stringify(fast.renderScene), JSON.stringify(normal.renderScene));
    if (marks)
      assert.equal(fast.renderScene.primitives.length, marks);
    assert.ok(texts(fast.renderScene).includes(`t=${expectedTime} s`));
    assert.ok(texts(fast.renderScene).includes(`dA=${expectedTravel} m`));
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(validateSceneQuantityAgreement(fast.sceneDocument.quantities, input.turnPlan, texts(fast.renderScene), {
      question: input.question, problemIR: input.problemIR, document: fast.sceneDocument,
    }), []);
  });
}
function reject(name: string, input: Input): void {
  check(name, () => {
    const before = JSON.stringify(input);
    freeze(input);
    assert.equal(selectFastVerifiedRepresentation(input), null);
    const authority = applySourceQuantityAuthority(input.turnPlan,input.problemIR,input.question);
    assert.equal(authority.plan,input.turnPlan);
    assert.ok(authority.outcomes.some(outcome=>outcome.topic==="physics|2|relative-velocity" && outcome.declineFigure && !outcome.corrections.length));
    const normal = selectVerifiedRepresentation(input);
    assert.equal(normal.renderScene.primitives.length, 0, normal.reason);
    assert.match(normal.reason, /source_declined/);
    assert.ok(validateSceneQuantityAgreement(candidate.document.quantities, input.turnPlan, labels, {
      question: input.question, problemIR: input.problemIR, document: candidate.document,
    }).length);
    assert.equal(compileSceneDocument(candidate.document, { sourceAuthority: input }).ok, false);
    assert.equal(JSON.stringify(input), before);
  });
}
const expected = [[20, 400, 37], [12, 144, 35], [5, 90, 35], [7, 210, 36], [5, 120, 42]];
originals.forEach((input, index) => accept(`frozen original whole caller ${index}`, input, ...expected[index] as [
  number,
  number,
  number
]));
check("captured original four claims remain unchanged and independently proved", () => {
  assert.equal(fixture.turnPlan.qualitativeClaims.length, 4);
  assert.deepEqual(relativeMotionCallerIssues(fixture.question, fixture.problemIR, fixture.turnPlan), []);
});
negatives.forEach(({ name, input }) => reject(`immutable review ${name}`, input));
// Independent source/formulation holdouts, with separately stated arithmetic
// oracles. These include all original requests and are never shortened IRs.
const n = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const op = (operator: "+" | "-" | "*" | "/", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
function holdout(id: string, question: string, va: number, vb: number, xa: number, xb: number, time: number, travel: number, conventional = false): Input {
  const givens: TurnPlanV3["givens"] = [
    { id: "a", symbol: "v_A", value: Math.abs(va), unit: "m/s", provenance: "given" },
    { id: "b", symbol: "v_B", value: Math.abs(vb), unit: "m/s", provenance: "given" },
    ...(conventional ? [{ id: "gap", symbol: "gap", value: xb - xa, unit: "m", provenance: "given" as const }]
      : [{ id: "xa", symbol: "x_A", value: xa, unit: "m", provenance: "given" as const }, { id: "xb", symbol: "x_B", value: xb, unit: "m", provenance: "given" as const }]),
  ];
  const derived: TurnPlanV3["derived"] = [{ id: "time", symbol: "t", value: time, unit: "s", provenance: "derived" }, { id: "travel", symbol: "d_A", value: travel, unit: "m", provenance: "derived" }];
  const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens, derived, unknowns: derived.map(({ id, symbol, unit }) => ({ id, symbol, unit })), qualitativeClaims: [], assumptions: [], lawIds: ["uniform_motion"], visualRequirement: "required" };
  const facts: ProblemIR["facts"] = ["given", "requested"].map((kind, index) => ({ id: index ? "query" : "setup", kind: kind as "given" | "requested", statement: question, evidence: { source: "question", quote: question, start: 0, end: question.length } }));
  const root = op("/", conventional ? n(xb - xa) : op("-", n(xb), n(xa)), op("-", n(va), n(vb)));
  const entities: ProblemIR["entities"] = ["A", "B"].map(id => ({ id, kind: "body", label: id, evidenceFactIds: ["setup"] }));
  const expressions: ProblemIR["expressions"] = [{ id: "timeExpr", valueType: "scalar", root, evidenceFactIds: ["setup", "query"] }, { id: "travelExpr", valueType: "scalar", root: op("*", n(Math.abs(va)), structuredClone(root)), evidenceFactIds: ["setup", "query"] }];
  const problemIR: ProblemIR = { schemaVersion: "problem-ir/v1", id, question, facts, entities, expressions, constraints: [], representationIntents: [{ id: "motion", kind: "conceptual", entityIds: ["A", "B"], evidenceFactIds: ["setup"] }], solveRequests: derived.map((q, index) => ({ id: `request${index}`, kind: "evaluate", expressionId: expressions[index]!.id, resultBinding: { turnPlanQuantityId: q.id, symbol: q.symbol, unit: q.unit, evidenceFactIds: ["query"] } })) };
  return { question, turnPlan, problemIR };
}
const holds = [
  holdout("newHeadon", "Two cars A and B move towards each other at 10 m/s and 5 m/s. They are 90 m apart. Find the time for A to catch B and the distance travelled by A.", 10, -5, 0, 90, 6, 60, true),
  holdout("newNegativeOrigin", "In the ground frame, east is positive. At t=0 point A is at -40 m and B at 80 m; their constant ground velocities are +7 m/s and -3 m/s. Find the time for A to catch B and the distance travelled by A.", 7, -3, -40, 80, 12, 84),
  holdout("newWest", "In the ground frame, east is positive. At t=0 point A is at 100 m and B at 0 m; their constant ground velocities are -15 m/s and -5 m/s. Find the time for A to catch B and the distance travelled by A.", -15, -5, 100, 0, 10, 150),
  holdout("newRest", "In the ground frame, east is positive. At t=0 point A is at -20 m and B at 20 m; their constant ground velocities are +5 m/s and +0 m/s. Find the time for A to catch B and the distance travelled by A.", 5, 0, -20, 20, 8, 40),
];
holds.forEach((input, index) => {
  const oracles = [[6, 60], [12, 84], [10, 150], [8, 40]];
  accept(`independent full holdout ${index}`, input, ...oracles[index] as [
    number,
    number
  ]);
  const stale = structuredClone(input);
  stale.problemIR.expressions[0]!.root = op("+", n(998), n(1));
  reject(`holdout ${index} stale compound 999`, stale);
});
// The full original caller gains a supported, source-evidenced intermediate
// conversion request. It must be evaluated and bound, even though not unknown.
const intermediate = structuredClone(fixture);
intermediate.problemIR.expressions.push({ id: "conversion", valueType: "scalar", root: op("/", op("*", n(72), n(1000)), n(3600)), evidenceFactIds: ["fSpeedA", "fTime"] });
intermediate.problemIR.solveRequests.push({ id: "conversionRequest", kind: "evaluate", expressionId: "conversion", resultBinding: { turnPlanQuantityId: "d1", symbol: "v_A", unit: "m/s", evidenceFactIds: ["fTime"] } });
accept("source-evidenced original intermediate binding survives", intermediate, 20, 400, 37);
const mutations: Array<[
  string,
  (input: Input) => void
]> = [
  ["original AST extra child cannot disappear", i => { Object.assign(i.problemIR.expressions[0]!.root,{foreign:n(999)}); }],
  ["original request mixed extension cannot disappear", i => { Object.assign(i.problemIR.solveRequests[0]!,{variable:"foreign"}); }],
  ["unproved original uncertainty", i => { i.turnPlan.givens[0]!.uncertainty=999; }],

  ["malformed original actor label", i => { Object.assign(i.problemIR.entities[0]!,{label:0}); }],
  ["stale original Plan time 999", i => { i.turnPlan.derived.find(q=>q.id==="u1")!.value=999; }],

  ["whole original unsupported source clause", i => {
    i.question += " Train A accelerates at 2 m/s^2 after 5 s.";
    i.turnPlan.question = i.question;
    i.problemIR.question = i.question;
  }],

  ["truthful foreign-body quantity sourceText", i => { i.turnPlan.givens[0]!.sourceText = "B moves at 54 km/h"; }],
  ["wrong acyclic dependency role", i => { i.turnPlan.derived.find(q => q.id === "d1")!.dependsOn = ["g2"]; }],
  ["declared zero sign on moving actor", i => { i.turnPlan.givens[0]!.sign = "zero"; }],
  ["actor facts exchanged under independent IDs", i => {
    i.problemIR.entities[0]!.id = "subjectBody";
    i.problemIR.entities[1]!.id = "referenceBody";
    i.problemIR.representationIntents[0]!.entityIds = ["subjectBody", "referenceBody"];
    [i.problemIR.entities[0]!.evidenceFactIds,i.problemIR.entities[1]!.evidenceFactIds] = [i.problemIR.entities[1]!.evidenceFactIds,i.problemIR.entities[0]!.evidenceFactIds];
  }],

  ["two-node original DAG cycle", i => { i.turnPlan.derived.find(q => q.id === "d1")!.dependsOn = ["d2"]; i.turnPlan.derived.find(q => q.id === "d2")!.dependsOn = ["d1"]; }],
  ["false given body sourceText", i => { i.turnPlan.givens[0]!.sourceText = "Train B speed is 72 km/h"; }],
  ["false derived body sourceText", i => { i.turnPlan.derived.find(q => q.id === "d1")!.sourceText = "Train B has speed 20 m/s in the ground frame"; }],
  ["false claim expected scalar", i => { i.turnPlan.qualitativeClaims[0]!.expected = 999; }],
  ["false unsupported nonnumeric claim", i => { i.turnPlan.qualitativeClaims.push({ id: "force", claim: "A experiences a force", expected: true }); }],
  ["query uses given evidence", i => { i.problemIR.solveRequests[0]!.resultBinding!.evidenceFactIds = ["fSpeedA"]; }],
  ["time query uses distance evidence", i => { i.problemIR.solveRequests[0]!.resultBinding!.evidenceFactIds = ["fDist"]; }],
  ["requested fact borrows wrong quote", i => { i.problemIR.facts.find(f => f.id === "fTime")!.evidence = { ...i.problemIR.facts.find(f => f.id === "fDist")!.evidence }; }],
  ["false given statement valid quote", i => { i.problemIR.facts[0]!.statement = "Train B speed is 72 km/h"; }],
  ["expression loses source premise", i => { i.problemIR.expressions[0]!.evidenceFactIds = ["fTime"]; }],
  ["foreign expression cannot disappear", i => { i.problemIR.expressions.push({ id: "unused", valueType: "scalar", root: n(20), evidenceFactIds: ["fSpeedA"] }); }],
  ["additional unbound evaluate request", i => { i.problemIR.solveRequests.push({ id: "foreign", kind: "evaluate", expressionId: "eTime" }); }],
  ["unsupported AST function", i => { i.problemIR.expressions[0]!.root = { kind: "call", function: "sqrt", argument: n(400) }; }],
  ["correct numeric answer unsupported formulation", i => { i.problemIR.expressions[0]!.root = op("+", n(15), n(5)); }],
  ["extra unknown force", i => { i.turnPlan.unknowns.push({ id: "force", symbol: "F", unit: "N" }); }],
  ["same-ID Plan/scene contradiction", i => { i.turnPlan.derived.push({ id: "q_rest_B", symbol: "v_A", value: 20, unit: "m/s", provenance: "derived" }); }],
  ["wrong intermediate result", i => { i.problemIR.expressions.find(e => e.id === "conversion")!.root = n(999); }],
  ["false equation constraint cannot disappear", i => { i.problemIR.constraints.push({ id: "eq", kind: "equation", leftExpressionId: "eTime", rightExpressionId: "eDist", evidenceFactIds: ["fTime"] }); }],
];
for (const [name, mutate] of mutations) {
  const input = structuredClone(name === "wrong intermediate result" ? intermediate : fixture);
  mutate(input);
  reject(name, input);
}
const observer = originals[4]!;
for (const [name, mutate] of [
  ["actor/observer label permutation", (i: Input) => { [i.problemIR.entities[0]!.label, i.problemIR.entities[2]!.label] = [
i.problemIR.entities[2]!.label, i.problemIR.entities[0]!.label]; }],
  ["duplicate observer identity", (i: Input) => { i.problemIR.entities[2]!.label = "B"; }],
  ["observer facts removed", (i: Input) => { i.problemIR.entities[2]!.evidenceFactIds = []; }],
] as const) {
  const input = structuredClone(observer);
  mutate(input);
  reject(name, input);
}
check("missing/null optional documents decline without throwing", () => {
  for (const document of [undefined, null]) {
    const context = { question: fixture.question, problemIR: fixture.problemIR, ...(document === null ? { document: null } : {}) };
    const issues = validateSceneQuantityAgreement(candidate.document.quantities, fixture.turnPlan, labels, context as never);
    assert.ok(issues.some(issue => issue.code === "scene_quantity_source_context"));
  }
});
check("source context array/null and malformed documents decline", () => {
  for (const context of [null, [], { question: fixture.question, problemIR: fixture.problemIR, document: {} }, { question: fixture.question, problemIR: fixture.problemIR, document: { quantities: [] } }]) {
    assert.ok(validateSceneQuantityAgreement(candidate.document.quantities, fixture.turnPlan, labels, context as never).some(issue=>issue.code==="scene_quantity_source_context"));
  }
});
check("getter contexts are rejected before execution", () => {
  let calls = 0;
  const context = { question: fixture.question, problemIR: fixture.problemIR, document: candidate.document };
  Object.defineProperty(context, "question", { get() { calls++; throw Error("executed"); } });
  assert.ok(validateSceneQuantityAgreement(candidate.document.quantities, fixture.turnPlan, labels, context).length);
  assert.equal(calls, 0);
});
check("complete proof preserves the original claim strings", () => {
  const captured = read("w2-relative-fast-original.json") as Input;
  assert.deepEqual(captured, fixture);
});
console.log(`relative whole caller ${checks} checks`);
