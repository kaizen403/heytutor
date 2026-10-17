/**
 * A refused or rejected begin-turn must drop the active-turn latch before it returns.
 * A result that resolves after stop or a newer turn must not emit, remember a
 * billing failure, lock usage, idle, or finish.
 *
 * Evidence class: extracted-source execution, plus AST checks.
 * useQuestionHandler is not mounted. Its arguments are the live session, and
 * the real beginTurn sends a billing request. This script copies fragments out
 * of the source and runs them:
 *   - the await beginTurn region, against a fake beginTurn that returns or rejects
 *   - the admission-only trace setup and ownership return after that await
 *   - the `if (!billed.ok)` statement in handleQuestion
 *   - finishLectureUi's callback body, which is the release those paths must call
 *   - the submit gate that returns while turnActiveRef is set
 * shouldFlushPendingQuestion is the exported flush predicate and is called
 * directly. rememberBillingFailure is the real function. A marker assigned
 * immediately after the extracted region is the runtime evidence that execution
 * continued. The liveSave begin call executes against an in-process no-write
 * port, proving denial/stale paths never mint a handle. beginBoardEpoch and the
 * liveQuestionRef write remain AST-only. No network or persistence call.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { clearSpotlight } from "../../features/tutor-session/lib/board/spotlight";
import { shouldFlushPendingQuestion } from "../../features/tutor-session/hooks/turn/useQuestionHandler";
import { parseBillingFailureFromUnknown, rememberBillingFailure } from "../../lib/billing/billingClient";
import { getEntitlementSnapshot, setEntitlementSnapshot } from "../../lib/billing/entitlementState";
import { isOutOfUsageLock, OUT_OF_USAGE_TITLE, studentBillingMessage } from "../../lib/billing/studentCopy";
import type { TutorPhase } from "../../features/tutor-session/types";

const QUESTION = "why is the sky blue";
const ENTITLEMENT_BASELINE = 40;
const FAILURE = { ok: false as const, status: 402, code: "out_of_credits", remaining: 0 };
const TIMEOUT = { ok: false as const, status: 504, code: "timeout", remaining: null };
const CONNECTION_FAILURE = "network error. check your connection";
/** A throw the billing parser would treat as an empty envelope. The handler must not. */
const BILLING_SHAPED_REJECTION = 'LLM proxy error (402) {"code":"out_of_credits"}';

type BeginMode = "return" | "reject" | "reject-billing-shaped";

type Emitted = {
  message?: string;
  question?: string;
  billing?: { status?: number; code?: string; remaining?: number | null };
};

type Snapshot = {
  turnActive: boolean;
  phase: string;
  pendingQuestion: string | null;
  phaseSets: string[];
  errors: Emitted[];
  beginTurnCalls: number;
  releaseCalls: number;
  releaseGenerations: Array<number | undefined>;
  spotlight: unknown;
  ttsStops: number;
  usageDepleted: boolean;
  rememberBillingFailureCalls: number;
  entitlementRemainingPct: number | null;
  continuedPastBilling: boolean;
  telemetryCalls: number;
  figureTrackerCalls: number;
  liveSaveCalls: number;
  admissionEvents: string[];
};

type ArmInput = {
  billed: { ok: boolean; status?: number; code?: string; remaining?: number | null };
  question: string;
  turnGeneration: number;
  activeGeneration: number;
  phase: TutorPhase;
  beginMode?: BeginMode;
  aborted?: boolean;
};

type Harness = {
  arm(input: ArmInput): void;
  applyBillingExit(): void;
  settleBeginTurn(): Promise<void>;
  laterSubmit(): string | undefined;
  snapshot(): Snapshot;
};

function readSource(relativePath: string): ts.SourceFile {
  const filename = relativePath.split("/").at(-1) ?? "source.ts";
  const text = readFileSync(resolve(import.meta.dirname, relativePath), "utf8");
  return ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function callsNamed(root: ts.Node, source: ts.SourceFile, name: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === name) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function containsNode(root: ts.Node, target: ts.Node): boolean {
  if (root === target) return true;
  return ts.forEachChild(root, (child) => containsNode(child, target)) ?? false;
}

function findNamedCallback(source: ts.SourceFile, name: string): ts.ArrowFunction {
  let found: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const callback = node.initializer.arguments[0];
      if (callback && ts.isArrowFunction(callback)) found = callback;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, `${name} callback was not found`);
  return found;
}

function declaresBilled(statement: ts.Statement, source: ts.SourceFile): boolean {
  if (!ts.isVariableStatement(statement)) return false;
  return statement.declarationList.declarations.some((decl) => decl.name.getText(source) === "billed");
}

function declaresName(statement: ts.Statement, source: ts.SourceFile, name: string): boolean {
  return ts.isVariableStatement(statement) && statement.declarationList.declarations
    .some((declaration) => declaration.name.getText(source) === name);
}

function statementInBlock(node: ts.Node): ts.Statement | undefined {
  let current: ts.Node = node;
  while (current.parent && !ts.isBlock(current.parent) && !ts.isSourceFile(current.parent)) {
    current = current.parent;
  }
  return ts.isStatement(current) ? current : undefined;
}

