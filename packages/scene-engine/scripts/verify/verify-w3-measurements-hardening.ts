import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SceneDocument } from "../../src/types";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { ExpressionNodeIR, ProblemIR } from "../../src/ir/problemIR";
import type { verifyMeasurementSourceAuthority as Verify } from "../../src/ir/measurementSourceAuthority";

// --built runs the same independent controls against our own bundled ESM artifact.
const { verifyMeasurementSourceAuthority: verify } = await import(process.argv.includes("--built")
  ? "../../dist/w3/measurementSourceAuthority.js" : "../../src/ir/measurementSourceAuthority.ts") as { verifyMeasurementSourceAuthority: typeof Verify };
const native = JSON.parse(readFileSync(new URL("fixtures/w3-measurements-native.json", import.meta.url), "utf8"));
assert.equal(createHash("sha256").update(native.question_options_and_source_answer_verbatim).digest("hex"), "2d12b0d5c223fe9713f8a31a6fa8ce17dc6cd946fb4e88e446cce98895409f01");
assert.equal(native.source.document_sha256, "1c777785cec72e5842ac6473b4d3a4685d6edcd63d012356ebb9427f2665e1de");
assert.equal(native.source.source_text_sha256, "ecdc0f539274cfcb9a2e13050962fc47d47eb1c691929cf0cefd31cb53d4b6b2");
if (process.argv.includes("--scene-output")) { await emitSceneOutput(); process.exit(0); }
const num = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const op = (operator: "+" | "-" | "*" | "/", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
type Input = { problem: ProblemIR; plan: TurnPlanV3 };
function input(d = 2.675, error = 0.02, main = 2.5, expected = 39, unit = "mm", factor = 1): Input {
  const scales = `Least count corresponding to the main scale and circular scale of a screw gauge are ${0.5 / factor} ${unit} and ${0.005 / factor} ${unit}, respectively.`;
  const wire = `A wire of diameter ${d / factor} ${unit}`;
  const zero = `zero error of the screw gauge is ${error < 0 ? "-" : "+"}${Math.abs(error) / factor} ${unit}`;
  const ask = `What would be the reading of divisions on circular scale of the screw gauge, if the ${zero}?`;
  const question = `${scales} ${wire} is measured with the screw gauge. ${ask}`;
  const quote = (text: string) => ({ source: "question" as const, start: question.indexOf(text), end: question.indexOf(text) + text.length, quote: text });
  const facts: ProblemIR["facts"] = [
    { id: "P", kind: "given", statement: "main scale pitch", evidence: quote(scales) },
    { id: "L", kind: "given", statement: "least count", evidence: quote(scales) },
    { id: "D", kind: "given", statement: "wire diameter", evidence: quote(wire) },
    { id: "E", kind: "given", statement: "zero error", evidence: quote(zero) },
    { id: "Q", kind: "requested", statement: "circular scale divisions", evidence: quote(ask) },
  ];
  const all = ["P", "L", "D", "E", "Q"];
  const observed = op("+", num(d), num(error));
  const mainRoot = op("*", num(0.5), num(main / 0.5));
  const problem: ProblemIR = { schemaVersion: "problem-ir/v1", id: "independentMeasurement", question, facts,
    entities: [{ id: "object", kind: "body", label: "wire", evidenceFactIds: ["D"] }, { id: "instrument", kind: "component", label: "screw gauge", evidenceFactIds: ["P", "L", "E"] }],
    expressions: [
      { id: "answer", valueType: "scalar", root: op("/", op("-", observed, mainRoot), num(0.005)), evidenceFactIds: all },
      { id: "obs", valueType: "scalar", root: observed, evidenceFactIds: ["D", "E"] },
      { id: "obsProof", valueType: "scalar", root: structuredClone(observed), evidenceFactIds: ["D", "E"] },
      { id: "main", valueType: "scalar", root: mainRoot, evidenceFactIds: ["P", "D", "E"] },
      { id: "least", valueType: "scalar", root: num(0.005), evidenceFactIds: ["L"] },
    ], constraints: [{ id: "correction", kind: "equation", leftExpressionId: "obs", rightExpressionId: "obsProof", evidenceFactIds: ["D", "E"] }],
    representationIntents: [{ id: "concept", kind: "conceptual", entityIds: ["object"], evidenceFactIds: ["D"] }],
    solveRequests: [{ id: "readout", kind: "evaluate", expressionId: "answer", resultBinding: { turnPlanQuantityId: "caller_count", symbol: "N_c", unit: "division", evidenceFactIds: all } }],
  };
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question,
    givens: [
      { id: "caller_p", symbol: "p", value: 0.5 / factor, unit, provenance: "given", sourceText: `pitch ${scales}` },
      { id: "caller_l", symbol: "LC", value: 0.005 / factor, unit, provenance: "given", sourceText: `least count ${scales}` },
      { id: "caller_d", symbol: "d", value: d / factor, unit, provenance: "given", sourceText: `diameter ${wire}` },
      { id: "caller_e", symbol: "e_0", value: error / factor, unit, provenance: "given", sourceText: `zero error ${zero}` },
    ], unknowns: [{ id: "caller_count", symbol: "N_c", unit: "division" }],
    derived: [{ id: "caller_count", symbol: "N_c", value: expected, unit: "division", provenance: "derived", dependsOn: ["caller_p", "caller_l", "caller_d", "caller_e"], sourceText: facts.map(f => f.evidence.quote).join(" | ") }],
    qualitativeClaims: [{ id: "countclaim", claim: "circular_divisions", expected, relatedQuantityIds: ["caller_count"] }], lawIds: ["micrometer_reading"], assumptions: [], visualRequirement: "none" };
  return { problem, plan };
}
function replaceQuestion(i: Input, change: (q: string) => string): void {
  i.problem.question = change(i.problem.question); i.plan.question = i.problem.question;
  for (const f of i.problem.facts) { f.evidence.start = i.problem.question.indexOf(f.evidence.quote); f.evidence.end = f.evidence.start + f.evidence.quote.length; }
}
const failures: string[] = [];
let checks = 0;
function check(name: string, run: () => void): void {
  checks++; try { run(); console.log(`PASS ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}: ${(e as Error).message}`); }
}
function reject(name: string, mutate: (i: Input) => void): void {
  check(name, () => { const i = input(); mutate(i); const before = JSON.stringify(i); const result = verify(i.problem, i.plan);
    assert.equal(result.status, "declined"); assert.equal(result.numericalAuthority, null);
    assert.equal(JSON.stringify(i), before, "caller graphs remain unmutated");
    const plan = result.plan as TurnPlanV3;
    assert.equal(plan.derived.length, 0); assert.equal(plan.unknowns.length, 0); assert.equal(plan.qualitativeClaims.length, 0);
  });
}
const acceptedCases: Array<[string, [number, number, number, number, string?, number?]]> = [
  ["native arithmetic 39", [2.675, 0.02, 2.5, 39]],
  ["positive crossing", [0.49, 0.02, 0.5, 2]], ["negative crossing", [0.51, -0.02, 0, 98]],
  ["positive exact boundary", [0.48, 0.02, 0.5, 0]], ["negative exact boundary", [0.52, -0.02, 0.5, 0]],
  ["zero error", [0.5, 0, 0.5, 0]], ["observed zero boundary", [0.5, -0.5, 0, 0]], ["centimetres", [2.675, 0.02, 2.5, 39, "cm", 10]], ["metres", [2.675, 0.02, 2.5, 39, "m", 1000]],
];
for (const [name, args] of acceptedCases) check(name, () => { const i = input(...args); const before = JSON.stringify(i); const r = verify(i.problem, i.plan);
  assert.equal(r.status, "verified", JSON.stringify(r.issues)); assert.equal(r.numericalAuthority?.value, args[3]);
  assert.equal(r.numericalAuthority?.symbol, "N_c"); assert.equal(r.problem, i.problem); assert.equal(r.values.main_scale_reading?.value, args[2]);
  assert.equal((r.plan as TurnPlanV3).unknowns[0]?.id, (r.plan as TurnPlanV3).derived[0]?.id); assert.equal(JSON.stringify(i), before);
});
check("verbatim native metadata/options plus generic IDs", () => {
  for (const question of [native.question_options_and_source_answer_verbatim, native.question_options_and_source_answer_verbatim.replace(/676033/g, "998877").replace("Question Number : 1", "Question Number : 7")]) {
    const i = input(); i.problem.question = question; i.plan.question = question;
    const quotes = [question.match(/Least count corresponding[\s\S]*?respectively\./)![0], question.match(/A wire of diameter[\s\S]*?2\.675 mm/)![0], question.match(/zero error of the screw gauge is[\s\S]*?\+0\.02 mm/)![0], question.match(/What would[\s\S]*?\?/)![0]];
    const evidence = [quotes[0], quotes[0], quotes[1], quotes[2], quotes[3]];
    i.problem.facts.forEach((f, index) => { f.evidence = { source: "question", start: question.indexOf(evidence[index]), end: question.indexOf(evidence[index]) + evidence[index].length, quote: evidence[index] }; });
    i.plan.givens.forEach((row, index) => { row.sourceText = `${["pitch", "least count", "diameter", "zero error"][index]} ${evidence[index]}`; });
    i.plan.derived[0]!.sourceText = evidence.join(" | ");
    const r = verify(i.problem, i.plan, question); assert.equal(r.status, "verified", JSON.stringify(r.issues)); assert.equal(r.numericalAuthority?.value, 39); assert.equal(r.problem, i.problem); assert.equal(r.problem!.question, question);
  }
});
check("explicit authentic pitch dialect", () => {
  const i = input(); const scale = "Pitch of the screw gauge is 0.5 mm and least count is 0.005 mm.";
  replaceQuestion(i, q => q.replace(i.problem.facts[0]!.evidence.quote, scale));
  for (const [index, prefix] of [[0, "pitch"], [1, "least count"]] as const) { const f = i.problem.facts[index]!; f.evidence = { source: "question", start: 0, end: scale.length, quote: scale }; i.plan.givens[index]!.sourceText = `${prefix} ${scale}`; }
  i.plan.derived[0]!.sourceText = i.problem.facts.map(f => f.evidence.quote).join(" | ");
  const r = verify(i.problem, i.plan); assert.equal(r.status, "verified", JSON.stringify(r.issues)); assert.equal(r.numericalAuthority?.value, 39);
});
check("dimensionless count binding", () => { const i = input(); i.plan.unknowns[0]!.unit = "1"; i.plan.derived[0]!.unit = "dimensionless";
  const r = verify(i.problem, i.plan); assert.equal(r.status, "verified"); assert.equal(r.numericalAuthority?.value, 39);
});
check("negative source cannot bind positive given", () => { const i = input(2.675, -0.02, 2.5, 31); i.plan.givens[3]!.value = 0.02;
  const r = verify(i.problem, i.plan); assert.equal(r.status, "declined"); assert.equal(r.numericalAuthority, null);
});
reject("hidden entity", i => i.problem.entities.push({ id: "hidden", kind: "body", label: "pendulum", evidenceFactIds: ["D"] }));
reject("wrong instrument entity role", i => { i.problem.entities[1]!.label = "vernier caliper"; });
reject("unused unrelated expression", i => i.problem.expressions.push({ id: "junk", valueType: "scalar", root: op("+", num(38), num(1)), evidenceFactIds: ["P", "L", "D", "E", "Q"] }));
reject("coincident intermediate scalar", i => { i.problem.expressions[1]!.root = num(2.695); });
reject("unmatched extra evaluate", i => i.problem.solveRequests.push({ id: "extra", kind: "evaluate", expressionId: "obs" }));
reject("extra bound ask", i => i.problem.solveRequests.push({ ...i.problem.solveRequests[0]!, id: "second" }));
reject("false equation", i => { i.problem.constraints[0] = { id: "false", kind: "equation", leftExpressionId: "obs", rightExpressionId: "least", evidenceFactIds: ["D", "E", "L"] }; });
reject("equal-valued unrelated equation", i => { i.problem.expressions.push({ id: "coincidence", valueType: "scalar", root: num(2.695), evidenceFactIds: ["D", "E"] }); (i.problem.constraints[0] as {rightExpressionId: string}).rightExpressionId = "coincidence"; });
reject("extra assumption fact", i => i.problem.facts.push({ id: "hiddenfact", kind: "assumption", statement: "wire is elastic", evidence: { ...i.problem.facts[2]!.evidence } }));
reject("fact role semantic suffix", i => { i.problem.facts[0]!.statement += " and wire tension"; });
reject("wrong fact evidence", i => { i.problem.facts[0]!.evidence = { ...i.problem.facts[2]!.evidence }; });
reject("negative source span", i => { i.problem.facts[0]!.evidence.start = -i.problem.question.length; });
reject("out of range source span", i => { i.problem.facts[4]!.evidence.end += 1; });
reject("wrong source span", i => { i.problem.facts[0]!.evidence.start++; });
reject("wrong given zero sign", i => { i.plan.givens[3]!.value = -0.02; });
reject("wrong given symbol", i => { i.plan.givens[3]!.symbol = "d"; });
reject("wrong given evidence", i => { i.plan.givens[3]!.sourceText = "zero error 0.02 mm"; });
reject("missing given premise", i => { i.plan.givens.splice(3, 1); i.plan.derived[0]!.dependsOn = ["caller_p", "caller_l", "caller_d"]; });
reject("missing actual dependency", i => { i.plan.derived[0]!.dependsOn = ["caller_p"]; });
reject("duplicate dependency", i => { i.plan.derived[0]!.dependsOn!.push("caller_e"); });
reject("duplicate given", i => { i.plan.givens.push({ ...i.plan.givens[0]!, id: "copy" }); });
reject("given flag on derived", i => { i.plan.derived[0]!.provenance = "given"; });
reject("unknown symbol mismatch", i => { i.plan.unknowns[0]!.symbol = "unrelated"; });
reject("count length unit", i => { i.plan.unknowns[0]!.unit = "mm"; i.plan.derived[0]!.unit = "mm"; });
reject("dimensionless scale length given", i => { i.plan.givens[0]!.unit = "1"; });
reject("unexpected apparatus intent", i => { i.problem.representationIntents[0]!.kind = "apparatus"; });
reject("wrong intent evidence", i => { i.problem.representationIntents[0]!.evidenceFactIds = ["P"]; });
reject("visual required profile gap", i => { i.plan.visualRequirement = "required"; });
reject("visual optional profile gap", i => { i.plan.visualRequirement = "optional"; });
reject("unsupported count unit", i => { i.plan.unknowns[0]!.unit = "mm/mm"; i.plan.derived[0]!.unit = "mm/mm"; });
reject("given uncertainty", i => { i.plan.givens[0]!.uncertainty = 0.1; });
reject("unsigned error flag", i => { i.plan.givens[3]!.sign = "unsigned"; });
reject("given dependency flag", i => { i.plan.givens[3]!.dependsOn = ["caller_d"]; });
reject("given role collision with result symbol", i => { i.plan.unknowns[0]!.symbol = "p"; i.plan.derived[0]!.symbol = "p"; i.problem.solveRequests[0]!.resultBinding!.symbol = "p"; });
reject("extra unpaired unknown", i => { i.plan.unknowns.push({ id: "z", symbol: "Z", unit: "mm" }); });
reject("unsupported inequality", i => { i.problem.constraints.push({ id: "inequality", kind: "inequality", leftExpressionId: "obs", relation: ">", rightExpressionId: "least", evidenceFactIds: ["D", "E", "L"] }); });
reject("duplicate expression evidence", i => { i.problem.expressions[0]!.evidenceFactIds.push("P"); });
reject("missing binding premise", i => { i.problem.solveRequests[0]!.resultBinding!.evidenceFactIds = ["Q"]; });
reject("unsupported roots request", i => { i.problem.solveRequests.push({ id: "roots", kind: "roots", expressionId: "answer", variable: "x", domain: { min: 0, max: 100 } }); });
reject("hidden statement before scales", i => replaceQuestion(i, q => `The wire is heated. ${q}`));
reject("hidden statement after ask", i => replaceQuestion(i, q => `${q} The wire is elastic.`));
reject("second nonnumeric ask", i => replaceQuestion(i, q => `${q} What is the colour of the wire?`));
reject("hidden statement inside source", i => replaceQuestion(i, q => q.replace("A wire", "The apparatus is faulty. A wire")));
reject("fake metadata prefix", i => replaceQuestion(i, q => `Question Number : 1 The wire is elastic. ${q}`));
reject("fake options hidden statement", i => replaceQuestion(i, q => `${q}\nOptions :\n1. 39\nThe wire is elastic.`));
reject("unsupported assumption plan", i => { i.plan.assumptions.push("wire is elastic"); });
reject("correct value but false intermediate", i => { i.problem.expressions[3]!.root = op("*", num(0.5), num(4)); });
reject("equal-valued source cancellation", i => { i.problem.expressions[0]!.root = op("+", num(39), op("-", num(2.675), num(2.675))); });
check("extras and all downstream unknowns and claims withdrawn even when target correct", () => {
  const i = input(); i.plan.derived.push({ id: "extra", symbol: "X", value: 39, unit: "division", provenance: "derived", dependsOn: ["caller_count"] }, { id: "child", symbol: "Y", value: 78, unit: "division", provenance: "derived", dependsOn: ["extra"] });
  i.plan.unknowns.push({ id: "extra", symbol: "X", unit: "division" }, { id: "child", symbol: "Y", unit: "division" });
  i.plan.qualitativeClaims.push({ id: "extraClaim", claim: "extra", expected: 39, relatedQuantityIds: ["extra"] }, { id: "childClaim", claim: "child", expected: 78, relatedQuantityIds: ["child"] });
  const r = verify(i.problem, i.plan); assert.equal(r.status, "verified");
  assert.deepEqual((r.plan as TurnPlanV3).unknowns.map(x => x.id), ["caller_count"]); assert.deepEqual((r.plan as TurnPlanV3).derived.map(x => x.id), ["caller_count"]); assert.equal((r.plan as TurnPlanV3).qualitativeClaims.length, 1);
});
check("bound stale value corrected only after whole join", () => { const i = input(); i.plan.derived[0]!.value = 35;
  const r = verify(i.problem, i.plan); assert.equal(r.status, "verified"); assert.equal((r.plan as TurnPlanV3).derived[0]!.value, 39); assert.equal((r.plan as TurnPlanV3).qualitativeClaims.length, 0);
});
reject("wrong source unit case", i => replaceQuestion(i, q => q.replace("0.5 mm", "0.5 MM")));
reject("fractional circular reading", i => replaceQuestion(i, q => q.replace("2.675 mm", "2.676 mm")));
reject("duplicate options IDs", i => replaceQuestion(i, q => `${q} Options : 123. 39 123. 35`));
reject("unsupported law obligation", i => { i.plan.lawIds.push("hookes_law"); });
reject("visual hint obligation", i => { i.plan.teachingSequenceHints = ["instrument"]; });
reject("stale value plus hidden fact cannot correct", i => { i.plan.derived[0]!.value = 35; i.problem.facts.push({ id: "extra", kind: "assumption", statement: "elastic", evidence: { ...i.problem.facts[2]!.evidence } }); });
console.log(`W3 whole-input ${process.argv.includes("--built") ? "built ESM" : "source"}: ${checks - failures.length}/${checks} checks; failures: ${failures.join(", ") || "none"}`);
assert.equal(failures.length, 0, "independent hardening controls must all pass");

