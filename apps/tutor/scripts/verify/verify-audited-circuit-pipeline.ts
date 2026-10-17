/** Exact synthetic captured formulation, replayed through the live solver boundary. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applySourceQuantityAuthority,
  groundStatedCircuitProblem,
  LocalDeterministicSolverProvider,
  reconcileTurnPlanWithSolver,
  type ProblemIR,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { planAndSolveProblemV1 } from "@heytutor/tutor-core";
import { refreshSolverAuthorityForPlan } from "../../features/tutor-session/lib/turn/refreshSolverAuthority";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";

async function main() {
  const problem: ProblemIR = JSON.parse(
    readFileSync(
      new URL("./fixtures/physics-audit/circuit-problem.json", import.meta.url),
      "utf8",
    ),
  );
  const fixture: { question: string; turnPlan: TurnPlanV3 } = JSON.parse(
    readFileSync(
      new URL("./fixtures/physics-audit/circuit.json", import.meta.url),
      "utf8",
    ),
  );
  const original = JSON.stringify(problem);
  const grounded = groundStatedCircuitProblem(problem);
  assert.deepEqual(grounded.entities.map(e => e.label), ["18 V", "R1=2Ω", "R2=6Ω", "R3=3Ω", "R4=18Ω"]);
  const ambiguous = structuredClone(problem);
  ambiguous.entities.find(e => e.id === "r3")!.evidenceFactIds = ["fR2"];
  assert.equal(groundStatedCircuitProblem(ambiguous).entities.find(e => e.id === "r3")?.label, "3 ohm resistor", "Wrong source occurrence cannot name a component");
  const duplicate = structuredClone(problem);
  duplicate.entities.push({...duplicate.entities.find(e => e.id === "r2")!,id:"copy_r2"});
  assert.equal(groundStatedCircuitProblem(duplicate).entities.find(e => e.id === "r2")?.label, "6 ohm resistor", "One source occurrence cannot discharge two body obligations");

  const repeated = structuredClone(problem);
  repeated.question = repeated.question.replace("6 ohm", "3 ohm");
  const repeatedFact = repeated.facts.find(f => f.id === "fR2")!;
  repeatedFact.statement = repeatedFact.statement.replace("6 ohm", "3 ohm");
  repeatedFact.evidence!.quote = "3 ohm";
  repeated.entities.find(e => e.id === "r2")!.label = "3 ohm resistor";
  assert.deepEqual(groundStatedCircuitProblem(repeated).entities.filter(e => ["r2", "r3"].includes(e.id)).map(e => e.label), ["R2=3Ω", "R3=3Ω"], "Repeated values retain distinct source occurrence identities");
  const arithmetic = await new LocalDeterministicSolverProvider().solve(
    problem,
  );
  assert.equal(
    arithmetic.status,
    "solved",
    "captured circuit arithmetic remains independently solvable",
  );
  let requests = 0;
  const authority = await planAndSolveProblemV1(
    fixture.question,
    fixture.turnPlan,
    {
      proxyUrl: "http://fixture.invalid/api/chat",
      timeoutMs: 5000,
      fetchImpl: async () => {
        requests++;
        return Response.json({ choices: [{ message: { content: original } }] });
      },
    },
  );
  assert(
    authority,
    "captured planner response must pass the actual live formulation boundary",
  );
  assert.equal(requests, 1, "deterministic correction needs no paid retry");
  const plan = applySourceQuantityAuthority(
    reconcileTurnPlanWithSolver(
      fixture.turnPlan,
      authority.problemIR,
      authority.solverResult,
    ),
    authority.problemIR,
    fixture.question,
  ).plan;
  const refreshed = refreshSolverAuthorityForPlan(
    authority,
    plan,
    fixture.question,
  );
  assert.equal(
    refreshed.audit.status,
    "verified",
    JSON.stringify(refreshed.audit.issues),
  );
  const resistance = plan.derived.find(q => q.symbol === "R_eq");
  assert.equal(resistance?.value, 8);
  const current = plan.derived.find(q => q.symbol === "I_total");
  assert.equal(current?.value, 2.25);
  const selected = selectProductionScene({
    question: fixture.question,
    turnPlan: plan,
    problemIR: authority.problemIR,
    policy: {
      preferPlanner: true,
      allowVerifiedSourceRecovery: true,
      allowedFigureSources: ["planner", "verified_recovery", "text_only"],
    },
  });
  assert(selected.representation, selected.reason);
  assert.equal(selected.representation.sceneDocument.constructions.filter(c => c.operator === "symbol" && c.inputs.symbol === "resistor").length, 4);
  const saved = await canonicalizeTurnSceneMetadata({question:fixture.question, sceneDocument:selected.representation.sceneDocument, visualStatus:selected.visualStatus,
    sceneArtifacts:{schemaVersion:"scene-artifacts/v3",turnPlan:plan,problemIR:authority.problemIR,solverResult:authority.solverResult,representationTier:selected.representation.tier,nonMetric:selected.representation.nonMetric,figureSource:selected.representation.figureSource,diagramResultStatus:"ready"},segments:[]});
  assert(saved.ok, saved.ok ? "saved" : saved.error);
  assert.equal(
    JSON.stringify(problem),
    original,
    "captured input stays immutable",
  );
  console.log(
    "PASS captured circuit pipeline: formulation → solved → source topology → reconciled → verified → drawn → saved",
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