function tryAroundBeginTurn(root: ts.Node, source: ts.SourceFile): ts.TryStatement | undefined {
  const call = callsNamed(root, source, "beginTurn")[0];
  if (!call) return undefined;
  let current: ts.Node | undefined = call;
  while (current) {
    if (ts.isTryStatement(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function isStaleTurnReturn(statement: ts.Statement, source: ts.SourceFile): boolean {
  if (!ts.isIfStatement(statement)) return false;
  const expr = statement.expression.getText(source).replace(/\s+/g, "");
  const body = statement.thenStatement;
  const returns = ts.isBlock(body)
    ? body.statements.some(ts.isReturnStatement)
    : ts.isReturnStatement(body);
  return (
    returns &&
    expr.includes("turnGeneration!==turnGenerationRef.current") &&
    expr.includes("abortController.signal.aborted")
  );
}

function statementsBetween(start: ts.Node | undefined, end: ts.Node | undefined): ts.Statement[] {
  if (!start || !end) return [];
  const block = start.parent;
  if (!block || !ts.isBlock(block) || end.parent !== block) return [];
  const from = block.statements.indexOf(start as ts.Statement);
  const to = block.statements.indexOf(end as ts.Statement);
  if (from < 0 || to < 0 || to <= from) return [];
  return block.statements.slice(from + 1, to);
}

function beginTurnRegion(root: ts.Node, source: ts.SourceFile): string {
  const call = callsNamed(root, source, "beginTurn")[0];
  assert.ok(call, "handleQuestion has no beginTurn call");
  let statement = statementInBlock(call);
  assert.ok(statement, "beginTurn is not in a statement");
  const innerBlock = statement.parent;
  if (
    innerBlock &&
    ts.isBlock(innerBlock) &&
    innerBlock.parent &&
    ts.isTryStatement(innerBlock.parent) &&
    innerBlock.parent.tryBlock === innerBlock
  ) {
    statement = innerBlock.parent;
  }
  const block = statement.parent;
  if (!block || !ts.isBlock(block)) throw new Error("beginTurn statement is not in a block");
  const index = block.statements.indexOf(statement);
  const parts: ts.Statement[] = [];
  const previous = block.statements[index - 1];
  if (previous && declaresBilled(previous, source)) parts.push(previous);
  const saveIndex = block.statements.findIndex((next, position) =>
    position > index && declaresName(next, source, "liveSave"));
  assert.ok(saveIndex > index, "beginTurn region must reach the real liveSave declaration");
  const adoptSave = block.statements[saveIndex + 1];
  assert.equal(adoptSave?.getText(source).replace(/\s+/g, ""), "saveExit.handle=liveSave;",
    "the extracted success path must adopt the handle actually minted after billing");
  parts.push(...block.statements.slice(index, saveIndex + 2));
  return parts.map((part) => part.getText(source)).join("\n");
}

function findIf(root: ts.Node, source: ts.SourceFile, pred: (text: string) => boolean): ts.IfStatement {
  let found: ts.IfStatement | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIfStatement(node) && pred(node.expression.getText(source))) found = node;
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(found, "expected if statement was not found");
  return found;
}

function loadHarness(
  billingIf: string,
  releaseArrow: string,
  submitGate: string,
  beginRegion: string,
): Harness {
  const source = `
    function createHarness(deps) {
      const studentBillingMessage = deps.studentBillingMessage;
      let billed = { ok: true };
      let question = "";
      // The extracted billing branch also reads the optional paused lesson.
      // This harness exercises ordinary turns, where there is no resume.
      const resume = null;
      let turnGeneration = 0;
      const turnGenerationRef = { current: 0 };
      const turnActiveRef = { current: false };
      const phaseRef = { current: "idle" };
      const isPausedRef = { current: false };
      const pendingSegmentCountRef = { current: 0 };
      const pendingQuestionRef = { current: null };
      const whiteboard = {
        spotlight: "dimmed",
        setPaused() {},
        setSpotlight(spec) { whiteboard.spotlight = spec; },
      };
      const whiteboardRef = { current: whiteboard };
      let ttsStops = 0;
      const ttsClientRef = { current: { stop() { ttsStops += 1; } } };
      const phaseSets = [];
      const errors = [];
      const releaseGenerations = [];
      let beginTurnCalls = 0;
      let releaseCalls = 0;
      let usageDepleted = false;
      let rememberBillingFailureCalls = 0;
      let continuedPastBilling = false;
      let telemetryCalls = 0;
      let figureTrackerCalls = 0;
      let liveSaveCalls = 0;
      const admissionEvents = [];
      const saveExit = {};
      const turnTelemetryRef = { current: null };
      const sessionId = "billing-exit-offline-board";
      const askOrigin = 1000;
      const retainedFigure = null;
      const speedRef = { current: 1 };
      const cancelRef = { current: false };
      const onSpeechStartupStatus = undefined;
      let beginMode = "return";
      let abortController = new AbortController();
      const clearSpotlight = deps.clearSpotlight;
      function setPhase(next) { phaseSets.push(next); }
      function setIsPaused() {}
      function setCurrentSegmentText() {}
      function setInputInteracted() {}
      function beginTurn() {
        beginTurnCalls += 1;
        admissionEvents.push("billing");
        if (beginMode === "reject") return Promise.reject(new TypeError("Failed to fetch"));
        if (beginMode === "reject-billing-shaped") {
          return Promise.reject(new Error(deps.billingShapedRejection));
        }
        return Promise.resolve(billed);
      }
      function createTurnTelemetry() {
        telemetryCalls += 1;
        admissionEvents.push("telemetry");
        return {
          setTrace() { admissionEvents.push("trace"); },
          watchPageLifecycle() { admissionEvents.push("lifecycle"); },
        };
      }
      function createFigureOutcomeTracker() {
        figureTrackerCalls += 1;
        admissionEvents.push("figure");
        return { decision() { admissionEvents.push("retained-figure"); } };
      }
      function liveTurnSave() { return { begin() {
        liveSaveCalls += 1;
        admissionEvents.push("save");
        return { offlineHandle: true };
      } }; }
      function emitError(error) {
        errors.push(error);
        const billing = error && error.billing;
        if (!billing) return;
        deps.rememberBillingFailure(billing);
        rememberBillingFailureCalls += 1;
        if (typeof billing.remaining === "number" && billing.remaining <= 0) usageDepleted = true;
        if (billing.remaining == null && (billing.code === "out_of_credits" || billing.code === "daily_usd_limit")) {
          usageDepleted = true;
        }
      }
      const releaseLectureUi = ${releaseArrow};
      function finishLectureUi(generation) {
        releaseCalls += 1;
        releaseGenerations.push(generation);
        return releaseLectureUi(generation);
      }
      function applyBillingExit() {
        ${billingIf}
      }
      function laterSubmit() {
        ${submitGate}
        return "accepted";
      }
      async function settleBeginTurn() {
        const doubt = null;
        const currentTraceIdRef = { current: "trace-local" };
        const turnTraceId = "trace-local";
        const previousTraceId = undefined;
        const doubtPage = null;
        ${beginRegion}
        continuedPastBilling = true;
      }
      function arm(input) {
        billed = input.billed;
        question = input.question;
        turnGeneration = input.turnGeneration;
        turnGenerationRef.current = input.activeGeneration;
        turnActiveRef.current = true;
        phaseRef.current = input.phase;
        isPausedRef.current = false;
        pendingSegmentCountRef.current = 0;
        pendingQuestionRef.current = question;
        whiteboard.spotlight = "dimmed";
        phaseSets.length = 0;
        errors.length = 0;
        releaseGenerations.length = 0;
        beginTurnCalls = 0;
        releaseCalls = 0;
        ttsStops = 0;
        usageDepleted = false;
        rememberBillingFailureCalls = 0;
        continuedPastBilling = false;
        telemetryCalls = 0;
        figureTrackerCalls = 0;
        liveSaveCalls = 0;
        admissionEvents.length = 0;
        Object.keys(saveExit).forEach(key => delete saveExit[key]);
        turnTelemetryRef.current = null;
        beginMode = input.beginMode || "return";
        abortController = new AbortController();
        if (input.aborted) abortController.abort();
        deps.setEntitlementSnapshot({
          planId: "free",
          remainingPct: deps.baselineRemaining,
          nextResetAt: null,
          staff: false,
        });
      }
      function snapshot() {
        return {
          turnActive: turnActiveRef.current,
          phase: phaseRef.current,
          pendingQuestion: pendingQuestionRef.current,
          phaseSets: phaseSets.slice(),
          errors: errors.slice(),
          beginTurnCalls,
          releaseCalls,
          releaseGenerations: releaseGenerations.slice(),
          spotlight: whiteboard.spotlight,
          ttsStops,
          usageDepleted,
          rememberBillingFailureCalls,
          entitlementRemainingPct: (deps.getEntitlementSnapshot() || {}).remainingPct ?? null,
          continuedPastBilling,
          telemetryCalls, figureTrackerCalls, liveSaveCalls,
          admissionEvents: admissionEvents.slice(),
        };
      }
      return { arm, applyBillingExit, settleBeginTurn, laterSubmit, snapshot };
    }
  `;
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const createHarness = new Function(
    "deps",
    `${compiled}\nreturn createHarness(deps);`,
  ) as (deps: {
    studentBillingMessage: typeof studentBillingMessage;
    clearSpotlight: typeof clearSpotlight;
    billingShapedRejection: string;
    rememberBillingFailure: typeof rememberBillingFailure;
    getEntitlementSnapshot: typeof getEntitlementSnapshot;
    setEntitlementSnapshot: typeof setEntitlementSnapshot;
    baselineRemaining: number;
  }) => Harness;
  return createHarness({
    studentBillingMessage,
    clearSpotlight,
    billingShapedRejection: BILLING_SHAPED_REJECTION,
    rememberBillingFailure,
    getEntitlementSnapshot,
    setEntitlementSnapshot,
    baselineRemaining: ENTITLEMENT_BASELINE,
  });
}

function raisesUsageLock(error: Emitted | undefined): boolean {
  const billing = error?.billing;
  if (!billing?.code) return false;
  return isOutOfUsageLock({ code: billing.code, remaining: billing.remaining });
}

function messageKind(message: string | undefined): string {
  if (message === CONNECTION_FAILURE) return "connection";
  if (message === OUT_OF_USAGE_TITLE) return "out-of-usage";
  if (message === studentBillingMessage("timeout")) return "timeout";
  if (message == null) return "none";
  return "other";
}

function isTutorPhase(phase: string): phase is TutorPhase {
  return phase === "idle" || phase === "planning" || phase === "thinking" || phase === "drawing" || phase === "speaking";
}

async function main(): Promise<void> {
  console.log(
    "evidence: extracted-source execution of beginTurn, admission-only trace/tracker creation, ownership return, billing refusal, liveSave begin against a no-write port, finishLectureUi, and the submit gate. Hooks were not mounted. No network or persistence call.",
  );
  console.log(
    "success follow-through: runtime marker continuedPastBilling follows adoption of the in-process save handle. beginBoardEpoch and liveQuestionRef remain AST-only. Denied/stale attempts must never call the save port.",
  );

  const handler = readSource("../../features/tutor-session/hooks/turn/useQuestionHandler.ts");
  const control = readSource("../../features/tutor-session/hooks/turn/useTurnControl.ts");
  // The question body; `handleQuestion` only wraps it so every billed exit saves.
  const handleQuestion = findNamedCallback(handler, "teachQuestion");
  const finishLectureUi = findNamedCallback(control, "finishLectureUi");
  const billingIf = findIf(handleQuestion, handler, (text) => text.replace(/\s+/g, "") === "!billed.ok");
  const submitGate = findIf(
    handleQuestion,
    handler,
    (text) =>
      text.includes('phaseRef.current !== "idle"') &&
      text.includes("turnActiveRef.current") &&
      text.includes("pendingSegmentCountRef.current > 0"),
  );
  const failureBranch = billingIf.thenStatement;
  const releaseBody = finishLectureUi.body;
  if (!ts.isBlock(failureBranch)) throw new Error("billing failure branch is a block");
  if (!ts.isBlock(releaseBody)) throw new Error("finishLectureUi body is a block");

  const failures: string[] = [];
  const check = (condition: unknown, message: string): void => {
    if (!condition) failures.push(message);
  };

  const releaseInside = callsNamed(failureBranch, handler, "finishLectureUi");
  check(
    releaseInside.length === 1,
    `failure path must call finishLectureUi once, found ${releaseInside.length}`,
  );
  const releaseCall = releaseInside[0];
  if (releaseCall) {
    check(
      releaseCall.arguments.length === 1 && releaseCall.arguments[0]?.getText(handler) === "turnGeneration",
      "finishLectureUi must be called with turnGeneration",
    );
    const returns = failureBranch.statements.filter(ts.isReturnStatement);
    check(returns.length === 1 && returns[0] !== undefined && releaseCall.getStart(handler) < returns[0].getStart(handler),
      "finishLectureUi must run before the failure path returns");
  }
  check(
    callsNamed(failureBranch, handler, "emitError").length === 1,
    "failure path must still emit the billing error",
  );
  check(
    callsNamed(failureBranch, handler, "beginTurn").length === 0,
    "failure path must not start another billing transaction",
  );
  check(
    callsNamed(handleQuestion, handler, "beginTurn").length === 1,
    "handleQuestion must keep its single beginTurn call",
  );
  const beginTry = tryAroundBeginTurn(handleQuestion, handler);
  const rejectionCatch = beginTry?.catchClause;
  check(rejectionCatch !== undefined, "a rejected beginTurn must be caught beside the await");
  if (rejectionCatch) {
    const catchText = rejectionCatch.getText(handler);
    const catchRelease = callsNamed(rejectionCatch, handler, "finishLectureUi");
    check(
      catchRelease.length === 1 && catchRelease[0]?.arguments[0]?.getText(handler) === "turnGeneration",
      "a rejected beginTurn must call finishLectureUi(turnGeneration) once",
    );
    check(
      callsNamed(rejectionCatch, handler, "beginTurn").length === 0,
      "a rejected beginTurn must not start a second transaction",
    );
    check(
      callsNamed(rejectionCatch, handler, "emitError").length === 1,
      "a rejected beginTurn must emit one error",
    );
    check(
      callsNamed(rejectionCatch, handler, "studentBillingMessage").length === 0 &&
        callsNamed(rejectionCatch, handler, "parseBillingFailureFromUnknown").length === 0 &&
        callsNamed(rejectionCatch, handler, "rememberBillingFailure").length === 0,
      "a rejected beginTurn must not be classified as a billing refusal",
    );
    check(!catchText.includes("console."), "the rejection catch must not log");
    check(!/\.message\b/.test(catchText), "the rejection catch must not read an error message");
    check(
      catchText.includes("turnGenerationRef.current"),
      "the rejection catch must notice a newer generation",
    );
    check(catchText.includes("signal.aborted"), "the rejection catch must notice an intentional abort");
    check(
      ts.isBlock(rejectionCatch.block) && rejectionCatch.block.statements.some(ts.isReturnStatement),
      "the rejection catch must return without falling through after a stop",
    );
  }
  const outsideRelease = callsNamed(handleQuestion, handler, "finishLectureUi")
    .filter((call) => !containsNode(failureBranch, call) && !(rejectionCatch && containsNode(rejectionCatch, call)));
  check(
    outsideRelease.length === 2,
    `successful billing exits must keep their two finishLectureUi calls, found ${outsideRelease.length}`,
  );

  const parent = billingIf.parent;
  if (!parent || !ts.isBlock(parent)) throw new Error("billing if has no parent block");
  const afterBilling = parent.statements.slice(parent.statements.indexOf(billingIf) + 1);
  const saveIndex = afterBilling.findIndex(statement => declaresName(statement, handler, "liveSave"));
  check(saveIndex >= 0, "success fall-through must still mint liveSave after refusal returns");
  const traceIndex = afterBilling.findIndex(statement => declaresName(statement, handler, "tel"));
  const figureIndex = afterBilling.findIndex(statement => declaresName(statement, handler, "figureOutcome"));
  check(traceIndex >= 0 && figureIndex > traceIndex && saveIndex > figureIndex,
    "success must adopt its admission trace and figure tracker before minting liveSave");
  const preSave = afterBilling.slice(0, saveIndex).map(statement => statement.getText(handler)).join("\n");
  check(!preSave.includes("liveTurnSave("), "diagnostic adoption before liveSave must not mint an earlier save handle");
  const afterBillingText = afterBilling
    .map((statement) => statement.getText(handler))
    .join("\n");
  check(afterBillingText.includes("beginBoardEpoch("), "success continuation must still open the board epoch");
  check(
    afterBillingText.includes("liveQuestionRef.current"),
    "success continuation must still assign the active question",
  );

  const guard = releaseBody.statements[0];
  check(guard !== undefined && ts.isIfStatement(guard), "finishLectureUi must still start with the generation guard");
  if (guard && ts.isIfStatement(guard)) {
    check(
      guard.expression.getText(control).includes("turnGeneration !== turnGenerationRef.current"),
      "generation guard must still compare against the active generation",
    );
    const guardBody = guard.thenStatement;
    check(
      ts.isBlock(guardBody) && guardBody.statements.some(ts.isReturnStatement),
      "generation guard must return before it clears the active turn",
    );
    const clearAt = releaseBody.statements.findIndex((statement) =>
      statement.getText(control).includes("turnActiveRef.current = false"),
    );
    check(clearAt > 0, "clearing turnActiveRef must stay after the generation guard");
  }

  const beginRegion = beginTurnRegion(handleQuestion, handler);
  assert.match(beginRegion, /await beginTurn\(/);
  assert.match(beginRegion, /!billed\.ok/);
  assert.match(beginRegion, /const liveSave =/);
  assert.match(beginRegion, /liveTurnSave\(\)\.begin\(/);
  assert.equal(beginRegion.includes("beginBoardEpoch"), false);
  assert.equal(beginRegion.includes("liveQuestionRef"), false);
  assert.equal(beginRegion.includes("${"), false);
  assert.equal(beginRegion.includes("`"), false);
  const betweenTryAndBilling = statementsBetween(beginTry, billingIf);
  const ownershipGuard = betweenTryAndBilling.find((statement) => isStaleTurnReturn(statement, handler));
  const admissionTraceGuard = betweenTryAndBilling.find(statement => ts.isIfStatement(statement) &&
    statement.expression.getText(handler).replace(/\s+/g, "") === "billed.ok");
  check(
    betweenTryAndBilling.length === 2 && admissionTraceGuard !== undefined && ownershipGuard !== undefined &&
      betweenTryAndBilling.indexOf(admissionTraceGuard) < betweenTryAndBilling.indexOf(ownershipGuard),
    `a returned beginTurn must create diagnostics only on admission, then return on a stale generation or abort before billing refusal; found ${betweenTryAndBilling.length} statement(s)`,
  );
  if (admissionTraceGuard) {
    check(callsNamed(admissionTraceGuard, handler, "createTurnTelemetry").length === 1,
      "admission must create one attempt-local telemetry instance");
    check(callsNamed(admissionTraceGuard, handler, "createFigureOutcomeTracker").length === 1,
      "admission must create one attempt-local figure tracker");
    check(callsNamed(admissionTraceGuard, handler, "liveTurnSave").length === 0,
      "admission diagnostics cannot mint a save before stale/refusal checks");
    check(beginRegion.includes(admissionTraceGuard.getText(handler)),
      "the runtime extraction must execute the actual admission-only diagnostics block");
  }
  const guardText = ownershipGuard?.getText(handler) ?? "";
  check(
    guardText.length > 0 && beginRegion.includes(guardText),
    "settleBeginTurn must execute the extracted ownership return, not a copied predicate",
  );
  console.log(`ownership return executed: ${guardText.length > 0 && beginRegion.includes(guardText)}`);

  const harness = loadHarness(
    billingIf.getText(handler),
    finishLectureUi.getText(control),
    submitGate.getText(handler),
    beginRegion,
  );

  harness.arm({
    billed: FAILURE,
    question: QUESTION,
    turnGeneration: 4,
    activeGeneration: 4,
    phase: "thinking",
  });
  try {
    harness.applyBillingExit();
  } catch (error) {
    failures.push(`matching-generation billing exit threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  const failed = harness.snapshot();
  const emitted = failed.errors[0];
  check(failed.errors.length === 1, `billing failure must emit one error, got ${failed.errors.length}`);
  check(emitted?.message === "Out of usage", `student billing message was ${String(emitted?.message)}`);
  check(emitted?.question === QUESTION, "billing error must name the question that was refused");
  check(emitted?.billing?.status === 402, "billing error must keep HTTP status");
  check(emitted?.billing?.code === "out_of_credits", "billing error must keep the refusal code");
  check(emitted?.billing?.remaining === 0, "billing error must keep remaining usage");
  check(failed.usageDepleted === true, "a returned out-of-usage refusal must still mark usage depleted");
  check(failed.rememberBillingFailureCalls === 1, "a returned out-of-usage refusal must still call rememberBillingFailure");
  check(failed.entitlementRemainingPct === 0, "a returned out-of-usage refusal must still record the empty envelope");
  check(raisesUsageLock(emitted) === true, "a returned out-of-usage refusal must still raise the usage lock");
  check(failed.beginTurnCalls === 0, "running the failure path must not call beginTurn");
  check(failed.releaseCalls === 1, "failure path must call finishLectureUi before returning");
  check(
    failed.releaseGenerations.length === 1 && failed.releaseGenerations[0] === 4,
    `release must receive this attempt's generation, got ${JSON.stringify(failed.releaseGenerations)}`,
  );
  check(failed.turnActive === false, "failure path must clear turnActiveRef before return");
  check(failed.phase === "idle", `failure path must set phaseRef to idle, got ${failed.phase}`);
  check(
    failed.phaseSets.length === 1 && failed.phaseSets[0] === "idle",
    `visible phase must return to idle once, got ${JSON.stringify(failed.phaseSets)}`,
  );
  check(failed.spotlight === null, "failure path must run finishLectureUi's spotlight clear");
  check(failed.ttsStops === 1, "failure path must run finishLectureUi's speech stop");
  const submitted = harness.laterSubmit();
  const afterSubmit = harness.snapshot();
  check(submitted === "accepted", "a later submit must get past the active-turn gate");
  check(
    afterSubmit.pendingQuestion === QUESTION,
    "the submit gate must not discard the next question",
  );
  check(
    isTutorPhase(failed.phase) && shouldFlushPendingQuestion({
      pendingQuestion: QUESTION,
      boardLoaded: true,
      hasWhiteboard: true,
      phase: failed.phase,
      turnActive: failed.turnActive,
      pendingSegmentCount: 0,
    }),
    "shouldFlushPendingQuestion must allow the next question after the refusal returns",
  );

  harness.arm({
    billed: { ok: true },
    question: QUESTION,
    turnGeneration: 4,
    activeGeneration: 4,
    phase: "thinking",
  });
  harness.applyBillingExit();
  const accepted = harness.snapshot();
  check(accepted.errors.length === 0, "a successful beginTurn must not emit a billing error");
  check(accepted.releaseCalls === 0, "a successful beginTurn must not call finishLectureUi");
  check(accepted.turnActive === true, "a successful beginTurn must leave the turn active");
  check(accepted.phase === "thinking", "a successful beginTurn must leave phaseRef thinking");
  check(accepted.phaseSets.length === 0, "a successful beginTurn must not idle the visible phase");
  check(accepted.beginTurnCalls === 0, "the success fall-through is outside this exit and must not bill again here");
  check(accepted.spotlight === "dimmed", "a successful beginTurn must not clear the spotlight");
  check(accepted.ttsStops === 0, "a successful beginTurn must not stop speech");

  // The branch body, entered directly. The await path's ownership return is
  // settled below and is what skips this branch after stop or a newer turn.
  harness.arm({
    billed: FAILURE,
    question: QUESTION,
    turnGeneration: 4,
    activeGeneration: 7,
    phase: "thinking",
  });
  try {
    harness.applyBillingExit();
  } catch (error) {
    failures.push(`superseded billing exit threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  const superseded = harness.snapshot();
  check(superseded.errors.length === 1, "the billing branch, when entered, still emits the billing error");
  check(superseded.releaseCalls === 1, "the billing branch, when entered for a stale generation, still calls finishLectureUi");
  check(
    superseded.releaseGenerations.length === 1 && superseded.releaseGenerations[0] === 4,
    "a superseded refusal must pass its own generation into finishLectureUi",
  );
  check(superseded.turnActive === true, "a superseded refusal must not clear the newer turn's latch");
  check(superseded.phase === "thinking", "a superseded refusal must not idle the newer turn's phase ref");
  check(
    superseded.phaseSets.length === 0,
    `a superseded refusal must not set the visible phase to idle, got ${JSON.stringify(superseded.phaseSets)}`,
  );
  check(superseded.spotlight === "dimmed", "a superseded refusal must not clear the newer turn's spotlight");
  check(superseded.ttsStops === 0, "a superseded refusal must not stop the newer turn's speech");
  check(harness.laterSubmit() !== "accepted", "a newer turn must still hold the submit gate");

  assert.equal(parseBillingFailureFromUnknown(new TypeError("Failed to fetch")), null);
  const shaped = parseBillingFailureFromUnknown(new Error(BILLING_SHAPED_REJECTION));
  assert.equal(shaped?.code, "out_of_credits");
  assert.equal(isOutOfUsageLock({ code: shaped?.code ?? "", remaining: 0 }), true);

  const owned = {
    question: QUESTION,
    turnGeneration: 4,
    activeGeneration: 4,
    phase: "thinking" as const,
  };

  const settleOrNote = async (label: string): Promise<boolean> => {
    try {
      await harness.settleBeginTurn();
      return true;
    } catch {
      failures.push(`${label}: beginTurn escaped the handler`);
      return false;
    }
  };

  harness.arm({ ...owned, billed: { ok: true }, beginMode: "return" });
  await settleOrNote("successful beginTurn");
  const settledOk = harness.snapshot();
  check(settledOk.errors.length === 0, "a resolved beginTurn must not emit an error");
  check(settledOk.releaseCalls === 0, "a resolved beginTurn must not call finishLectureUi");
  check(settledOk.turnActive === true, "a resolved beginTurn must leave the turn active");
  check(settledOk.phase === "thinking", "a resolved beginTurn must leave phaseRef thinking");
  check(settledOk.beginTurnCalls === 1, "a resolved beginTurn must bill once");
  check(settledOk.usageDepleted === false, "a resolved beginTurn must not mark usage depleted");
  check(settledOk.rememberBillingFailureCalls === 0, "a resolved beginTurn must not call rememberBillingFailure");
  check(
    settledOk.entitlementRemainingPct === ENTITLEMENT_BASELINE,
    "a resolved beginTurn must leave the entitlement baseline",
  );
  check(
    settledOk.continuedPastBilling === true,
    "runtime: a current success adopts the in-process save handle before the continuation marker",
  );
  check(settledOk.telemetryCalls === 1 && settledOk.figureTrackerCalls === 1,
    "a current admission must create its trace and tracker once");
  check(settledOk.liveSaveCalls === 1, "a current admission must mint its save handle once");
  check(JSON.stringify(settledOk.admissionEvents) === JSON.stringify(["billing", "telemetry", "figure", "trace", "lifecycle", "save"]),
    `admission/tracker/save order was ${JSON.stringify(settledOk.admissionEvents)}`);
  check(settledOk.spotlight === "dimmed", "a resolved beginTurn must not clear the spotlight");
  check(settledOk.ttsStops === 0, "a resolved beginTurn must not stop speech");

  harness.arm({ ...owned, billed: FAILURE, beginMode: "return" });
  await settleOrNote("returned billing refusal");
  const settledRefusal = harness.snapshot();
  const refusalError = settledRefusal.errors[0];
  check(settledRefusal.beginTurnCalls === 1, "a returned refusal must come from the one beginTurn call");
  check(refusalError?.message === "Out of usage", "a returned refusal must stay a billing error");
  check(refusalError?.message !== CONNECTION_FAILURE, "a returned refusal must not be reported as a connection failure");
  check(refusalError?.billing?.code === "out_of_credits", "a returned refusal must keep its billing code");
  check(settledRefusal.usageDepleted === true, "a returned refusal must still mark usage depleted");
  check(settledRefusal.rememberBillingFailureCalls === 1, "a returned refusal must still call rememberBillingFailure");
  check(settledRefusal.entitlementRemainingPct === 0, "a returned refusal must still record the empty envelope");
  check(raisesUsageLock(refusalError) === true, "a returned refusal must still raise the usage lock");
  check(settledRefusal.releaseCalls === 1, "a returned refusal must still release");
  check(settledRefusal.turnActive === false, "a returned refusal must clear the latch");
  check(settledRefusal.phase === "idle", "a returned refusal must idle phaseRef");
  check(
    settledRefusal.phaseSets.length === 1 && settledRefusal.phaseSets[0] === "idle",
    `a returned refusal must show idle once, got ${JSON.stringify(settledRefusal.phaseSets)}`,
  );
  check(settledRefusal.continuedPastBilling === false, "a returned refusal must return before the success continuation");
  check(settledRefusal.telemetryCalls === 0 && settledRefusal.figureTrackerCalls === 0,
    "a denied admission must not create an admitted-turn trace or tracker");
  check(settledRefusal.liveSaveCalls === 0, "a denied admission must never mint a save handle");
  check(harness.laterSubmit() === "accepted", "a later submit must follow a returned refusal");

  harness.arm({ ...owned, billed: TIMEOUT, beginMode: "return" });
  await settleOrNote("returned timeout");
  const settledTimeout = harness.snapshot();
  const timeoutError = settledTimeout.errors[0];
  check(
    timeoutError?.message === studentBillingMessage("timeout"),
    `a returned timeout must keep the timeout message, kind ${messageKind(timeoutError?.message)}`,
  );
  check(timeoutError?.message !== CONNECTION_FAILURE, "a returned timeout must not be reported as a connection failure");
  check(timeoutError?.billing?.code === "timeout", "a returned timeout must keep the timeout code");
  check(settledTimeout.usageDepleted === false, "a returned timeout must not mark usage depleted");
  check(settledTimeout.rememberBillingFailureCalls === 1, "a returned timeout must still call rememberBillingFailure");
  check(
    settledTimeout.entitlementRemainingPct === ENTITLEMENT_BASELINE,
    "a returned timeout must not zero the envelope",
  );
  check(!raisesUsageLock(timeoutError), "a returned timeout must not raise the usage lock");
  check(settledTimeout.releaseCalls === 1, "a returned timeout must still release");
  check(settledTimeout.turnActive === false, "a returned timeout must clear the latch");
  check(settledTimeout.phase === "idle", "a returned timeout must idle phaseRef");
  check(settledTimeout.continuedPastBilling === false, "a returned timeout must return before the success continuation");
  check(settledTimeout.telemetryCalls === 0 && settledTimeout.figureTrackerCalls === 0 && settledTimeout.liveSaveCalls === 0,
    "a returned timeout must not create admission diagnostics or a save handle");

  const expectConnectionRelease = async (label: string, beginMode: BeginMode): Promise<void> => {
    harness.arm({ ...owned, billed: { ok: true }, beginMode, aborted: false });
    await settleOrNote(label);
    const snap = harness.snapshot();
    const error = snap.errors[0];
    check(snap.beginTurnCalls === 1, `${label}: beginTurn must run once, got ${snap.beginTurnCalls}`);
    check(snap.errors.length === 1, `${label}: must emit one error, got ${snap.errors.length}`);
    check(error?.message === CONNECTION_FAILURE, `${label}: message kind was ${messageKind(error?.message)}`);
    check(error?.message !== OUT_OF_USAGE_TITLE, `${label}: must not say the student is out of usage`);
    check(error?.question === QUESTION, `${label}: retry must keep the question`);
    check(error?.billing == null, `${label}: must not attach a billing failure`);
    check(!raisesUsageLock(error), `${label}: must not raise the usage lock`);
    check(snap.usageDepleted === false, `${label}: must not mark usage depleted`);
    check(snap.rememberBillingFailureCalls === 0, `${label}: must not call rememberBillingFailure`);
    check(
      snap.entitlementRemainingPct === ENTITLEMENT_BASELINE,
      `${label}: must leave the entitlement baseline, remaining ${String(snap.entitlementRemainingPct)}`,
    );
    check(snap.continuedPastBilling === false, `${label}: must return before the success continuation`);
    check(snap.telemetryCalls === 0 && snap.figureTrackerCalls === 0 && snap.liveSaveCalls === 0,
      `${label}: rejected admission must create neither admitted diagnostics nor a save handle`);
    check(snap.releaseCalls === 1, `${label}: must release the current generation`);
    check(
      snap.releaseGenerations.length === 1 && snap.releaseGenerations[0] === 4,
      `${label}: release generation was ${JSON.stringify(snap.releaseGenerations)}`,
    );
    check(snap.turnActive === false, `${label}: must clear turnActiveRef`);
    check(snap.phase === "idle", `${label}: must set phaseRef to idle, got ${snap.phase}`);
    check(
      snap.phaseSets.length === 1 && snap.phaseSets[0] === "idle",
      `${label}: visible phase was ${JSON.stringify(snap.phaseSets)}`,
    );
    check(snap.spotlight === null, `${label}: must clear the spotlight`);
    check(snap.ttsStops === 1, `${label}: must stop speech`);
    check(harness.laterSubmit() === "accepted", `${label}: a later submit must be accepted`);
    const after = harness.snapshot();
    check(after.pendingQuestion === QUESTION, `${label}: the submit gate must not discard the next question`);
    check(
      isTutorPhase(snap.phase) && shouldFlushPendingQuestion({
        pendingQuestion: QUESTION,
        boardLoaded: true,
        hasWhiteboard: true,
        phase: snap.phase,
        turnActive: snap.turnActive,
        pendingSegmentCount: 0,
      }),
      `${label}: the next question must be allowed after the rejection returns`,
    );
  };

  await expectConnectionRelease("network rejection", "reject");
  await expectConnectionRelease("billing-shaped rejection", "reject-billing-shaped");

  const expectLeftRunning = async (label: string, activeGeneration: number, aborted: boolean): Promise<void> => {
    harness.arm({
      billed: { ok: true },
      question: QUESTION,
      turnGeneration: 4,
      activeGeneration,
      phase: "thinking",
      beginMode: "reject",
      aborted,
    });
    await settleOrNote(label);
    const snap = harness.snapshot();
    check(snap.beginTurnCalls === 1, `${label}: beginTurn must run once, got ${snap.beginTurnCalls}`);
    check(snap.errors.length === 0, `${label}: must not show an error, kind ${messageKind(snap.errors[0]?.message)}`);
    check(snap.releaseCalls === 0, `${label}: must not call finishLectureUi`);
    check(snap.turnActive === true, `${label}: must not clear the active latch`);
    check(snap.phase === "thinking", `${label}: must not idle phaseRef, got ${snap.phase}`);
    check(snap.phaseSets.length === 0, `${label}: must not set the visible phase, got ${JSON.stringify(snap.phaseSets)}`);
    check(snap.spotlight === "dimmed", `${label}: must not clear the spotlight`);
    check(snap.ttsStops === 0, `${label}: must not stop speech`);
    check(snap.usageDepleted === false, `${label}: must not mark usage depleted`);
    check(snap.rememberBillingFailureCalls === 0, `${label}: must not call rememberBillingFailure`);
    check(
      snap.entitlementRemainingPct === ENTITLEMENT_BASELINE,
      `${label}: entitlement remaining was ${String(snap.entitlementRemainingPct)}`,
    );
    check(snap.continuedPastBilling === false, `${label}: must return before the success continuation`);
    check(snap.telemetryCalls === 0 && snap.figureTrackerCalls === 0 && snap.liveSaveCalls === 0,
      `${label}: rejected stale admission must create neither diagnostics nor a save handle`);
    check(harness.laterSubmit() !== "accepted", `${label}: the active turn must still hold the submit gate`);
  };

  const expectStaleReturnIgnored = async (
    label: string,
    billed: ArmInput["billed"],
    activeGeneration: number,
    aborted: boolean,
  ): Promise<void> => {
    harness.arm({
      billed,
      question: QUESTION,
      turnGeneration: 4,
      activeGeneration,
      phase: "thinking",
      beginMode: "return",
      aborted,
    });
    await settleOrNote(label);
    const snap = harness.snapshot();
    check(snap.beginTurnCalls === 1, `${label}: beginTurn must run once, got ${snap.beginTurnCalls}`);
    check(
      snap.errors.length === 0,
      `${label}: must not emit an error, kind ${messageKind(snap.errors[0]?.message)}`,
    );
    check(
      snap.rememberBillingFailureCalls === 0,
      `${label}: must not call rememberBillingFailure, got ${snap.rememberBillingFailureCalls}`,
    );
    check(
      snap.entitlementRemainingPct === ENTITLEMENT_BASELINE,
      `${label}: entitlement remaining was ${String(snap.entitlementRemainingPct)}`,
    );
    check(!raisesUsageLock(snap.errors[0]), `${label}: must not raise the usage lock`);
    check(snap.usageDepleted === false, `${label}: must not mark usage depleted`);
    check(snap.releaseCalls === 0, `${label}: must not finish the turn, got ${snap.releaseCalls}`);
    check(snap.turnActive === true, `${label}: must not clear the active latch`);
    check(snap.phase === "thinking", `${label}: must not idle phaseRef, got ${snap.phase}`);
    check(
      snap.phaseSets.length === 0,
      `${label}: must not set the visible phase, got ${JSON.stringify(snap.phaseSets)}`,
    );
    check(snap.spotlight === "dimmed", `${label}: must not clear the spotlight`);
    check(snap.ttsStops === 0, `${label}: must not stop speech`);
    check(
      snap.continuedPastBilling === false,
      `${label}: runtime must return before save admission and the success continuation`,
    );
    check(snap.liveSaveCalls === 0, `${label}: a stale returned attempt must never mint a save handle`);
    check(snap.telemetryCalls === Number(billed.ok) && snap.figureTrackerCalls === Number(billed.ok),
      `${label}: only an issued admission may retain attempt-local terminal diagnostics`);
    check(harness.laterSubmit() !== "accepted", `${label}: the active turn must still hold the submit gate`);
  };

  await expectLeftRunning("superseded rejection", 7, false);
  await expectLeftRunning("aborted newer turn", 7, true);
  await expectLeftRunning("aborted current generation", 4, true);

  await expectStaleReturnIgnored("superseded returned refusal", FAILURE, 7, false);
  await expectStaleReturnIgnored("aborted returned refusal", FAILURE, 4, true);
  await expectStaleReturnIgnored("superseded returned success", { ok: true }, 7, false);
  await expectStaleReturnIgnored("aborted returned success", { ok: true }, 4, true);

  setEntitlementSnapshot(null);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("billing failure exit verification passed");
}

main().catch((error: unknown) => {
  setEntitlementSnapshot(null);
  const name = error instanceof Error ? error.name : "Error";
  console.error(`FAIL verifier crashed (${name})`);
  process.exitCode = 1;
});
