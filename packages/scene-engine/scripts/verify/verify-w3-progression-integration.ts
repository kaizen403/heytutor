import { measureTextInkBounds } from "@heytutor/drawing";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as engine from "../../src/index";
import type { ProblemIR, TurnPlanV3, SceneDocument, CompileOptions, RenderScene } from "../../src/index";

type Case = {id: string; question: string; problem: ProblemIR; plan: TurnPlanV3; expected: number[]; kind: string; first: number; parameter: number | null; cumulativeFirst: number | null};
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/w3-progression-source/authored-cases.json", import.meta.url), "utf8")) as {cases: Case[]};
let checks = 0;
function check(value: unknown, message: string): asserts value { checks++; assert(value, message); }
function equal(actual: unknown, expected: unknown, message: string): void { checks++; assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message); }
const clone = <T>(value: T): T => structuredClone(value);
const scenes: Array<{id: string; scene: RenderScene}> = [];
function options(c: Case): CompileOptions { return {sourceAuthority: {question: c.question, problemIR: c.problem, turnPlan: c.plan}}; }
function fullPlan(c: Case): TurnPlanV3 {
  // Independent authored caller data. Production never derives a Plan from a
  // document, a geometry payload, or these test expectations.
  return {...clone(c.plan), derived: c.plan.unknowns.map((quantity, i) => ({...quantity, value: c.expected[i]!, provenance: "derived"}))};
}
function atomic(document: SceneDocument, opt: CompileOptions, message: string): void {
  const validated = engine.validateSceneDocument(document, opt);
  check(!validated.document && validated.report.issues.some(issue => issue.severity === "fatal"), `${message}: structural/source`);
  const compiled = engine.compileSceneDocument(document, opt);
  check(!compiled.ok && compiled.renderScene === null && compiled.report.stats.primitiveCount === 0, `${message}: no partial ink`);
}
function rejectCaller(c: Case, mutate: (ir: ProblemIR, plan: TurnPlanV3) => void, message: string): void {
  const bad = {...c, problem: clone(c.problem), plan: clone(c.plan)}; mutate(bad.problem, bad.plan);
  const original = engine.finiteProgressionSourceProgram(c.question, c.problem, c.plan);
  check(original.status === "ok", "valid original for caller attack");
  check(engine.finiteProgressionSourceProgram(bad.question, bad.problem, bad.plan).status === "declined", message);
  atomic(original.document, options(bad), message);
  check(engine.validateSceneSourceAuthority(original.document, c.question, bad.problem, bad.plan).length > 0, `${message}: central boundary`);
  check(engine.synthesizeFamilyScene({question: bad.question, problemIR: bad.problem, turnPlan: bad.plan}) === null, `${message}: family`);
}
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  return value;
}
function verifyLayout(scene: RenderScene): void {
  const labels = scene.primitives.filter(primitive => primitive.kind === "label");
  check(labels.length > 0, "normal label ink");
  const bounds = labels.map(primitive => (primitive.provenance?.labelCollisionBounds ?? primitive.provenance?.labelBounds) as {x: number; y: number; width: number; height: number});
  bounds.forEach(box => check(box && box.x >= 400 && box.y >= 0 && box.x + box.width <= 1160 && box.y + box.height <= 700, "measured label bounds remain on the diagram board"));
  // Pinned labels are checked against their actual handwriting ink. Their
  // padded reservation boxes may overlap even when the ink clears (the
  // normal label engine uses the same renderer metric for pinned owners).
  const ink = labels.map((label, i) => measureTextInkBounds(label.text!, bounds[i]!.x + 4, bounds[i]!.y + 4, Number(label.provenance?.fontPx ?? 24)) ?? bounds[i]!);
  for (let i = 0; i < ink.length; i++) for (let j = i + 1; j < ink.length; j++) {
    const a = ink[i]!, b = ink[j]!;
    check(a.x + a.width <= b.x + 1e-6 || b.x + b.width <= a.x + 1e-6 || a.y + a.height <= b.y + 1e-6 || b.y + b.height <= a.y + 1e-6, `normal label clearance ${labels[i]!.id} / ${labels[j]!.id} ${JSON.stringify([a,b])}`);
  }
}
for (const operator of engine.INDEXED_PROGRESSION_OPERATORS) {
  check(engine.isExecutableSceneConstructionOperator(operator), `${operator} executable`);
  check(engine.isPlannerVisibleSceneConstructionOperator(operator), `${operator} canonical availability`);
}
for (const raw of fixtures.cases) {
  check(!engine.validateTurnPlanV3(raw.plan, raw.question).valid, "previous unknown-only worker Plan gap is retained");
  check(engine.finiteProgressionSourceProgram(raw.question, raw.problem, raw.plan).status === "declined", "missing actual resolved Plan is not waived");
  const c = {...raw, plan: fullPlan(raw)};
  check(engine.validateTurnPlanV3(c.plan, c.question).valid, "complete actual V3 profile");
  const admitted = engine.finiteProgressionSourceProgram(c.question, c.problem, c.plan);
  check(admitted.status === "ok", `${c.id}: ${admitted.status === "declined" ? admitted.reason : ""}`);
  equal(admitted.problem, c.problem, "whole actual IR survives");
  equal(admitted.plan, c.plan, "whole actual same-ID unknown/derived Plan survives");
  equal(admitted.bindings.map(binding => binding.ask.value), c.expected, "independent frozen answers");
  // Independent integer recurrence, including cumulative differences; no
  // production term/aggregation formulas are called by this oracle.
  if (c.parameter !== null) {
    let term = BigInt(c.first), cumulative = BigInt(c.cumulativeFirst ?? 0), sum = 0n;
    const terms: bigint[] = [], sums: bigint[] = [];
    for (let n = 1; n <= 64; n++) {
      const value = c.cumulativeFirst === null ? term : cumulative;
      terms.push(value); sum += value; sums.push(sum); cumulative += term;
      term = c.kind === "arithmetic" ? term + BigInt(c.parameter) : term * BigInt(c.parameter);
    }
    admitted.bindings.forEach(({ask}) => check(BigInt(ask.exact.numerator) === (ask.index ? (ask.kind === "term" ? terms : sums)[ask.index - 1]! : 0n) * BigInt(ask.exact.denominator), "independent exact recurrence"));
  } else equal(admitted.bindings.map(({ask}) => ask.value), [4, -4], "both geometric mean signs independent oracle");
  const document = admitted.document, before = JSON.stringify(document);
  const validated = engine.validateSceneDocument(document, options(c));
  check(validated.document && validated.report.valid, "actual normal source + structural validator");
  equal(validated.document, document, "normal validation does not discard obligations");
  equal(engine.validateSceneSourceAuthority(document, c.question, c.problem, c.plan), [], "central boundary proof");
  equal(engine.visualObligationIssues(c.problem, document, c.plan), [], "normal full-IR visual obligations");
  const compiled = engine.compileSceneDocument(document, options(c));
  check(compiled.ok && compiled.renderScene, `${c.id} compiler: ${JSON.stringify(compiled.report.issues)}`);
  equal(JSON.stringify(document), before, "compiler leaves source candidate intact");
  check(compiled.renderScene.primitives.every(primitive => primitive.kind === "point" || primitive.kind === "label"), "no continuum/display metric proof");
  document.requiredEntityIds.forEach(id => check(compiled.renderScene!.primitives.some(primitive => primitive.entityId === id), "all source roles and results emit ink"));
  check(compiled.renderScene.primitives.some(primitive => primitive.text === "a_n"), "source sequence header");
  if (admitted.source.cumulative) {
    check(compiled.renderScene.primitives.some(primitive => primitive.text === "T_n"), "actual cumulative sequence identity");
    check(compiled.renderScene.primitives.some(primitive => primitive.text === "T_(n+1)-T_n=a_n"), "stated recurrence retained");
    check(compiled.renderScene.primitives.some(primitive => primitive.text === "n>=1"), "stated domain is an inequality");
  }
  admitted.bindings.forEach(binding => check(compiled.renderScene!.primitives.some(primitive => primitive.kind === "label" && primitive.provenance?.quantityId === binding.quantityId && primitive.provenance?.requestId === binding.requestId && primitive.provenance?.unit === binding.unit && primitive.provenance?.sourceSymbol === binding.ask.symbol), "every requested source symbol and actual binding survive rendered result ink"));
  check(compiled.renderScene.primitives.filter(primitive => primitive.id.includes("_index_")).every(primitive => primitive.provenance?.quantityId === undefined), "an index numeral never impersonates its term value");
  verifyLayout(compiled.renderScene);
  scenes.push({id: c.id, scene: compiled.renderScene});
  const family = engine.synthesizeFamilyScene({question: c.question, problemIR: c.problem, turnPlan: c.plan});
  check(family && family.family === "indexed_progression" && family.tier === "exact_verified" && family.nonMetric, "normal family uses complete actual source/IR/Plan");
  equal(family.document, document, "family retains exact source candidate");
  check(engine.synthesizeLastResortScene({question: c.question, problemIR: c.problem, turnPlan: c.plan})?.family === "indexed_progression", "normal last resort preserves source program");
  atomic(document, {}, "stored IR/Plan cannot supply caller authority");
  atomic(document, {sourceAuthority: {question: c.question, problemIR: c.problem}}, "missing actual Plan");
  atomic(document, {sourceAuthority: {question: c.question, problemIR: undefined, turnPlan: c.plan}}, "missing actual IR");
  check(engine.synthesizeFamilyScene({question: c.question, problemIR: c.problem}) === null, "family cannot borrow stored Plan");
  const roundtrip = JSON.parse(JSON.stringify(document)) as SceneDocument;
  equal(engine.validateFiniteProgressionSourceDocument(roundtrip, c.question, c.problem, c.plan), [], "read/restore same whole-source proof");
  const reordered = reverseKeys(roundtrip) as SceneDocument;
  check(engine.compileSceneDocument(reordered, options(c)).ok, "normal compile after JSONB key reordering");
  equal(engine.compileSceneDocument(roundtrip, options(c)).renderScene, compiled.renderScene, "deterministic JSON roundtrip ink");
  for (const mutate of [
    (d: SceneDocument) => {d.requiredEntityIds.pop();},
    (d: SceneDocument) => {d.revealGroups[0]!.entityIds.pop();},
    (d: SceneDocument) => {d.revealGroups[1]!.dependsOn = [];},
    (d: SceneDocument) => {d.teachingTimeline.pop();},
    (d: SceneDocument) => {d.quantities.at(-1)!.value = 99;},
    (d: SceneDocument) => {d.quantities.at(-1)!.unit = "m";},
    (d: SceneDocument) => {d.entities[0]!.label = "unrelated_n";},
    (d: SceneDocument) => {d.entities.at(-1)!.label = "forged=999";},
    (d: SceneDocument) => {d.constructions[0]!.inputs.origin = [900, 500];},
    (d: SceneDocument) => {d.constructions[0]!.inputs.displayScale = 22;},
    (d: SceneDocument) => {d.constructions[0]!.inputs.kind = "other";},
    (d: SceneDocument) => {d.constructions[0]!.inputs.forgedFlag = true;},
    (d: SceneDocument) => {d.entities.push({id: "extra", kind: "polyline", role: "invented continuum"});},
    (d: SceneDocument) => {d.source.problemIR = {};},
    (d: SceneDocument) => {d.source.turnPlan = {};},
    (d: SceneDocument) => {d.source = {};},
    (d: SceneDocument) => {delete d.source.progressionSourceVersion;},
    (d: SceneDocument) => {d.annotations.push({id: "invented", kind: "callout", targetIds: ["progression"], text: "999"});},
  ]) {
    const changed = clone(document); mutate(changed);
    atomic(changed, options(c), "whole persisted candidate attack");
    check(engine.validateFiniteProgressionSourceDocument(changed, c.question, c.problem, c.plan).length > 0, "parent read helper rejects forged payload");
  }
  for (const [mutate, name] of [
    [(ir: ProblemIR) => {ir.entities.push({id: "extra", kind: "body", evidenceFactIds: ["modelFact"]});}, "extra actual entity"],
    [(ir: ProblemIR) => {ir.expressions[0]!.root = {kind: "number", value: c.expected[0]!};}, "AST scalar coincidence"],
    [(ir: ProblemIR) => {ir.solveRequests.pop();}, "omitted actual request"],
    [(ir: ProblemIR) => {ir.representationIntents[0]!.kind = "graph";}, "false graph intent"],
    [(ir: ProblemIR) => {ir.facts[0]!.evidence.quote += "forged";}, "wrong actual evidence"],
    [(ir: ProblemIR) => {ir.solveRequests[0]!.resultBinding!.unit = "m";}, "wrong actual binding unit"],
    [(ir: ProblemIR) => {Object.assign(ir, {extraEntities: ["unmodeled"]});}, "extra fullIR list"],
    [(ir: ProblemIR) => {Object.assign(ir.expressions[0]!.root, {surrogateValue: c.expected[0]});}, "unknown AST field"],
    [(_ir: ProblemIR, p: TurnPlanV3) => {p.unknowns.push(clone(p.unknowns[0]!));}, "duplicate within unknowns"],
    [(_ir: ProblemIR, p: TurnPlanV3) => {p.derived.push(clone(p.derived[0]!));}, "duplicate within derived"],
    [(_ir: ProblemIR, p: TurnPlanV3) => {p.derived[0]!.symbol = "contradictory";}, "same-ID contradictory symbol"],
    [(_ir: ProblemIR, p: TurnPlanV3) => {p.derived[0]!.unit = "dimensionless";}, "same-ID contradictory unit"],
    [(_ir: ProblemIR, p: TurnPlanV3) => {p.derived[0]!.value += 1;}, "actual stale scalar"],
    [(_ir: ProblemIR, p: TurnPlanV3) => {p.derived[0]!.provenance = "assumed";}, "invalid actual role provenance"],
    [(_ir: ProblemIR, p: TurnPlanV3) => {p.derived[0]!.sign = p.derived[0]!.value > 0 ? "negative" : "positive";}, "invalid actual Plan sign"],
    [(_ir: ProblemIR, p: TurnPlanV3) => {p.derived[0]!.dependsOn = ["missing"];}, "invalid whole Plan dependency"],
    [(_ir: ProblemIR, p: TurnPlanV3) => {p.derived[0]!.uncertainty = 1;}, "uncertain scalar cannot be exact"],
    [(_ir: ProblemIR, p: TurnPlanV3) => {Object.assign(p, {trustedFlag: true});}, "unknown Plan flag"],
    [(_ir: ProblemIR, p: TurnPlanV3) => {Object.assign(p.unknowns[0]!, {value: c.expected[0]});}, "unknown role cannot smuggle scalar"],
    [(_ir: ProblemIR, p: TurnPlanV3) => {p.visualRequirement = "none";}, "actual visual opt-out"],
  ] as Array<[(ir: ProblemIR, p: TurnPlanV3) => void, string]>) rejectCaller(c, mutate, name);
  if (c.cumulativeFirst !== null) {
    rejectCaller(c, (_ir, p) => {p.derived[0]!.value = 1604;}, "printed false T20 option is not authority");
    rejectCaller(c, (_ir, p) => {p.derived[3]!.value = 35610;}, "printed false sum30 option is not authority");
  }
  if (c.plan.givens.length) rejectCaller(c, (_ir, p) => {p.givens[0]!.symbol = "rubbish";}, "source given role symbol mismatch");
}
// Explicit non-source-bound generic graphs use the existing operator contract.
function generic(operator: string, inputs: Record<string, unknown>): SceneDocument {
  return {schemaVersion: "scene-document/v2", visualDecision: {mode: "scene", reason: "explicit generic indexed values"}, source: {}, quantities: [], entities: [{id: "p", kind: "indexed_progression", role: "finite discrete generic table"}], constructions: [{id: "make_p", operator, inputs: {...inputs, origin: [0, 0], displayScale: 1}, outputs: ["p"]}], relations: [], assertions: [], annotations: [], requiredEntityIds: ["p"], revealGroups: [{id: "g", entityIds: ["p"], dependsOn: [], narrationCue: "show exact finite indexed values"}], teachingTimeline: []};
}
for (const [operator, inputs, expected] of [
  ["indexed_progression", {kind: "arithmetic", first: 3, difference: -2, indices: [1, 2, 3, 4]}, [3, 1, -1, -3]],
  ["progression_recover", {kind: "arithmetic", observations: [{index: 2, value: 1}, {index: 5, value: -5}, {index: 9, value: -13}], indices: [1, 2, 5, 9]}, [3, 1, -5, -13]],
  ["progression_insert", {kind: "geometric", first: 2, last: 8, insertions: 1, branch: "all_real"}, [2, 4, 8, 2, -4, 8]],
] as Array<[string, Record<string, unknown>, number[]]>) {
  const document = generic(operator, inputs), result = engine.compileSceneDocument(document);
  check(result.ok && result.renderScene, `existing ${operator}: ${JSON.stringify(result.report.issues)}`);
  const values = result.renderScene.primitives.filter(p => p.id.includes("_value_")).map(p => p.text);
  equal(values, expected.map(String), "generic normal renderer independent values");
  verifyLayout(result.renderScene);
  for (const mutate of [
    (d: SceneDocument) => {d.entities[0]!.kind = "polyline";},
    (d: SceneDocument) => {d.constructions[0]!.outputs.push("extra");},
    (d: SceneDocument) => {d.constructions[0]!.inputs.unknown = 99;},
    (d: SceneDocument) => {d.constructions[0]!.inputs.displayScale = 0;},
  ]) {const changed = clone(document); mutate(changed); atomic(changed, {}, "existing operator structural mutation");}
}
// A nonmetric table cannot act as Euclidean proof or feed metric descendants.
const nonmetric = generic("indexed_progression", {kind: "arithmetic", first: 3, difference: 2, indices: [1, 2, 3]});
nonmetric.assertions.push({id: "forged_distance", predicate: "equal_length", entities: ["p", "p"], expected: true, severity: "fatal"});
const metricProof = engine.compileSceneDocument(nonmetric);
check(!metricProof.ok && metricProof.renderScene === null && metricProof.report.issues.some(issue => issue.code === "invalid_nonmetric_assertion"), "display geometry cannot certify a progression value or distance");
const descendant = generic("indexed_progression", {kind: "arithmetic", first: 3, difference: 2, indices: [1, 2, 3]});
descendant.entities.push({id: "metric_child", kind: "point", role: "attempted metric projection"});
descendant.constructions.push({id: "make_metric_child", operator: "midpoint", inputs: {a: "p", b: [0, 0]}, outputs: ["metric_child"]});
descendant.requiredEntityIds.push("metric_child"); descendant.revealGroups[0]!.entityIds.push("metric_child");
const projected = engine.compileSceneDocument(descendant);
check(!projected.ok && projected.renderScene === null && projected.report.issues.some(issue => issue.message.includes("nonmetric")), "generic descendant cannot discard table metadata");
const caller = {...fixtures.cases[0]!, plan: fullPlan(fixtures.cases[0]!)};
const program = engine.finiteProgressionSourceProgram(caller.question, caller.problem, caller.plan);
check(program.status === "ok", "descriptor attack valid original");
let getterCalls = 0;
const accessorPlan = Object.defineProperty(clone(caller.plan), "derived", {get() {getterCalls++; return caller.plan.derived;}});
atomic(program.document, {sourceAuthority: {question: caller.question, problemIR: caller.problem, turnPlan: accessorPlan}}, "caller Plan accessor is not data");
const accessorDoc = Object.defineProperty(clone(program.document), "source", {get() {getterCalls++; return program.document.source;}});
atomic(accessorDoc, {}, "document source accessor is never self-authority");
const accessorAuthority = Object.defineProperty({problemIR: caller.problem, turnPlan: caller.plan}, "question", {get() {getterCalls++; return caller.question;}});
atomic(program.document, {sourceAuthority: accessorAuthority as CompileOptions["sourceAuthority"]}, "caller authority accessor is not data");
check(getterCalls === 0, "normal source guard never invokes these accessors");
const native = JSON.parse(readFileSync(new URL("./fixtures/w3-progression-source/native-sources.json", import.meta.url), "utf8")) as {cases: Array<{question_options_and_source_answer_verbatim: string; verbatim_question_block_sha256: string}>};
for (const c of native.cases) {
  equal(createHash("sha256").update(c.question_options_and_source_answer_verbatim).digest("hex"), c.verbatim_question_block_sha256, "frozen native OCR bytes");
  check(engine.readFiniteProgressionSource(c.question_options_and_source_answer_verbatim).status === "declined", "native source gaps remain gaps");
}
equal(fixtures.cases[3]!.expected, [1504, 10510, 3454, 35615], "corrected independent Q10 values, not printed false options");
const out = process.argv.indexOf("--output-dir");
if (out >= 0) {mkdirSync(process.argv[out + 1]!, {recursive: true}); writeFileSync(`${process.argv[out + 1]!}/progression-scenes.json`, JSON.stringify(scenes, null, 2));}
console.log(`W3 progression normal engine integration (source TS): ${checks} checks PASS; READY=0 accepted=0; actual student/native/lifecycle parent pending`);
