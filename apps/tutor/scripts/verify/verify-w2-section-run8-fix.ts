/** Actual run8 responses plus independent complete-source/IR trust controls.
 * Offline admission seams only: this gate never calls a provider or database. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as source from "../../../../packages/scene-engine/src/index";
import * as built from "../../../../packages/scene-engine/dist/index.js";
import { normalizeProblemIRModelOutput, bindProblemIRToTurnPlan } from "../../../../packages/tutor-core/src/planners/problemPlannerV1";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type { StoredTurn } from "../../lib/boards/boardsClient";

type EngineApi = Pick<typeof source,
  "LocalDeterministicSolverProvider" | "verifyTurnPlanAgainstSolver" | "compileSceneDocument"
  | "validateProblemIR" | "validateTurnPlanV3" | "readSectionFormulaSource" | "synthesizeFamilyScene"
  | "checkVisualObligations" | "deriveVisualObligations" | "sectionFormulaScene">;
type Fixture = { question: string; problem: source.ProblemIR | null; plan: source.TurnPlanV3; oracle: number[] };
type Capture = { name: string; question: string; rawIR: unknown; runtimeIR: source.ProblemIR; canonicalPlan: source.TurnPlanV3; oracle: number[] };
const captureFile = new URL("../../../../packages/scene-engine/scripts/verify/fixtures/w2-section-run8-actual-fullir.json", import.meta.url);
const captures = (JSON.parse(readFileSync(captureFile, "utf8")) as { captures: Capture[] }).captures;
let cases = 0, seamChecks = 0;

async function boundaries(api: EngineApi, fixture: Fixture, document: source.SceneDocument, accepted: boolean, label: string) {
  const { question, problem, plan } = fixture;
  const solver = problem ? await new api.LocalDeterministicSolverProvider().solve(problem) : null;
  const audit = problem && solver ? api.verifyTurnPlanAgainstSolver(problem, solver, plan, question) : null;
  const artifacts: source.SceneArtifactsV3 = {
    schemaVersion: "scene-artifacts/v3", turnPlan: plan, problemIR: problem, solverResult: solver, solverAuthority: audit,
    representationTier: "exact_verified", nonMetric: false, candidates: [], selectedCandidateId: null,
    selectionReason: "run8 section offline gate", diagramResultStatus: "ready", proofObligations: [],
    budgets: { deadlineMs: 120000, planMs: 0, candidatesMs: 0 },
  };
  const turn: StoredTurn = {
    id: "offline-run8", question, rawResponse: "", orderIndex: 0, speedMultiplier: 2, traceId: null,
    segments: [], sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated",
    sceneEngineVersion: null, validationReport: null,
  };
  const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated", segments: [] });
  const flags = [
    api.compileSceneDocument(document, { sourceAuthority: { question, problemIR: problem } }).ok,
    liveSceneSaveFailure({ document, question, turnPlan: plan, problemIR: problem, tier: "exact_verified" }) === null,
    saved.ok, sourceCheckedStoredTurn(turn).visualStatus === "validated", restoreVerifiedPresentationFromTurn(turn) !== null,
  ];
  assert.deepEqual(flags, Array<boolean>(5).fill(accepted), `${label}: compiler/live/save/read/restore`);
  if (accepted && audit) assert.equal(audit.status, "verified", `${label}: actual solver audit`);
  if (accepted && saved.ok) assert.deepEqual(saved.value.sceneArtifacts?.turnPlan, plan, `${label}: save preserves the actual Plan`);
  seamChecks += flags.length; cases++;
}

async function positive(api: EngineApi, fixture: Fixture, label: string) {
  const before = structuredClone(fixture);
  if (fixture.problem) assert.equal(api.validateProblemIR(fixture.problem, fixture.question).valid, true, label);
  assert.equal(api.validateTurnPlanV3(fixture.plan, fixture.question).valid, true, label);
  const reading = api.readSectionFormulaSource(fixture.question);
  assert.equal(reading.status, "ok", label);
  if (reading.status === "ok") assert.deepEqual([reading.source.point.x, reading.source.point.y], fixture.oracle, `${label}: independent coordinate oracle`);
  const scene = api.synthesizeFamilyScene({ question: fixture.question, turnPlan: fixture.plan, problemIR: fixture.problem });
  assert.ok(scene, `${label}: fresh scene`); assert.equal(scene.tier, "exact_verified");
  assert.ok(scene.document.constructions.some(row => row.operator === "section_point"));
  if (fixture.problem) {
    assert.equal(api.checkVisualObligations(api.deriveVisualObligations(fixture.problem), scene.document).satisfied, true);
    assert.equal(scene.document.entities.find(row => row.label === "AB")?.kind, "line");
    assert.ok(scene.document.assertions.some(row => row.id === "section_on_source_line"));
  }
  await boundaries(api, fixture, scene.document, true, label);
  assert.deepEqual(fixture, before, `${label}: caller input immutable`);
  return scene.document;
}

async function negativeIR(api: EngineApi, fixture: Fixture, doc: source.SceneDocument, label: string, mutate: (ir: source.ProblemIR) => void) {
  const bad = structuredClone(fixture); assert.ok(bad.problem); mutate(bad.problem);
  assert.equal(api.validateProblemIR(bad.problem, bad.question).valid, true, `${label}: semantic control must retain a valid schema`);
  assert.equal(api.sectionFormulaScene(bad.question, bad.problem), null, label);
  assert.equal(api.synthesizeFamilyScene({ question: bad.question, turnPlan: bad.plan, problemIR: bad.problem }), null, label);
  await boundaries(api, bad, doc, false, label);
}

function factQuote(ir: source.ProblemIR, id: string, quote: string) {
  const fact = ir.facts.find(row => row.id === id)!;
  const start = ir.question.indexOf(quote); assert.ok(start >= 0);
  fact.evidence = { source: "question", start, end: start + quote.length, quote };
}

const holdouts = [
  { name: "internal-zero-x", a: [-2, 7], b: [3, -3], m: 2, n: 3, mode: "internal", oracle: [0, 3] },
  { name: "internal-zero-y", a: [7, -2], b: [-3, 3], m: 2, n: 3, mode: "internal", oracle: [3, 0] },
  { name: "external-negative", a: [-2, 7], b: [3, -3], m: 2, n: 3, mode: "external", oracle: [-12, 27] },
  { name: "external-zero", a: [2, -7], b: [3, -9], m: 2, n: 3, mode: "external", oracle: [0, -3] },
  { name: "internal-decimal", a: [-1.5, 2.25], b: [4.5, -.75], m: 1, n: 3, mode: "internal", oracle: [0, 1.5] },
] as const;
function independent(c: typeof holdouts[number]): Fixture {
  const capture = captures.find(row => row.name === "external")!;
  const problem = structuredClone(capture.runtimeIR), plan = structuredClone(capture.canonicalPlan);
  const question = `Find the point P which divides the line segment joining A(${c.a.join(",")}) and B(${c.b.join(",")}) ${c.mode}ly in the ratio ${c.m}:${c.n}.`;
  problem.question = question; plan.question = question;
  const quotes = { fA: `A(${c.a.join(",")})`, fB: `B(${c.b.join(",")})`, fRatio: `${c.mode}ly in the ratio ${c.m}:${c.n}`, fP: question.slice(0, question.indexOf(" in the ratio")) };
  const statements = { fA: `Point A has coordinates (${c.a.join(",")})`, fB: `Point B has coordinates (${c.b.join(",")})`, fRatio: `${c.mode} division ratio is ${c.m}:${c.n}`, fP: `Find point P dividing segment ${c.mode}ly` };
  for (const fact of problem.facts) { const id = fact.id as keyof typeof quotes; fact.statement = statements[id]; factQuote(problem, id, quotes[id]); }
  const values = [...c.a, ...c.b, c.m, c.n];
  for (const [i, row] of plan.givens.entries()) { row.value = values[i]!; row.sourceText = i < 2 ? quotes.fA : i < 4 ? quotes.fB : quotes.fRatio; }
  const number = (value: number): source.ExpressionNodeIR => ({ kind: "number", value });
  const binary = (operator: "+" | "-" | "*" | "/", left: source.ExpressionNodeIR, right: source.ExpressionNodeIR): source.ExpressionNodeIR => ({ kind: "binary", operator, left, right });
  const sign = c.mode === "external" ? "-" : "+";
  for (const axis of [0, 1]) {
    problem.expressions[axis]!.root = binary("/", binary(sign, binary("*", number(c.m), number(c.b[axis]!)), binary("*", number(c.n), number(c.a[axis]!))), binary(sign, number(c.m), number(c.n)));
    plan.derived[axis]!.value = c.oracle[axis]!; plan.derived[axis]!.sourceText = `Independent coordinate oracle ${c.oracle[axis]}`;
  }
  plan.lawIds = [`${c.mode}_section_formula`];
  plan.assumptions = ["Cartesian plane coordinates", `${c.mode} division ${c.m}:${c.n}`];
  plan.qualitativeClaims = [{ id: "independent", claim: `P=(${c.oracle.join(",")})`, expected: `${c.mode} division ${c.m}:${c.n}`, relatedQuantityIds: ["px", "py"] }];
  return { question, problem, plan, oracle: [...c.oracle] };
}

async function main() {
  for (const [name, api] of [["TS", source], ["ESM", built]] as const) {
    const anonymous = JSON.parse(readFileSync(new URL("../../../../packages/scene-engine/scripts/verify/fixtures/w2-section-matrix/section-sf3-actual-full-ir.json", import.meta.url), "utf8")) as source.ProblemIR;
    const anonymousScene = api.synthesizeFamilyScene({ question: anonymous.question, problemIR: anonymous }); assert.ok(anonymousScene, `${name}/captured anonymous command`);
    const anonymousDoc = anonymousScene.document;
    assert.equal(api.compileSceneDocument(anonymousDoc, { sourceAuthority: { question: anonymous.question, problemIR: anonymous } }).ok, true);
    for (const statement of ["Find the coordinates of the dividing point internally", "Find coordinates of point Z", "Find the coordinates of the dividing point and the midpoint"]) {
      const bad = structuredClone(anonymous); bad.facts.find(row => row.id === "fFind")!.statement = statement;
      assert.equal(api.validateProblemIR(bad, bad.question).valid, true);
      assert.equal(api.sectionFormulaScene(bad.question, bad), null, `${name}/anonymous/${statement}`);
      assert.equal(api.compileSceneDocument(anonymousDoc, { sourceAuthority: { question: bad.question, problemIR: bad } }).ok, false);
    }
    for (const capture of captures) {
      const checked = api.validateProblemIR(normalizeProblemIRModelOutput(capture.rawIR, capture.question, capture.canonicalPlan), capture.question);
      assert.ok(checked.problem); assert.deepEqual(bindProblemIRToTurnPlan(checked.problem, capture.canonicalPlan), capture.runtimeIR, `${name}/${capture.name}: complete actual reconstruction`);
      const fixture: Fixture = { question: capture.question, problem: capture.runtimeIR, plan: capture.canonicalPlan, oracle: capture.oracle };
      const doc = await positive(api, fixture, `${name}/actual-${capture.name}`);
      await negativeIR(api, fixture, doc, `${name}/${capture.name}/hiddenfact`, ir => { ir.facts.push({ ...ir.facts[0]!, id: "hidden", statement: "P has speed 7" }); ir.representationIntents[0]!.evidenceFactIds.push("hidden"); });
      await negativeIR(api, fixture, doc, `${name}/${capture.name}/unused-fact`, ir => { ir.facts.push({ ...ir.facts[0]!, id: "unused" }); });
      const requestId = capture.name === "internal" ? "fFind" : capture.name === "external" ? "fP" : "fMid";
      const statements = capture.name === "midpoint" ? ["midpoint Z of segment AB", "midpoint P of segment AC", "midpoint P of segment BA", "midpoint P of segment AB internally", "midpoint P of segment AB and find ratio 9:1", "Find midpoint P of segment AC"] : [
        `Find point P dividing segment ${capture.name === "internal" ? "externally" : "internally"}`,
        "Find coordinates of point Z", "Find ratio 9:1", "Find coordinates of point P and the midpoint of AB", "Find point P and the coordinates of point Z",
      ];
      for (const statement of statements) await negativeIR(api, fixture, doc, `${name}/${capture.name}/${statement}`, ir => { ir.facts.find(row => row.id === requestId)!.statement = statement; });
      if (capture.name === "midpoint") {
        for (const statement of ["x-coordinate of A is 6", "y-coordinate of A is -4", "x-coordinate of A is -4 and P is the midpoint", "x-coordinate of B is -4"]) await negativeIR(api, fixture, doc, `${name}/axis/${statement}`, ir => { ir.facts[0]!.statement = statement; });
        for (const quote of ["midpoint P", "A(-4,6) and B(8,-2)", "joining A(-4,6) and B(8,-2)", "A(-4,6)"]) await negativeIR(api, fixture, doc, `${name}/midpoint-line/${quote}`, ir => { factQuote(ir, "fMid", quote); });
        await negativeIR(api, fixture, doc, `${name}/midpoint-given-role`, ir => { ir.facts.find(row => row.id === "fMid")!.kind = "given"; });
      }
      for (const suffix of [" and find the midpoint of the line segment.", " and calculate the coordinates of the midpoint.", " and find the ratio.", " and find the point which divides the segment internally."]) {
        for (const withIR of [true, false]) {
          const bad = structuredClone(fixture); bad.question += suffix; bad.plan.question = bad.question;
          if (withIR && bad.problem) { bad.problem.question = bad.question; bad.problem.facts.push({ id: "extraAsk", kind: "requested", statement: suffix.trim(), evidence: { source: "question", start: fixture.question.length, end: bad.question.length, quote: suffix } }); bad.problem.representationIntents[0]!.evidenceFactIds.push("extraAsk"); assert.equal(api.validateProblemIR(bad.problem, bad.question).valid, true); } else bad.problem = null;
          assert.equal(api.readSectionFormulaSource(bad.question).status, "declined");
          assert.equal(api.synthesizeFamilyScene({ question: bad.question, turnPlan: bad.plan, problemIR: bad.problem }), null);
          const submitted = structuredClone(doc); submitted.source.question = bad.question;
          await boundaries(api, bad, submitted, false, `${name}/${capture.name}/composite/${withIR}/${suffix}`);
        }
      }
    }
    for (const holdout of holdouts) {
      const fixture = independent(holdout), doc = await positive(api, fixture, `${name}/${holdout.name}/fullIR`);
      await positive(api, { ...fixture, problem: null }, `${name}/${holdout.name}/source-only`);
      await negativeIR(api, fixture, doc, `${name}/${holdout.name}/foreign-request`, ir => { ir.facts.find(row => row.id === "fP")!.statement = "Find coordinates of point Z"; });
      await negativeIR(api, fixture, doc, `${name}/${holdout.name}/literal-formula`, ir => { ir.expressions[0]!.root = { kind: "number", value: holdout.oracle[0] }; });
    }
    const question = "In what ratio does P(1,1) divide the segment from A(2,3) to B(5,9)?";
    const reading = api.readSectionFormulaSource(question); assert.equal(reading.status, "ok");
    if (reading.status === "ok") { assert.equal(reading.source.mode, "external"); assert.equal(reading.source.ratio, 1 / 4); }
    const doc = api.sectionFormulaScene(question); assert.ok(doc); assert.equal(api.compileSceneDocument(doc, { sourceAuthority: { question, problemIR: null } }).ok, true);
  }
  console.log(`PASS ${cases} complete-source/actual-fullIR cases; ${seamChecks} compiler/live/save/read/restore checks in source TS/public ESM; no native lifecycle credit`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
