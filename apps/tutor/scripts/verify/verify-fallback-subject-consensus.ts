/** Rejected-plan policy metadata through the actual planner and both consumers; no providers. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import ts from "typescript";
import * as planner from "../../../../packages/tutor-core/src/planners/turnPlannerV3";
import type { TurnPlannerV3Options, TurnPlanRequestOutcome } from "../../../../packages/tutor-core/src/planners/turnPlannerV3";
import { createPlannerEvidence } from "../lecture-lab/plannerEvidence";
import { liveDiagramStrategyDecision, type DiagramStrategyDecision } from "../../features/tutor-session/lib/scene/diagramStrategy";
import { labStrategyDecision } from "../lecture-lab/productionLabProfile";
import { parseDiagramSubject, type DiagramSubject } from "../../../../packages/tutor-core/src/planners/diagramSubject";
import { isConceptLessonQuestion } from "../../../../packages/tutor-core/src/llm/reasoningEffort";

const question = "Explain a public test concept.";
const privateSentinel = "private-rejected-quantity-source-and-body";
const plan = { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "none" };
const rejected = { ...plan,
  givens: [{ id: "input", symbol: "a", value: 2, unit: "m", provenance: "given", sourceText: privateSentinel }],
  unknowns: [{ id: privateSentinel, symbol: "x" }],
  derived: [{ id: "discarded", symbol: "b", value: 7, unit: "m", provenance: "derived", sourceText: privateSentinel, dependsOn: ["input"] }],
};
const response = (subject: unknown) => Response.json({ choices: [{ message: {
  content: JSON.stringify({ ...rejected, subject }),
} }] });

const sourceFile = (path: string) => ts.createSourceFile(path, readFileSync(join(process.cwd(), path), "utf8"), ts.ScriptTarget.Latest, true);
const declares = (node: ts.Node, name: string) => ts.isVariableStatement(node) && node.declarationList.declarations.some(
  (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name);
const generation = sourceFile("features/tutor-session/lib/scene/diagramGeneration.ts");
const selectionNames = new Set(["selectBestAvailableTurnPlan", "requestedUnknownCoverage", "normalizeQuantityKey", "requestedResultFingerprint", "turnPlanNeedsNumericAuthority"]);
const selection = generation.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name && selectionNames.has(node.name.text));
assert.equal(selection.length, 5, "execute the real plan selector and numeric-authority decision");
const deadline = generation.statements.find((node) => declares(node, "TURN_PLAN_DEADLINE_MS"));
assert.ok(deadline);
const deadlineText = deadline.getText(generation);
const liveSource = sourceFile("features/tutor-session/hooks/turn/useQuestionHandler.ts");
const liveBlocks: ts.Block[] = [];
const findLiveBlock = (node: ts.Node) => {
  if (ts.isBlock(node) && node.statements.some((statement) => declares(statement, "plannedTurn"))) liveBlocks.push(node);
  ts.forEachChild(node, findLiveBlock);
};
findLiveBlock(liveSource);
assert.equal(liveBlocks.length, 1, "use the actual live planner-to-selection block");
const liveBlock = liveBlocks[0]!;
const liveBegin = liveBlock.statements.findIndex((node) => declares(node, "turnPlanStartedAt"));
const liveEnd = liveBlock.statements.findIndex((node) => declares(node, "evaluatedVisualNeed"));
assert.ok(liveBegin >= 0 && liveEnd > liveBegin);
const currentTurnGuard = liveSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "awaitCurrentTurn");
assert.ok(currentTurnGuard);
const currentTurnGuardText = currentTurnGuard.getText(liveSource);
const labSource = sourceFile("scripts/lecture-lab/lecturePipeline.ts");
const labLecture = labSource.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "runLecture");
assert.ok(labLecture?.body);
const labInitialization = labLecture.body.statements.filter((node) => declares(node, "stages") || declares(node, "run"));
assert.equal(labInitialization.length, 2);
const labTry = labLecture.body.statements.find((node): node is ts.TryStatement => ts.isTryStatement(node));
assert.ok(labTry);
const labBegin = labTry.tryBlock.statements.findIndex((node) => declares(node, "turnPlanStartedAt"));
const labEnd = labTry.tryBlock.statements.findIndex((node) => declares(node, "assessment"));
const labSubject = labTry.tryBlock.statements.find((node) => declares(node, "classifiedSubject"));
assert.ok(labBegin >= 0 && labEnd > labBegin && labSubject);
const labStatements = labTry.tryBlock.statements.slice(labBegin, labEnd);
const labSubjectIndex = labTry.tryBlock.statements.indexOf(labSubject);
const labPickerIndex = labTry.tryBlock.statements.findIndex((node) => declares(node, "pickerDecision"));
assert.ok(labPickerIndex > labSubjectIndex);
const labPickerText = labTry.tryBlock.statements.slice(labSubjectIndex, labPickerIndex + 1).map((node) => node.getText(labSource)).join("\n");
const strategyCalls = (source: ts.SourceFile, name: string) => {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls.map((node) => node.getText(source));
};
// Skip live's initial pre-planning decision; exercise both the picker and final scene gate.
const liveStrategyCalls = strategyCalls(liveSource, "liveDiagramStrategyDecision").slice(1);
const labStrategyCalls = strategyCalls(labSource, "labStrategyDecision");
assert.equal(liveStrategyCalls.length, 2);
assert.equal(labStrategyCalls.length, 2);

interface ConsumerResult {
  subject: DiagramSubject;
  planned: boolean;
  turnPlan: { givens: unknown[]; unknowns: unknown[]; derived: unknown[] };
  outcomes: TurnPlanRequestOutcome[];
  decisions: DiagramStrategyDecision[];
}

function consumerBlock(statements: readonly ts.Statement[], source: ts.SourceFile, lane: "live" | "lab"): string {
  const text = statements.map((node) => node.getText(source)).join("\n");
  if (!process.argv.includes(`--mutate-${lane}-callback`)) return text;
  const block = ts.createSourceFile("consumer-block.ts", text, ts.ScriptTarget.Latest, true);
  let mutations = 0;
  const transformed = ts.transform(block, [(context) => (root) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "onRequestOutcome") {
        mutations += 1;
        return undefined;
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  assert.equal(mutations, 1, "mutation removes the actual consumer callback");
  const mutated = ts.createPrinter().printFile(transformed.transformed[0]!);
  transformed.dispose();
  return mutated;
}

async function runLiveConsumer(strictSubjects = ["physics"]): Promise<ConsumerResult> {
  let sink: TurnPlannerV3Options["onRequestOutcome"];
  const context = createContext({ ...planner, exports: {}, Date, DOMException, AbortController, isConceptLessonQuestion,
    question, plannerUrl: "http://planner.test", sessionId: undefined, turnTraceId: undefined,
    abortController: new AbortController(), recentConversation: "", fastModeRef: { current: false },
    billed: { diagramStrategy: "current", diagramStrictSubjects: strictSubjects }, isCurrentTurn: () => true,
    liveDiagramStrategyDecision, chemistryLane: false, gate: { chemistryLane: false },
    codeLesson: null, dsaClassification: { isDsa: false },
    tel: { span: () => ({ end() {} }), meta() {}, mark() {} },
    planAndSolveProblemV1: () => { throw new Error("rejected plans cannot start numeric authority"); },
    planTurnV3: (input: string, options: TurnPlannerV3Options) => {
      sink = options.onRequestOutcome;
      return planner.planTurnV3(input, options);
    },
  });
  const code = `${deadlineText}\n${selection.map((node) => node.getText(generation)).join("\n")}\n` +
    `${currentTurnGuardText}\n(async () => { let turnPlan; let turnPlanMs; let diagramSubject = "other"; let diagramStrategySubject = "other";\n` +
    `${consumerBlock(liveBlock.statements.slice(liveBegin, liveEnd), liveSource, "live")}\n` +
    `return { subject: diagramSubject, planned: plannedTurn !== null, turnPlan, outcomes: typeof turnPlanOutcomes === "undefined" ? [] : turnPlanOutcomes, decisions: [${liveStrategyCalls.join(",\n")}] }; })()`;
  const result: ConsumerResult = await new Script(ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText).runInContext(context);
  if (sink && result.outcomes[0]) {
    for (let index = 0; index < 10; index += 1) sink(result.outcomes[0]);
    assert.equal(result.outcomes.length, 3, "live outcome collection remains bounded");
  }
  return result;
}

async function runLabConsumer(strictSubjects = ["physics"]): Promise<ConsumerResult> {
  let sink: TurnPlannerV3Options["onRequestOutcome"];
  const context = createContext({ ...planner, exports: {}, Date, question, createPlannerEvidence, isConceptLessonQuestion,
    labStrategyDecision, parseDiagramSubject, pickerGate: { chemistryLane: false }, gate: { chemistryLane: false },
    options: { origin: "http://planner.test", arm: "current", productionStrictSubjects: strictSubjects },
    familiarity: "normal", fastMode: false, traceId: "public-test-trace", startedAt: Date.now(),
    scenePlannerDeadlineMs: 60_000, dsaClassification: { isDsa: false }, plannerUrl: "http://planner.test",
    planAndSolveProblemV1: () => { throw new Error("rejected plans cannot start numeric authority"); },
    planTurnV3: (input: string, options: TurnPlannerV3Options) => {
      sink = options.onRequestOutcome;
      return planner.planTurnV3(input, options);
    },
  });
  const code = `${deadlineText}\n${selection.map((node) => node.getText(generation)).join("\n")}\n` +
    `(async () => { let turnPlan; ${labInitialization.map((node) => node.getText(labSource)).join("\n")}\n` +
    `${consumerBlock(labStatements, labSource, "lab")}\n${labPickerText}\n` +
    `return { subject: classifiedSubject, planned: run.turnPlanStatus === "planned", turnPlan, outcomes: run.turnPlanCallOutcomes, decisions: [pickerDecision, ${labStrategyCalls[1]}] }; })()`;
  const result: ConsumerResult = await new Script(ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText).runInContext(context);
  assert.ok(sink);
  for (let index = 0; index < 10; index += 1) sink(result.outcomes[0]!);
  assert.equal(result.outcomes.length, 3, "lab outcome collection remains bounded");
  return result;
}

async function main() {
  const nativeFetch = globalThis.fetch;
  try {
    let requests = 0;
    const outcomes: TurnPlanRequestOutcome[] = [];
    globalThis.fetch = async () => { requests += 1; return response("physics"); };
    const result = await planner.planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: 1000,
      classifySubject: true, onRequestOutcome: (outcome) => outcomes.push(outcome) });
    assert.equal(result, null, "subject metadata must never admit a rejected plan");
    assert.equal(requests, 3, "subject preservation adds no model/classifier request");
    assert.deepEqual(outcomes.map((outcome) => "subject" in outcome ? outcome.subject : undefined),
      ["physics", "physics", "physics"], "each rejected attempt preserves opted-in policy subject");
    assert.ok(outcomes.every(({ code }) => code === "plan_validation_failed"));
    assert.ok(!JSON.stringify(outcomes).includes(privateSentinel), "policy outcomes never expose rejected content");
    assert.equal(planner.subjectFromRejectedTurnPlanOutcomes(outcomes), "physics");
    const unchanged = JSON.stringify(outcomes);
    assert.equal(planner.subjectFromRejectedTurnPlanOutcomes(Object.freeze(outcomes)), "physics");
    assert.equal(JSON.stringify(outcomes), unchanged, "consensus never mutates observer-owned records");
    const live = await runLiveConsumer();
    assert.equal(live.subject, "physics", "live fallback keeps unanimous rejected subject metadata");
    assert.equal(live.planned, false);
    assert.deepEqual(JSON.parse(JSON.stringify(live.turnPlan.givens)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(live.turnPlan.unknowns)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(live.turnPlan.derived)), []);
    const lab = await runLabConsumer();
    assert.equal(lab.subject, "physics", "lab fallback keeps unanimous rejected subject metadata");
    assert.equal(lab.planned, false);
    assert.deepEqual(JSON.parse(JSON.stringify(lab.turnPlan.givens)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(lab.turnPlan.unknowns)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(lab.turnPlan.derived)), []);
    for (const fallback of [live, lab]) for (const decision of fallback.decisions) {
      assert.equal(decision.strategy, "current", "unanimous rejected physics remains metadata, not strict strategy authority");
      assert.equal(decision.selectionOrder, "current", "fallback keeps the current figure selection order");
      assert.equal(decision.usePickedExamples, false, "fallback metadata adds no example picker or its wait");
    }
    assert.deepEqual(JSON.parse(JSON.stringify(live.decisions)), JSON.parse(JSON.stringify(lab.decisions)),
      "live and production lab keep identical fallback strategy decisions");
    for (const consume of [runLiveConsumer, runLabConsumer]) {
      const cases: { subjects: unknown[]; expected: DiagramSubject }[] = [
        { subjects: ["maths", "maths", "maths"], expected: "maths" },
        { subjects: ["chemistry", "chemistry", "chemistry"], expected: "chemistry" },
        { subjects: ["physics", "maths", "physics"], expected: "other" },
        { subjects: ["physics", "physics", "maths"], expected: "other" },
        { subjects: ["physics", undefined, "physics"], expected: "other" },
        { subjects: ["physics", privateSentinel, "physics"], expected: "other" },
        { subjects: ["other", "other", "other"], expected: "other" },
      ];
      for (const { subjects, expected } of cases) {
        let calls = 0;
        globalThis.fetch = async () => response(subjects[calls++]);
        const result = await consume();
        assert.equal(result.subject, expected, "each real consumer requires unanimous non-other subject across initial lanes and retry");
        assert.equal(result.planned, false);
        assert.equal(calls, 3);
        assert.ok(!JSON.stringify(result.outcomes).includes(privateSentinel), "invalid subject strings never escape the allowlisted enum");
      }
      for (const failedResponse of [() => Response.json({}, { status: 429 }),
        () => Response.json({ choices: [{ message: { content: "{invalid json}" } }] }),
        () => { throw new Error(privateSentinel); }]) {
        let calls = 0;
        globalThis.fetch = async () => calls++ === 1 ? failedResponse() : response("physics");
        assert.equal((await consume()).subject, "other", "HTTP, malformed-content or transport error cannot provide fallback policy");
      }
      globalThis.fetch = async () => response("physics");
      assert.equal((await consume([])).subject, "other", "off ignores unsolicited subject on rejected plans");
      let calls = 0;
      globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify(
        calls++ === 0 ? { ...plan, subject: "maths" } : { ...rejected, subject: "physics" },
      ) } }] });
      const accepted = await consume();
      assert.equal(accepted.planned, true);
      assert.equal(accepted.subject, "maths", "rejected peer metadata never replaces an accepted plan's subject");
      assert.ok(accepted.decisions.every((decision) => decision.strategy === "current"), "accepted out-of-scope maths remains current");
      assert.equal(calls, 2);
      const originalClock = Date.now;
      let clock = 10_000;
      Date.now = () => clock;
      calls = 0;
      globalThis.fetch = async () => {
        if (++calls === 2) clock += 20_000;
        return response("physics");
      };
      try {
        const noRetry = await consume();
        assert.equal(noRetry.subject, "physics", "actual exhausted-budget path preserves the rejected initial pair's consensus");
        assert.equal(calls, 2, "subject recovery never adds a retry after the existing budget expired");
      } finally { Date.now = originalClock; }
    }
    const initialPair = outcomes.slice(0, 2);
    assert.equal(planner.subjectFromRejectedTurnPlanOutcomes(initialPair), "physics", "completed rejected initial pair can qualify when no retry ran");
    for (const incomplete of [[], outcomes.slice(0, 1), [outcomes[0]!, outcomes[0]!], [outcomes[0]!, outcomes[2]!]]) {
      assert.equal(planner.subjectFromRejectedTurnPlanOutcomes(incomplete), "other", "missing or duplicated initial lanes fail closed");
    }
    for (const code of ["accepted", "http_error", "response_json_failed", "content_missing", "plan_json_missing", "plan_json_invalid",
      "plan_processing_failed", "timeout", "cancelled", "transport_failed"] satisfies TurnPlanRequestOutcome["code"][]) {
      assert.equal(planner.subjectFromRejectedTurnPlanOutcomes([initialPair[0]!, { ...initialPair[1]!, code }]), "other",
        `${code} is not evidence that both complete plans were rejected`);
    }
    assert.equal(planner.subjectFromRejectedTurnPlanOutcomes([{ ...initialPair[0]!, phase: "audit" }, initialPair[1]!]), "other");
    assert.equal(planner.subjectFromRejectedTurnPlanOutcomes([...outcomes, outcomes[2]!]), "other", "excess notifications cannot manufacture consensus");
    assert.equal(planner.subjectFromRejectedTurnPlanOutcomes(initialPair.map((outcome) => ({ ...outcome, code: "optics_law_mismatch" }))), "physics");
    for (const consume of [runLiveConsumer, runLabConsumer]) {
      globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ ...plan, subject: "physics" }) } }] });
      const accepted = await consume();
      assert.equal(accepted.subject, "physics");
      assert.equal(accepted.planned, true);
      for (const decision of accepted.decisions) {
        assert.equal(decision.strategy, "strict", "accepted physics keeps the configured strict strategy");
        assert.equal(decision.selectionOrder, "planner_first");
        assert.equal(decision.usePickedExamples, true);
      }
    }

    // Observer mutation has no reference to the admitted response's subject or numeric plan.
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ ...plan, subject: "physics" }) } }] });
    const accepted = await planner.planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: 1000, classifySubject: true,
      onRequestOutcome: (outcome) => { outcome.subject = "chemistry"; outcome.issueCodes.push("invalid_plan"); throw new Error(privateSentinel); } });
    assert.equal(accepted?.subject, "physics");
    assert.deepEqual(accepted?.turnPlan.givens, []);

    const originalClock = Date.now;
    Date.now = () => 10_000;
    try {
      let baseline: string[] | undefined;
      for (const observe of [false, true]) {
        const requests: string[] = [];
        const off: TurnPlanRequestOutcome[] = [];
        globalThis.fetch = async (_url, init) => {
          requests.push(JSON.stringify({ headers: [...new Headers(init?.headers).entries()], body: init?.body }));
          return response("physics");
        };
        assert.equal(await planner.planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: 1000,
          ...(observe ? { onRequestOutcome: (outcome: TurnPlanRequestOutcome) => off.push(outcome) } : {}) }), null);
        if (baseline) assert.deepEqual(requests, baseline, "off-mode observer preserves exact HTTP bytes and request count");
        else baseline = requests;
        assert.ok(off.every((outcome) => !Object.hasOwn(outcome, "subject")), "off-mode event shape gains no subject key");
      }
    } finally { Date.now = originalClock; }
    console.log("Fallback subject consensus: real planner, live/lab consumers, fail-closed policy, privacy, observers and off-mode parity PASS");
  } finally { globalThis.fetch = nativeFetch; }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