/** Compare complete built-engine scenes, including bars, witnesses, anchors and label ink. */
async function emitSceneOutput(): Promise<void> {
  const engine = await import("../../dist/index.js");
  const { generatorFor } = await import("../../src/archetypes/generators");
  const records: unknown[] = [];
  const compile = (document: SceneDocument) => {
    const validated = engine.validateSceneDocument(engine.pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
    assert.ok(validated.document, JSON.stringify(validated.report.issues));
    const result = engine.compileSceneDocument(validated.document);
    assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
    records.push(result.renderScene);
  };
  for (const end of [{ x: 4, y: 0 }, { x: 0, y: 4 }, { x: 4, y: 3 }, { x: -4, y: -3 }]) {
    compile({ schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "exact measurement output comparison" }, source: { question: "Mark the distance between the supplied endpoints." }, quantities: [],
      entities: [{ id: "a", kind: "point", role: "span start" }, { id: "b", kind: "point", role: "span end" }, { id: "edge", kind: "segment", role: "measured edge" }, { id: "dim", kind: "dimension", role: "distance", label: "d" }],
      constructions: [{ id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] }, { id: "make_b", operator: "point", inputs: end, outputs: ["b"] }, { id: "make_edge", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["edge"] }, { id: "make_dim", operator: "dimension", inputs: { start: "a", end: "b" }, outputs: ["dim"] }], relations: [], assertions: [], annotations: [], requiredEntityIds: ["a", "b", "edge", "dim"], revealGroups: [{ id: "setup", entityIds: ["a", "b", "edge", "dim"], dependsOn: [], narrationCue: "Mark the distance." }], teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Show the measurement." }] });
  }
  for (const question of [
    "Draw a labelled diagram for Using vernier callipers to measure internal diameter, external diameter, and depth. Mark the named measured length.",
    "Draw a labelled diagram for Zero error of a vernier calliper. Mark the named measured length.",
    "Draw a labelled diagram of a screw gauge with pitch 1 mm and 50 circular scale divisions.",
  ]) {
    const match = engine.detectArchetype(question); assert.ok(match);
    const raw = generatorFor(match.id)!({ question, slots: match.slots, sources: match.sources, quantities: [], schematic: false });
    assert.ok(raw); compile(raw);
  }
  console.log(JSON.stringify(records));
}
