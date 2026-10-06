import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as source from "../../../../packages/scene-engine/src/index";
import * as built from "@heytutor/scene-engine";
import { parseStoredSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { sourceBoundPlanIssues } from "../../lib/scene/sourcePlanAdmission";
import { rawStoredTurnSourceIssues, sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";

// Frozen independent review inputs, including original request IDs and full IR.
interface Fixture { p: built.ProblemIR; plan: built.TurnPlanV3; d: built.SceneDocument }
function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(new URL(`./fixtures/w2-plan-reload/${name}.json`, import.meta.url), "utf8"));
}
const clone = structuredClone;
let checks = 0;
let failures = 0;
async function check(name: string, run: () => unknown) {
  checks++;
  try { await run(); console.log(JSON.stringify({ name, pass: true })); }
  catch (error) { failures++; console.error(JSON.stringify({ name, pass: false, error: String(error) })); }
}

function turn(x: Fixture, solverAuthority?: unknown): StoredTurn {
  return {
    id: "offline-plan-reload", question: x.p.question, rawResponse: "", orderIndex: 0,
    speedMultiplier: 1, traceId: null, sceneDocument: x.d,
    sceneArtifacts: { turnPlan: x.plan, problemIR: x.p, solverAuthority },
    visualStatus: "validated", sceneEngineVersion: null, validationReport: null,
    segments: [
      { id: "trusted", orderIndex: 0, narration: "", spokenText: "", audioUrl: null, durationMs: null, timings: null,
        command: serializeSegmentCommands([{ type: "DRAW_LINE", params: [500, 200, 600, 200], charPosition: 0, narrationBefore: "" }], { trustedDiagramGeometry: true }) },
      { id: "work", orderIndex: 1, narration: "", spokenText: "", audioUrl: null, durationMs: null, timings: null,
        command: serializeSegmentCommands([
          { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" },
          { type: "WRITE", params: [30, 40], text: "h=12 m", charPosition: 0, narrationBefore: "" },
          { type: "DRAW_LINE", params: [500, 200, 600, 200], charPosition: 0, narrationBefore: "" },
        ]) },
    ],
  };
}
function rejected(x: Fixture, cached: string) {
  const before = clone(x);
  const t = turn(x, { status: cached, issues: [] });
  assert.ok(sourceBoundPlanIssues(x.d, x.p.question, x.plan, x.p).some(issue => issue.severity === "fatal"));
  assert.ok(rawStoredTurnSourceIssues(x.d, t).some(issue => issue.severity === "fatal"));
  const read = sourceCheckedStoredTurn(t);
  assert.equal(read.visualStatus, "retry_required");
  assert.equal(read.segments[0]!.command, null);
  assert.deepEqual(parseStoredSegmentCommands(read.segments[1]!.command).map(command => command.type), ["CLEAR", "WRITE"]);
  assert.equal(restoreVerifiedPresentationFromTurn(t), null);
  assert.equal(restoreVerifiedPresentationFromTurn(read), null);
  assert.deepEqual(x, before, "admission must retain caller IR, unknowns and source roles unchanged");
}

async function main() {
  for (const [mode, api] of [["TS", source], ["ESM", built]] as const) {
    for (const name of ["full-contact", "original-foot", "mirror-concave", "mirror-convex", "lens-convex", "lens-concave"]) {
      await check(`${mode} ${name} correct original source/IR/plan restores`, async () => {
        const x = fixture(name), before = clone(x);
        assert.ok(api.validateTurnPlanV3(x.plan, x.p.question).valid);
        assert.ok(api.validateProblemIR(x.p, x.p.question).valid);
        assert.ok(api.compileSceneDocument(x.d, { sourceAuthority: { question: x.p.question, problemIR: x.p } }).ok);
        assert.deepEqual(sourceBoundPlanIssues(x.d, x.p.question, x.plan, x.p), []);
        assert.equal(sourceCheckedStoredTurn(turn(x, { status: "contradiction" })).visualStatus, "validated");
        assert.ok(restoreVerifiedPresentationFromTurn(turn(x)));
        const solver = await new api.LocalDeterministicSolverProvider().solve(x.p);
        assert.equal(api.verifyTurnPlanAgainstSolver(x.p, solver, x.plan, x.p.question).status,
          name.includes("mirror") || name.includes("lens") ? "not_applicable" : "verified");
        assert.deepEqual(x, before);
      });
    }
    for (const name of ["mirror-concave", "mirror-convex", "lens-convex", "lens-concave"]) {
      for (const mutation of ["sign", "given", "unknown-unit", "unknown-role", "invalid-plan"]) {
        for (const cached of ["verified", "contradiction", "not_applicable"]) {
          await check(`${mode} ${name} ${mutation} cached=${cached} rejects before ink`, () => {
            const x = fixture(name);
            if (mutation === "sign") x.plan.derived[0]!.value *= -1;
            if (mutation === "given") x.plan.givens[0]!.value = 999;
            if (mutation === "unknown-unit") x.plan.unknowns[0]!.unit = "V";
            if (mutation === "unknown-role") x.plan.unknowns[0]!.symbol = "f";
            if (mutation === "invalid-plan") x.plan.question = "A different question";
            x.d.source.sourceVerified = true;
            x.d.source.contactProblemVerified = true;
            rejected(x, cached);
          });
        }
      }
    }
    for (const mutation of ["wrong-value", "unknown-unit", "unknown-role", "binding-unit", "wrong-AST"]) {
      for (const cached of ["verified", "contradiction", "not_applicable"]) {
        await check(`${mode} numeric contact ${mutation} cached=${cached} rejects before ink`, () => {
          const x = fixture("full-contact");
          if (mutation === "wrong-value") x.plan.derived[0]!.value = 999;
          if (mutation === "unknown-unit") x.plan.unknowns[0]!.unit = "s";
          if (mutation === "unknown-role") x.plan.unknowns[0]!.symbol = "length";
          if (mutation === "binding-unit") x.p.solveRequests[0]!.resultBinding!.unit = "s";
          if (mutation === "wrong-AST") x.p.expressions[2]!.root = { kind: "number", value: 12 };
          rejected(x, cached);
        });
      }
    }
    await check(`${mode} unsupported old source is unchanged even with no valid plan`, () => {
      const x = fixture("original-foot");
      assert.deepEqual(sourceBoundPlanIssues(x.d, x.p.question, { invalid: true }, x.p), []);
      assert.deepEqual(sourceBoundPlanIssues(x.d, x.p.question, undefined, undefined), []);
      const t = turn(x); t.sceneArtifacts = null;
      assert.equal(sourceCheckedStoredTurn(t).visualStatus, "validated");
      assert.ok(restoreVerifiedPresentationFromTurn(t));
    });
    await check(`${mode} bounded legacy source without plan retains existing proof`, () => {
      const x = fixture("mirror-concave"), t = turn(x);
      t.sceneArtifacts = { problemIR: x.p };
      assert.deepEqual(sourceBoundPlanIssues(x.d, x.p.question, undefined, x.p), []);
      assert.equal(sourceCheckedStoredTurn(t).visualStatus, "validated");
      assert.ok(restoreVerifiedPresentationFromTurn(t));
    });
    await check(`${mode} raw forged quantity fails before normalization with correct plan`, () => {
      const x = fixture("mirror-concave");
      x.d.quantities.find(row => row.id === "v")!.value = 999;
      const t = turn(x);
      assert.ok(rawStoredTurnSourceIssues(x.d, t).some(issue => issue.severity === "fatal"));
      assert.equal(sourceCheckedStoredTurn(t).visualStatus, "retry_required");
      assert.equal(restoreVerifiedPresentationFromTurn(t), null);
    });
  }
  console.log(JSON.stringify({ checks, failures }));
  process.exitCode = failures ? 1 : 0;
}
void main();
