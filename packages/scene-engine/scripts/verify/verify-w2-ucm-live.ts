/** Actual closed planner captures and independent physical oracles. No services. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProblemIRModelOutput } from "../../../tutor-core/src/planners/problemPlannerV1";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import { verifyTurnPlanAgainstSolver } from "../../src/ir/solverAuthority";
import { applySourceQuantityAuthority } from "../../src/ir/sourceQuantityAuthority";
import { validateTurnPlanV3, type TurnPlanV3 } from "../../src/contracts/contractsV3";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneSourceAuthority } from "../../src/ir/sceneSourceAuthority";
import { uniformCircularProblemSourceIssues } from "../../src/physics/uniformCircularIdentity";
import { readUniformCircularRuntimeContract } from "../../src/physics/uniformCircularAuthority";
import { readUniformCircularSource } from "../../src/physics/uniformCircularSource";
import { uniformCircularNumericDocument } from "../../src/physics/uniformCircularScene";
import { liveSceneSaveFailure, sceneSaveAdmissionFailure } from "../../../../apps/tutor/lib/scene/sceneSaveAdmission";
import { rawStoredTurnSourceIssues, sourceCheckedStoredTurn } from "../../../../apps/tutor/lib/scene/storedSceneSource";
import { restoreVerifiedDiagramFromTurn } from "../../../../apps/tutor/features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type { SceneDocument } from "../../src/types";

interface Oracle { r: number; v: number; omega: number; a_c: number; requested: Record<string, number>; sense: string | null }
interface Case { id: string; question: string; rawIR: unknown; plan: TurnPlanV3; oracle: Oracle }
interface Capture { question: string; rawIRs: unknown[]; canonicalPlan: TurnPlanV3; originalVisualStatus: string; persistedProblemIR: unknown; persistedSolverResult: unknown }
const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/w2-ucm-live-20261006/${name}.json`, import.meta.url), "utf8"));
const actualOracles: Oracle[] = [
  { r: 50, v: 20, omega: .4, a_c: 8, requested: { sAc: 8, sT: 5 * Math.PI }, sense: null },
  { r: .8, v: .8 * Math.PI, omega: Math.PI, a_c: .8 * Math.PI ** 2, requested: { sSpeed: .8 * Math.PI, sAccel: .8 * Math.PI ** 2 }, sense: null },
  { r: 12, v: 6, omega: .5, a_c: 3, requested: { sOmega: .5, sAc: 3 }, sense: "clockwise" },
];
const cases: Case[] = ["w2-ucm-car", "w2-ucm-stone", "w2-ucm-clockwise"].map((id, index) => {
  const capture = fixture<Capture>(id);
  assert.equal(capture.originalVisualStatus, "retry_required");
  assert.equal(capture.persistedProblemIR, null); assert.equal(capture.persistedSolverResult, null);
  assert.equal(capture.rawIRs.length, 1);
  return { id, question: capture.question, rawIR: capture.rawIRs[0], plan: capture.canonicalPlan, oracle: actualOracles[index]! };
});
cases.push(...fixture<Case[]>("independent-oracles"));
const cloneJSONB = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, row) => row && typeof row === "object" && !Array.isArray(row) ? Object.fromEntries(Object.entries(row).reverse()) : row));
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= 2e-14 * Math.max(1, Math.abs(expected)), `${actual} differs from independent ${expected}`);
let groups = 0; const failures: string[] = [];
function check(name: string, run: () => void) { groups++; try { run(); console.log(`PASS ${name}`); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); console.log(`FAIL ${name}`); } }

function normalized(c: Case, raw: unknown = c.rawIR, plan = c.plan): ProblemIR {
  const result = validateProblemIR(normalizeProblemIRModelOutput(raw, c.question, plan), c.question);
  assert.ok(result.valid && result.problem, JSON.stringify(result.issues)); return result.problem;
}
function artifact(document: SceneDocument, c: Case, plan: TurnPlanV3, problemIR: ProblemIR) {
  return { question: c.question, sceneDocument: document, sceneArtifacts: { turnPlan: plan, problemIR, representationTier: "qualitative_verified" as const } };
}
function admission(document: SceneDocument, c: Case, plan: TurnPlanV3, problemIR: ProblemIR) {
  return { document, question: c.question, turnPlan: plan, problemIR, tier: "qualitative_verified" as const };
}
function expectIRDecline(c: Case, original: ProblemIR, document: SceneDocument, mutate: (p: ProblemIR) => void) {
  const bad = structuredClone(original); mutate(bad);
  assert.equal(validateProblemIR(bad, c.question).valid, true, "negative must retain a valid complete caller IR");
  assert.ok(uniformCircularProblemSourceIssues(document, bad).some(issue => issue.severity === "fatal"));
  assert.equal(synthesizeFamilyScene({ question: c.question, turnPlan: c.plan, problemIR: bad }), null);
  const compiled = compileSceneDocument(document, { sourceAuthority: { question: c.question, problemIR: bad } });
  assert.equal(compiled.ok, false); assert.equal(compiled.renderScene, null);
  assert.ok(liveSceneSaveFailure(admission(document, c, c.plan, bad)));
  assert.ok(sceneSaveAdmissionFailure(admission(document, c, c.plan, bad)));
  assert.ok(rawStoredTurnSourceIssues(document, artifact(document, c, c.plan, bad)).some(issue => issue.severity === "fatal"));
  assert.equal(restoreVerifiedDiagramFromTurn(artifact(document, c, c.plan, bad)), null);
}

for (const c of cases) {
  const problem = normalized(c);
  const authority = applySourceQuantityAuthority(c.plan, problem, c.question);
  const solved = await new LocalDeterministicSolverProvider().solve(problem);
  check(`${c.id}: full production normalization, IDs and independent solver`, () => {
    assert.equal(validateTurnPlanV3(c.plan, c.question).valid, true);
    const raw = c.rawIR as Record<string, Array<{ id: string }>>;
    for (const key of ["facts", "entities", "expressions", "constraints", "representationIntents", "solveRequests"] as const) {
      assert.deepEqual(problem[key].map(row => row.id), raw[key]!.map(row => row.id), `${key} must not be dropped, renamed or replaced`);
    }
    assert.equal(solved.status, "solved"); assert.equal(authority.outcomes.some(row => row.declineFigure), false);
    assert.equal(verifyTurnPlanAgainstSolver(problem, solved, authority.plan, c.question).status, "verified");
    for (const [requestId, value] of Object.entries(c.oracle.requested)) close(solved.values.find(row => row.requestId === requestId)!.approximate as number, value);
    const source = readUniformCircularSource(c.question); assert.ok(source?.status === "numeric");
    assert.equal(source.sense, c.oracle.sense); close(source.radiusM, c.oracle.r); close(source.speed, c.oracle.v); close(source.angularSpeed, c.oracle.omega); close(source.centripetalAcceleration, c.oracle.a_c);
  });
  const scene = synthesizeFamilyScene({ question: c.question, turnPlan: authority.plan, problemIR: problem });
  check(`${c.id}: normal family with actual plan and full IR`, () => assert.ok(scene, "actual source joins must draw through the normal family path"));
  if (!scene) continue;
  const document = scene.document;
  check(`${c.id}: whole offline live/save/JSONB/read/restore`, () => {
    assert.equal(document.visualDecision.mode, "scene");
    for (const [id, value] of [["r", c.oracle.r], ["v", c.oracle.v], ["omega", c.oracle.omega], ["a_c", c.oracle.a_c]] as const) {
      const quantity = document.quantities.find(row => row.id === id)!;
      close((quantity.value as number) * (id === "r" ? ({ m: 1, cm: .01, mm: .001, km: 1000 }[quantity.unit as "m" | "cm" | "mm" | "km"] ?? 1) : 1), value);
    }
    assert.deepEqual(validateSceneSourceAuthority(document, c.question, problem), []);
    assert.equal(compileSceneDocument(document, { sourceAuthority: { question: c.question, problemIR: problem } }).ok, true);
    assert.equal(liveSceneSaveFailure(admission(document, c, authority.plan, problem)), null);
    assert.equal(sceneSaveAdmissionFailure(admission(document, c, authority.plan, problem)), null);
    const stored = cloneJSONB(artifact(document, c, authority.plan, problem));
    assert.deepEqual(rawStoredTurnSourceIssues(stored.sceneDocument, stored), []);
    const restored = restoreVerifiedDiagramFromTurn(stored); assert.ok(restored);
    assert.deepEqual(restored, restoreVerifiedDiagramFromTurn(artifact(document, c, authority.plan, problem)));
    // Exercise the read sanitiser itself with no DB or runtime dependency.
    const turn = { ...stored, id: "offline", orderIndex: 0, rawResponse: "", speedMultiplier: 1, createdAt: 0, segments: [], traceId: null, sceneEngineVersion: null, validationReport: null, visualStatus: "validated" as const };
    assert.equal(sourceCheckedStoredTurn(turn).visualStatus, "validated");
  });
  check(`${c.id}: stale bound values corrected without deleting any obligations`, () => {
    const stale = structuredClone(c.plan); stale.derived.forEach(row => { row.value = 999; });
    const repair = applySourceQuantityAuthority(stale, problem, c.question);
    assert.equal(repair.outcomes.some(row => row.declineFigure), false);
    assert.deepEqual(repair.plan.unknowns, stale.unknowns);
    assert.deepEqual(repair.plan.givens.map(row => row.id), stale.givens.map(row => row.id));
    assert.deepEqual(repair.plan.derived.map(row => row.id), stale.derived.map(row => row.id));
    assert.equal(verifyTurnPlanAgainstSolver(problem, solved, repair.plan, c.question).status, "verified");
    assert.ok(synthesizeFamilyScene({ question: c.question, turnPlan: repair.plan, problemIR: problem }));
  });
  check(`${c.id}: small stale rounding cannot remain authoritative`, () => {
    const stale = structuredClone(c.plan); stale.derived[0]!.value += .1;
    const repaired = applySourceQuantityAuthority(stale, problem, c.question);
    assert.equal(repaired.outcomes.some(row => row.declineFigure), false);
    close(repaired.plan.derived[0]!.value, Object.values(c.oracle.requested)[0]!);
    assert.equal(synthesizeFamilyScene({ question: c.question, turnPlan: stale, problemIR: problem }), null);
  });
  const negatives: Array<[string, (p: ProblemIR) => void]> = [
    ["wrong actor name", p => { p.entities[0]!.label = "other body"; }],
    ["requested fact cannot own body", p => { p.entities[0]!.evidenceFactIds = [p.facts.find(f => f.kind === "requested")!.id]; }],
    ["hidden extra actor", p => { p.entities.push({ ...p.entities[0]!, id: "intruder", label: "second body" }); }],
    ["duplicate physical identity", p => { p.entities.push({ ...p.entities[0]!, id: "duplicate" }); }],
    ["hidden disconnected topology", p => { p.constraints.push({ id: "hidden", kind: "connected", entityIds: p.entities.map(e => e.id), evidenceFactIds: [p.facts[0]!.id] }); }],
    ["hidden equation", p => { p.constraints.push({ id: "hidden", kind: "equation", leftExpressionId: p.expressions[0]!.id, rightExpressionId: p.expressions[1]!.id, evidenceFactIds: [p.facts[0]!.id] }); }],
    ["hidden expression", p => { p.expressions.push({ ...p.expressions[0]!, id: "hidden", root: { kind: "number", value: 12345 } }); }],
    ["same-value constant is not a law AST", p => { p.expressions[0]!.root = { kind: "number", value: Object.values(c.oracle.requested)[0]! }; }],
    ["same-value cancellation is not source authority", p => { p.expressions[0]!.root = { kind: "binary", operator: "+", left: p.expressions[0]!.root, right: { kind: "number", value: 0 } }; }],
    ["wrong rate operand", p => { const root = p.expressions[0]!.root; assert.equal(root.kind, "binary"); if (root.kind === "binary") root.right = { kind: "number", value: 999 }; }],
    ["requested evidence cannot ground formula", p => { p.expressions[0]!.evidenceFactIds = [p.facts.find(f => f.kind === "requested")!.id]; }],
    ["wrong request role at same value", p => { p.solveRequests[0]!.resultBinding!.symbol = "F_c"; p.solveRequests[0]!.resultBinding!.unit = "N"; }],
    ["wrong request units", p => { p.solveRequests[0]!.resultBinding!.unit = "kg"; }],
    ["request without source binding", p => { delete p.solveRequests[0]!.resultBinding; }],
    ["lost request", p => { p.solveRequests.pop(); }],
    ["hidden request", p => { p.solveRequests.push({ ...p.solveRequests[0]!, id: "hiddenRequest" }); }],
    ["unsupported intent", p => { p.representationIntents[0]!.kind = "free_body"; }],
    ["wrong source role in fact statement", p => { p.facts[0]!.statement = "The mass is given"; }],
    ["wrong numeral in given statement", p => { p.facts[0]!.statement="The radius is 99999 m"; }],
  ["hidden requested fact statement", p => { p.facts.find(row=>row.kind==="requested")!.statement="Find the kinetic energy"; }],
  ["invented premise in fact statement", p => { p.facts[0]!.statement = "A second body exerts a force"; }],
  ];
  for (const [name, mutate] of negatives) check(`${c.id}: ${name} declines every boundary`, () => expectIRDecline(c, problem, document, mutate));
  for (const [name, mutate] of [
    ["wrong scalar", (d: SceneDocument) => { d.quantities.find(q => q.id === "v")!.value = 999; }],
    ["wrong unit", (d: SceneDocument) => { d.quantities.find(q => q.id === "r")!.unit = "s"; }],
    ["wrong owner label", (d: SceneDocument) => { d.entities.find(e => e.id === "path")!.label = "other path"; }],
    ["hidden relation", (d: SceneDocument) => { d.relations.push({ id: "hidden", predicate: "parallel", entities: ["radius", "accel"] }); }],
  ] as const) check(`${c.id}: markerless ${name}`, () => {
    const wrong = structuredClone(document); mutate(wrong); delete wrong.source.archetype; delete wrong.source.slotSources;
    const compiled = compileSceneDocument(wrong, { sourceAuthority: { question: c.question, problemIR: problem } });
    assert.equal(compiled.ok, false); assert.equal(compiled.renderScene, null);
    assert.ok(liveSceneSaveFailure(admission(wrong, c, authority.plan, problem)));
    assert.ok(sceneSaveAdmissionFailure(admission(wrong, c, authority.plan, problem)));
    assert.equal(restoreVerifiedDiagramFromTurn(artifact(wrong, c, authority.plan, problem)), null);
  });
  for (const [name, mutate] of [
    ["hidden unsupported numeric", (p: TurnPlanV3) => { p.derived.push({ id: "force", symbol: "F", unit: "N", value: c.oracle.a_c, provenance: "derived" }); }],
    ["same value wrong role", (p: TurnPlanV3) => { p.derived[0]!.symbol = "v_B"; p.derived[0]!.unit = "m/s"; p.derived[0]!.value = c.oracle.v; }],
    ["unknown unsupported unit", (p: TurnPlanV3) => { p.unknowns[0]!.unit = "kg"; }],
    ["unknown unsupported role", (p: TurnPlanV3) => { p.unknowns.push({ id: "force", symbol: "F", unit: "N" }); }],
  ] as const) check(`${c.id}: ${name} stays in plan and declines`, () => {
    const wrong = structuredClone(c.plan); mutate(wrong);
    const result = applySourceQuantityAuthority(wrong, problem, c.question);
    assert.equal(result.outcomes.some(row => row.declineFigure), true);
    assert.deepEqual(result.plan.unknowns, wrong.unknowns);
    assert.deepEqual(result.plan.derived.map(row => row.id), wrong.derived.map(row => row.id));
    assert.equal(synthesizeFamilyScene({ question: c.question, turnPlan: result.plan, problemIR: problem }), null);
  });
}

const car = cases[0]!;
for (const [name, question] of [
  ["unknown request", car.question.replace("revolution.", "revolution and its kinetic energy.")],
  ["hidden condition", car.question.replace("Find", "The road is rough. Find")],
  ["third body", car.question.replace("Find", "A bus also moves on the track. Find")],
  ["unsupported unit", car.question.replace("20 m/s", "20 mph")],
  ["extra rate", car.question.replace("Find", "Its speed is 30 m/s. Find")],
  ["contradictory sense", car.question.replace("moves", "moves clockwise and anticlockwise")],
] as const) check(`whole-source ${name} declines`, () => {
  const source = readUniformCircularSource(question);
  assert.equal(synthesizeFamilyScene({ question, turnPlan: { ...car.plan, question } }), null);
  if (source?.status === "numeric") {
    assert.equal(readUniformCircularRuntimeContract(question)?.status, "declined");
    const doc = uniformCircularNumericDocument(question, source);
    assert.equal(compileSceneDocument(doc).ok, false);
    assert.ok(liveSceneSaveFailure({ document: doc, question, turnPlan: { ...car.plan, question }, tier: "qualitative_verified" }));
    assert.equal(restoreVerifiedDiagramFromTurn({ question, sceneDocument: doc, sceneArtifacts: { turnPlan: { ...car.plan, question } } }), null);
  }
});
check("clockwise source sense cannot be reversed by a submitted construction", () => {
  const c = cases[2]!; const p = normalized(c); const scene = synthesizeFamilyScene({ question: c.question, turnPlan: c.plan, problemIR: p }); assert.ok(scene);
  const doc = structuredClone(scene.document); const rotation = doc.constructions.find(row => row.operator === "rotational_motion"); assert.ok(rotation);
  assert.equal(typeof rotation.inputs.angularVelocity, "number");
  rotation.inputs.angularVelocity = -Number(rotation.inputs.angularVelocity); delete doc.source.archetype; delete doc.source.slotSources;
  assert.equal(compileSceneDocument(doc, { sourceAuthority: { question: c.question, problemIR: p } }).ok, false);
  assert.ok(liveSceneSaveFailure(admission(doc, c, c.plan, p)));
  assert.equal(restoreVerifiedDiagramFromTurn(artifact(doc, c, c.plan, p)), null);
});
const clockwise = cases[2]!;
check("clockwise fact cannot claim anticlockwise on the same exact source quote", () => {
  const problem = normalized(clockwise); const scene = synthesizeFamilyScene({ question: clockwise.question, turnPlan: clockwise.plan, problemIR: problem }); assert.ok(scene);
  expectIRDecline(clockwise, problem, scene.document, p => { p.facts.find(row => row.id === "fClockwise")!.statement = "body moves anticlockwise"; });
});
// A concrete parent seam remains outside this worker's app/central-guard scope.
const carProblem = normalized(car); const carPlan = applySourceQuantityAuthority(car.plan, carProblem, car.question).plan;
const carScene = synthesizeFamilyScene({ question: car.question, turnPlan: carPlan, problemIR: carProblem });
if (carScene) {
  const wrong = structuredClone(carPlan); wrong.unknowns.push({ id: "extraForce", symbol: "F", unit: "N" });
  console.log("PARENT_SEAM", JSON.stringify({
    case: "extra plan-only force obligation", familyDeclined: synthesizeFamilyScene({ question: car.question, turnPlan: wrong, problemIR: carProblem }) === null,
    liveFailure: liveSceneSaveFailure(admission(carScene.document, car, wrong, carProblem)), saveFailure: sceneSaveAdmissionFailure(admission(carScene.document, car, wrong, carProblem)),
    rawReadIssues: rawStoredTurnSourceIssues(carScene.document, artifact(carScene.document, car, wrong, carProblem)), restoreAdmitted: restoreVerifiedDiagramFromTurn(artifact(carScene.document, car, wrong, carProblem)) !== null
  }));
}
console.log(`${groups} groups; ${failures.length} failures`);
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
