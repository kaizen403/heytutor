import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeProblemIRModelOutput, bindProblemIRToTurnPlan } from "../../../tutor-core/src/planners/problemPlannerV1";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import { applyStatedCircuitAuthority, readStatedCircuitProblemSource } from "../../src/ir/statedCircuitAuthority";
import { bindStatedCircuitProblem, checkStatedCircuitProblemBinding } from "../../src/ir/statedCircuitProblemBinding";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { applySourceQuantityAuthority } from "../../src/ir/sourceQuantityAuthority";

import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import { verifyTurnPlanAgainstSolver } from "../../src/ir/solverAuthority";
import type { TurnPlanV3, SceneArtifactsV3 } from "../../src/contracts/contractsV3";
import type { SceneDocument } from "../../src/types";
import { liveSceneSaveFailure } from "../../../../apps/tutor/lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../../../apps/tutor/lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../../../apps/tutor/lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../../../apps/tutor/features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type { StoredTurn } from "../../../../apps/tutor/lib/boards/boardsClient";

type Capture = { question: string; expected: { current_A: number; Req_ohm?: number }; canonicalPlan: TurnPlanV3; rawProblem: ProblemIR; normalizedProblem?: ProblemIR };
let failures = 0;
const originals = new Map<string, {capture: Capture; problem: ProblemIR; plan: TurnPlanV3; document: SceneDocument; artifacts: SceneArtifactsV3}>();
async function observeLifecycle(question: string, plan: TurnPlanV3, problem: ProblemIR, document: SceneDocument, artifacts: SceneArtifactsV3) {
  const live = liveSceneSaveFailure({document, question, turnPlan: plan, problemIR: problem, tier: "question_representation"});
  const saved = await canonicalizeTurnSceneMetadata({question, sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated", segments: []});
  const turn: StoredTurn = {id: "offline-ohm", question, rawResponse: "", orderIndex: 0, speedMultiplier: 1, traceId: null, segments: [], sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated", sceneEngineVersion: null, validationReport: null};
  const serialized = JSON.parse(JSON.stringify(turn)) as StoredTurn;
  return {live: live === null, save: saved.ok, read: sourceCheckedStoredTurn(serialized).visualStatus === "validated", restore: Boolean(restoreVerifiedPresentationFromTurn(serialized))};
}
async function lifecycle(question: string, plan: TurnPlanV3, problem: ProblemIR, document: SceneDocument, artifacts: SceneArtifactsV3, reject: boolean) {
  assert.deepEqual(await observeLifecycle(question, plan, problem, document, artifacts), {live: !reject, save: !reject, read: !reject, restore: !reject});
}

for (const name of ["single", "tree", "parallel"]) {
  const capture: Capture = JSON.parse(readFileSync(new URL(`./fixtures/w2-ohm-live-fix-20261006/w2-ohm-${name}.json`, import.meta.url), "utf8"));
  try {
    const planSnapshot = structuredClone(capture.canonicalPlan);
    const normalized = normalizeProblemIRModelOutput(capture.rawProblem, capture.question, capture.canonicalPlan);
    const validation = validateProblemIR(normalized, capture.question);
    assert.ok(validation.valid && validation.problem, JSON.stringify(validation));
    const problem = bindProblemIRToTurnPlan(validation.problem, capture.canonicalPlan);
    const snapshot = structuredClone(problem);
    for (const key of ["facts", "entities", "expressions", "constraints", "representationIntents", "solveRequests"] as const) assert.equal(problem[key].length, capture.rawProblem[key].length, `preserve all ${key}`);
    if (process.argv.includes("--capture-normalized")) {
      writeFileSync(new URL(`./fixtures/w2-ohm-live-fix-20261006/w2-ohm-${name}.json`, import.meta.url), JSON.stringify({...capture, normalizedProblem: problem}, null, 2) + "\n");
    } else if (capture.normalizedProblem) assert.deepEqual(problem, capture.normalizedProblem);
    assert.deepEqual(problem.entities.map(row => row.id), capture.rawProblem.entities.map((row: {id: string}) => row.id));
    console.log(`${name}: normalized whole IR; source=${Boolean(readStatedCircuitProblemSource(capture.question))}`);
    const binding = bindStatedCircuitProblem(capture.question, problem);
    assert.ok(binding, `${name}: actual full IR must bind before source scene admission`);
    assert.equal(binding.solution.sourceCurrent?.value, capture.expected.current_A);
    assert.deepEqual(binding.solution.resistors.map(row => row.current?.exact), name === "tree" ? ["2", "2/3", "4/3"] : name === "parallel" ? ["2", "2", "2"] : ["2"]);
    assert.deepEqual(binding.solution.resistors.map(row => row.voltage?.exact), name === "tree" ? ["6", "4", "4"] : name === "parallel" ? ["12", "12", "12"] : ["12"]);
    const obligations = checkVisualObligations(deriveVisualObligations(problem), binding.document, problem);
    assert.equal(obligations.satisfied, true, JSON.stringify(obligations));
    const compiled = compileSceneDocument(binding.document, {sourceAuthority: {question: capture.question, problemIR: problem}});
    assert.equal(compiled.ok, true, JSON.stringify(compiled.report.issues));
    const authority = applyStatedCircuitAuthority(capture.question, capture.canonicalPlan, { requireBoundClaims: true });
    assert.ok(authority);
    assert.equal(authority.plan.derived.find(row => row.id === "I")?.value, capture.expected.current_A, JSON.stringify(authority));
    assert.deepEqual(authority.plan.givens, capture.canonicalPlan.givens);
    assert.deepEqual(authority.plan.unknowns, capture.canonicalPlan.unknowns);
    assert.deepEqual(authority.plan.qualitativeClaims, capture.canonicalPlan.qualitativeClaims);
    for (const row of capture.canonicalPlan.derived) assert.ok(authority.plan.derived.some(other => other.id === row.id), `retain actual derived ID ${row.id}`);
    assert.deepEqual(capture.canonicalPlan, planSnapshot);
    const normalAuthority = applySourceQuantityAuthority(capture.canonicalPlan, problem, capture.question);
    assert.ok(normalAuthority.outcomes.some(row => row.topic === "physics|12|ohms-law-and-resistance"));
    assert.equal(normalAuthority.outcomes.some(row => row.declineFigure), false, JSON.stringify(normalAuthority));
    assert.deepEqual(normalAuthority.plan, authority.plan);
    const scene = synthesizeFamilyScene({ question: capture.question, turnPlan: authority.plan, problemIR: problem });
    assert.ok(scene);
    const solver = await new LocalDeterministicSolverProvider().solve(problem);
    assert.equal(solver.status, "solved", JSON.stringify(solver));
    const audit = verifyTurnPlanAgainstSolver(problem, solver, authority.plan, capture.question);
    assert.equal(audit.status, "verified", JSON.stringify(audit));
    const artifacts: SceneArtifactsV3 = {schemaVersion: "scene-artifacts/v3", turnPlan: authority.plan, problemIR: problem, solverResult: solver, solverAuthority: audit, representationTier: scene.tier, nonMetric: scene.nonMetric, candidates: [], selectedCandidateId: null, selectionReason: scene.reason, diagramResultStatus: "ready", proofObligations: [], budgets: {deadlineMs: 120000, planMs: 0, candidatesMs: 0}};
    await lifecycle(capture.question, authority.plan, problem, scene.document, artifacts, false);
    assert.equal(binding.problem, problem);
    assert.deepEqual(problem, snapshot);
    assert.equal(binding.factBindings.length, problem.facts.length);
    assert.equal(binding.entityBindings.length, problem.entities.length);
    assert.equal(binding.expressionBindings.length, problem.expressions.length);
    assert.equal(binding.solution.equivalentResistance.value, capture.expected.Req_ohm ?? 6);
    originals.set(name, {capture, problem, plan: authority.plan, document: scene.document, artifacts});
    console.log(`PASS ${name}`);
  } catch (error) { failures++; console.error(`FAIL ${name}`, error); }
}
assert.equal(failures, 0, `${failures} actual runtime cases declined`);


let negativeChecks = 0;
async function rejectIR(name: string, variant: string, mutate: (problem: ProblemIR) => void) {
  const original = originals.get(name)!;
  const problem = structuredClone(original.problem);
  mutate(problem);
  const snapshot = structuredClone(problem);
  assert.equal(bindStatedCircuitProblem(problem.question, problem), null, variant);
  assert.ok(checkStatedCircuitProblemBinding(problem.question, problem, original.document).length, variant);
  const document = structuredClone(original.document);
  document.source = {...document.source, question: problem.question, problemIR: problem};
  assert.equal(compileSceneDocument(document, {sourceAuthority: {question: problem.question, problemIR: problem}}).ok, false, variant);
  const artifacts = {...original.artifacts, problemIR: problem};
  await lifecycle(problem.question, original.plan, problem, document, artifacts, true);
  assert.deepEqual(problem, snapshot);
  negativeChecks++;
  console.log(`REJECT ${name}: ${variant} through compiler/live/save/read/restore`);
}
for (const name of originals.keys()) {
  await rejectIR(name, "negated given", p => { p.facts.find(row => row.kind === "given")!.statement += " and the circuit is open"; });
  await rejectIR(name, "missing ask", p => { p.facts = p.facts.filter(row => row.kind !== "requested"); p.solveRequests = []; });
  await rejectIR(name, "coincident result literal", p => { p.expressions[0]!.root = {kind: "number", value: originals.get(name)!.capture.expected.current_A}; });
  await rejectIR(name, "wrong request unit", p => { p.solveRequests[0]!.resultBinding!.unit = "V"; });
  await rejectIR(name, "wrong result role", p => { p.solveRequests[0]!.resultBinding!.symbol = "I1"; });
  await rejectIR(name, "foreign evidence", p => { p.facts[0]!.evidence.quote = "invented resistor"; });
  await rejectIR(name, "unsupported constraint", p => { p.constraints.push({id: "unsupported", kind: "perpendicular", entityIds: p.entities.map(row => row.id), evidenceFactIds: [p.facts[0]!.id]}); });
  await rejectIR(name, "unsupported intent", p => { p.representationIntents[0]!.kind = "graph"; });
  await rejectIR(name, "missing expression source owner", p => { p.expressions[0]!.evidenceFactIds = p.expressions[0]!.evidenceFactIds.filter(id => id !== p.facts[0]!.id); });
  for (const [variant, mutate] of [
    ["changed source value", (d: SceneDocument) => { d.quantities.find(row => row.id === "circuit_source_R1")!.value = 99; }],
    ["changed source unit", (d: SceneDocument) => { d.quantities.find(row => row.id === "circuit_source_R1")!.unit = "mΩ"; }],
    ["changed source sign", (d: SceneDocument) => { d.quantities.find(row => row.id === "circuit_source_battery")!.value = -12; }],
    ["omitted required body", (d: SceneDocument) => { d.requiredEntityIds = d.requiredEntityIds.filter(id => id !== "R1"); }],
    ["omitted reveal", (d: SceneDocument) => { for (const group of d.revealGroups) group.entityIds = group.entityIds.filter(id => id !== "R1"); }],
    ["foreign annotation", (d: SceneDocument) => { d.annotations.find(row => row.id === "circuit_dimension_R1")!.text = "99 Ω"; }],
    ["shorted resistor", (d: SceneDocument) => { const r = d.constructions.find(row => row.outputs[0] === "R1")!; r.inputs.end = r.inputs.start; }],
  ] as const) {
    const original = originals.get(name)!, document = structuredClone(original.document);
    mutate(document);
    assert.ok(checkStatedCircuitProblemBinding(original.capture.question, original.problem, document).length, variant);
    assert.equal(compileSceneDocument(document, {sourceAuthority: {question: original.capture.question, problemIR: original.problem}}).ok, false, variant);
    await lifecycle(original.capture.question, original.plan, original.problem, document, original.artifacts, true);
    negativeChecks++;
  }
}
await rejectIR("tree", "repeated scalar has wrong positioned owner", p => { p.entities[0]!.evidenceFactIds = ["fR3"]; });
await rejectIR("tree", "nested resistor has wrong connection alias", p => { p.entities[2]!.label = "series 3 Ω resistor"; });
await rejectIR("single", "unparsed quantity in role alias", p => { p.entities[1]!.label = "unseen Ω resistor"; });
await rejectIR("parallel", "duplicate member ordinal", p => { p.entities[1]!.label = "resistor 1"; });
await rejectIR("parallel", "missing physical member", p => { const id = p.entities.pop()!.id; p.constraints = []; p.representationIntents[0]!.entityIds = p.representationIntents[0]!.entityIds.filter(row => row !== id); });
await rejectIR("parallel", "wrong identical count", p => { p.facts[0]!.statement = p.facts[0]!.statement.replace("Three", "Two"); });
await rejectIR("parallel", "count operand is not a solved result", p => { p.expressions[0]!.root = {kind: "binary", operator: "/", left: {kind: "number", value: 12}, right: {kind: "number", value: 2}}; });
await rejectIR("single", "equal scalars of different dimensions are ambiguous", p => {
  p.question = p.question.replace("12 V", "6 V");
  for (const fact of p.facts) { fact.statement = fact.statement.replace("12 V", "6 V"); fact.evidence.quote = fact.evidence.quote.replace("12 V", "6 V"); }
  p.expressions[0]!.root = {kind: "binary", operator: "/", left: {kind: "number", value: 6}, right: {kind: "number", value: 6}};
  Object.assign(p, normalizeProblemIRModelOutput(p, p.question, originals.get("single")!.plan));
  assert.equal(validateProblemIR(p, p.question).valid, true, "ambiguity control is a complete valid IR");
});

// Source-only parameter controls; these do not claim new captured full-IR cases.
for (const [question, resistance, current] of [
  ["A 26 V cell is connected across a 13 ohm resistor. Find the current.", "13", "2"],
  ["A 13 ohm resistor is connected across a 26 V cell. Find the current.", "13", "2"],
  ["Two identical resistors each of 6 Ω are connected in series across a 12 V battery. Find the current drawn from the battery.", "12", "1"],
  ["Two equal resistors each of 6 Ω are connected in parallel across a 12 V battery. Find the current drawn from the battery.", "3", "4"],
  ["Four equal resistors each of 6 Ω are connected in series across a 12 V battery. Find the current drawn from the battery.", "24", "1/2"],
  ["A 5 Ω resistor is connected in series with a parallel combination of 8 Ω and 4 Ω resistors across a 20 V battery. Find the current from the battery.", "23/3", "60/23"],
] as const) {
  const source = readStatedCircuitProblemSource(question);
  assert.ok(source, question);
  assert.equal(source.solution.equivalentResistance.exact, resistance);
  assert.equal(source.solution.sourceCurrent?.exact, current);
}
assert.equal(readStatedCircuitProblemSource("Four equal resistors each of 6 Ω are connected in parallel across a 12 V battery. Find the current drawn from the battery."), null, "retained four-parallel generator gap");
for (const question of [
  "A -12 V battery is connected across a 6 Ω resistor. Find the current through the resistor.",
  "A 12 V battery is connected across a -6 Ω resistor. Find the current through the resistor.",
  "A 12 V battery is connected across a 0 Ω resistor. Find the current through the resistor.",
  "Three similar resistors each of 6 Ω are connected in parallel across a 12 V battery. Find the current drawn from the battery.",
  "Three identical resistors each of 6 Ω are connected in series and parallel across a 12 V battery. Find the current drawn from the battery.",
  "A 12 V battery is connected across a 6 Ω resistor with an extra resistor. Find the current through the resistor.",
  originals.get("single")!.capture.question + " ".repeat(8001),
]) assert.equal(readStatedCircuitProblemSource(question), null, question.slice(0, 200));
console.log(`PASS 3 actual captures and ${negativeChecks} rejection mutations before whole-source boundary audit; offline lifecycle only`);

// Retain actual failing shared-boundary evidence instead of weakening the oracle.
const boundaryGaps: Array<{name: string; variant: string; failure: string; observed: unknown}> = [];
for (const name of originals.keys()) {
  for (const [variant, mutate] of [
    ["extra whole-source obligation", (p: ProblemIR) => { p.question = p.question.replace("Find", "The resistor is bypassed by a wire. Find"); }],
    ["extra source ask", (p: ProblemIR) => { p.question = p.question.replace(/\.$/, " and the power."); }],
  ] as const) {
    try { await rejectIR(name, variant, mutate); }
    catch (error) {
      const original = originals.get(name)!, problem = structuredClone(original.problem); mutate(problem);
      const document = structuredClone(original.document); document.source = {...document.source, question: problem.question, problemIR: problem};
      const observed = {compiler: compileSceneDocument(document, {sourceAuthority: {question: problem.question, problemIR: problem}}).ok,
        ...await observeLifecycle(problem.question, original.plan, problem, document, {...original.artifacts, problemIR: problem})};
      boundaryGaps.push({name, variant, failure: String(error), observed}); console.error(`SHARED BOUNDARY RED ${name}: ${variant}: ${JSON.stringify(observed)}`);
    }
  }
}
if (process.argv.includes("--report")) writeFileSync(process.argv[process.argv.indexOf("--report") + 1]!, JSON.stringify({actualCaptures: originals.size, negativeChecks, boundaryGaps}, null, 2) + "\n");
assert.equal(boundaryGaps.length, 0, "Parent-owned source admission must enforce whole-question declines; retained red evidence");
