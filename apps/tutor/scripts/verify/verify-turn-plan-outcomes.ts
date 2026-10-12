/** Actual source planner-call -> stock run-JSON writer seam; no network/providers. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import ts from "typescript";
import { createFallbackTurnPlanV3, planTurnV3 } from "../../../../packages/tutor-core/src/planners/turnPlannerV3";
import type { TurnPlannerV3Options, TurnPlanRequestOutcome } from "../../../../packages/tutor-core/src/planners/turnPlannerV3";
import { createPlannerEvidence } from "../lecture-lab/plannerEvidence";

const appRoot = process.cwd();
const pipelineText = readFileSync(join(appRoot, "scripts/lecture-lab/lecturePipeline.ts"), "utf8");
const pipeline = ts.createSourceFile("lecturePipeline.ts", pipelineText, ts.ScriptTarget.Latest, true);
const lecture = pipeline.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "runLecture");
assert.ok(lecture?.body, "the actual lab entry point must exist");
const declarationName = (node: ts.Node, name: string) => ts.isVariableStatement(node) &&
  node.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name);
const initialization = lecture.body.statements.filter((node) => declarationName(node, "stages") || declarationName(node, "run"));
assert.equal(initialization.length, 2, "execute actual run initialization, not fabricated diagnostic fields");
const guarded = lecture.body.statements.find((node): node is ts.TryStatement => ts.isTryStatement(node));
assert.ok(guarded);
const begin = guarded.tryBlock.statements.findIndex((node) => declarationName(node, "turnPlanStartedAt"));
const end = guarded.tryBlock.statements.findIndex((node) => declarationName(node, "problemAuthorityPromise"));
assert.ok(begin >= 0 && end > begin, "the actual planner-to-selection source seam remains present");
let plannerBlock = guarded.tryBlock.statements.slice(begin, end).map((node) => node.getText(pipeline)).join("\n");

// In-memory source mutation: removing the actual lab observer must break saved evidence.
if (process.argv.includes("--mutate-lab-callback") || process.argv.includes("--mutate-lab-cap")) {
  const block = ts.createSourceFile("planner-block.ts", plannerBlock, ts.ScriptTarget.Latest, true);
  const transform = ts.transform(block, [(context) => (root) => {
    const visit: ts.Visitor = (node) => {
      if (process.argv.includes("--mutate-lab-callback") && ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) && node.name.text === "onRequestOutcome") return undefined;
      if (process.argv.includes("--mutate-lab-cap") && ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.LessThanToken && node.left.getText(block) === "run.turnPlanCallOutcomes.length" &&
        ts.isNumericLiteral(node.right) && node.right.text === "3") {
        return ts.factory.updateBinaryExpression(node, node.left, node.operatorToken, ts.factory.createNumericLiteral(999));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  plannerBlock = ts.createPrinter().printFile(transform.transformed[0]!);
  transform.dispose();
}

const generationText = readFileSync(join(appRoot, "features/tutor-session/lib/scene/diagramGeneration.ts"), "utf8");
const generation = ts.createSourceFile("diagramGeneration.ts", generationText, ts.ScriptTarget.Latest, true);
const helperNames = new Set(["selectBestAvailableTurnPlan", "requestedUnknownCoverage", "normalizeQuantityKey", "requestedResultFingerprint"]);
const selection = generation.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name && helperNames.has(node.name.text));
assert.equal(selection.length, 4, "use the actual unchanged plan selection implementation");
const deadline = generation.statements.find((node) => declarationName(node, "TURN_PLAN_DEADLINE_MS"));
assert.ok(deadline);
const deadlineText = deadline.getText(generation);

const writerText = readFileSync(join(appRoot, "scripts/lecture-lab/run.ts"), "utf8");
const writer = ts.createSourceFile("run.ts", writerText, ts.ScriptTarget.Latest, true);
const writes: ts.ExpressionStatement[] = [];
const visit = (node: ts.Node) => {
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "writeFileSync" &&
    node.expression.arguments[0]?.getText(writer).includes("/runs/${slug}.json")) writes.push(node);
  ts.forEachChild(node, visit);
};
visit(writer);
assert.equal(writes.length, 1, "execute the stock run-JSON writer exactly once per artifact");

const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const privateSentinel = "private-fixture-source-and-body";
const question = `Explain a public test concept. ${privateSentinel}`;
const plan = { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "none" };
const originalFetch = globalThis.fetch;
const directory = mkdtempSync(join(tmpdir(), "heytutor-turn-plan-outcomes-"));
mkdirSync(join(directory, "runs"));

async function main() { try {
  const actual = process.argv.includes("--built-package") ? await import("@heytutor/tutor-core") : { planTurnV3, createFallbackTurnPlanV3 };
  for (const planned of [false, true]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(
      planned ? plan : { ...plan, unknowns: [{ id: privateSentinel }] },
    ) } }] }));
    const slug = planned ? "planned" : "fallback";
    let diagnosticSink: ((outcome: TurnPlanRequestOutcome) => void) | undefined;
    const plannerPort = (input: string, options: TurnPlannerV3Options) => {
      diagnosticSink = options.onRequestOutcome;
      return actual.planTurnV3(input, options);
    };
    const context = createContext({
      exports: {}, Date, question, planTurnV3: plannerPort,
      createFallbackTurnPlanV3: actual.createFallbackTurnPlanV3, createPlannerEvidence,
      options: { origin: "http://planner.test", probeId: slug, arm: "current" },
      familiarity: "normal", fastMode: true, traceId: "public-test-trace", startedAt: Date.now(),
      scenePlannerDeadlineMs: 60_000, dsaClassification: { isDsa: false },
      plannerUrl: "http://planner.test", outDir: directory, slug,
      providerConfig: { provider: "test-only" }, executionConfig: {}, evaluationById: new Map(),
      probe: { id: slug }, svgPath: null, pngPath: null, writeFileSync,
    });
    const source = `${deadlineText}\n${selection.map((node) => node.getText(generation)).join("\n")}\n` +
      `(async () => { let turnPlan; ${initialization.map((node) => node.getText(pipeline)).join("\n")}\n` +
      `${plannerBlock}\n${writes[0]!.getText(writer)}\nreturn run; })()`;
    const run = await new Script(compile(source), { filename: "actual-lab-turn-plan-save-seam.cjs" }).runInContext(context);
    const saved = JSON.parse(readFileSync(join(directory, "runs", `${slug}.json`), "utf8"));
    assert.equal(saved.turnPlanStatus, planned ? "planned" : "fallback", "saved status reflects actual model admission, not HTTP success");
    assert.equal(saved.turnPlanCallOutcomes.length, planned ? 2 : 3, "actual lab callback reaches the stock saved record");
    assert.deepEqual(saved.turnPlanCallOutcomes, JSON.parse(JSON.stringify(run.turnPlanCallOutcomes)));
    assert.ok(saved.turnPlanCallOutcomes.every((outcome: { httpStatus: number; code: string }) =>
      outcome.httpStatus === 200 && outcome.code === (planned ? "accepted" : "plan_validation_failed")));
    assert.ok(!JSON.stringify(saved.turnPlanCallOutcomes).includes(privateSentinel), "new evidence excludes question/quantity/message/body text");
    assert.equal(saved.error, null, "observability does not turn a handled fallback into a runtime error");
    assert.ok(saved.turnPlanCallOutcomes.length <= 3);
    assert.ok(diagnosticSink);
    // Exercise the real caller's notification sink, not a replacement metadata collector.
    for (let index = 0; index < 10; index += 1) diagnosticSink(run.turnPlanCallOutcomes[0]);
    assert.equal(run.turnPlanCallOutcomes.length, 3, "the actual lab callback remains bounded even with excess notifications");
    assert.deepEqual(JSON.parse(readFileSync(join(directory, "runs", `${slug}.json`), "utf8")).turnPlanCallOutcomes,
      saved.turnPlanCallOutcomes, "late diagnostics do not mutate the already saved snapshot");
  }
  console.log("Lab TurnPlan source-to-saved outcome roundtrip passed: 2 scenarios.");
} finally {
  globalThis.fetch = originalFetch;
  rmSync(directory, { recursive: true, force: true });
} }

main().catch((error) => { console.error(error); process.exitCode = 1; });
