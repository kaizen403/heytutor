/**
 * Every started turn writes one terminal line: `[tutor:turn] turn complete`
 * or `[tutor:turn] turn failed {reason}`.
 *
 * v3 p2c-t2 (20 Oct 2026): the solver audit returned a contradiction, the
 * handler showed a toast and returned before its main try, and neither line
 * was written. The lab driver waited 25 minutes on a turn that had ended.
 * The same was true of every other early exit (billing refusal, a newer turn,
 * Stop during startup) and of any exception thrown while planning.
 *
 * Unit: the settle rules. Static (TypeScript AST over useQuestionHandler.ts):
 * the record is started before the first exit, `turn complete` marks it,
 * handleQuestion settles the same record in the finally around the body, and
 * each function-level exit of the body is listed with the line that ends it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import {
  createTurnTerminalRecord,
  markTurnCompleted,
  markTurnExitReason,
  markTurnStarted,
  settleTurnTerminalRecord,
  turnTerminalRecordFor,
} from "../../features/tutor-session/lib/turn/turnTerminalEvent";

// --- settle rules ------------------------------------------------------------
{
  const lines: Array<Record<string, unknown>> = [];
  const log = (_event: "turn failed", details: Record<string, unknown>) => { lines.push(details); };
  const settle = (record: ReturnType<typeof createTurnTerminalRecord>, outcome: Parameters<typeof settleTurnTerminalRecord>[1]) =>
    settleTurnTerminalRecord(record, outcome, log);

  const queued = createTurnTerminalRecord();
  assert.equal(settle(queued, { threw: false }), false, "an ask that never started is not a turn");

  const completed = createTurnTerminalRecord();
  markTurnStarted(completed, 3);
  markTurnCompleted(completed);
  assert.equal(settle(completed, { threw: false }), false, "turn complete is already terminal");

  const contradiction = createTurnTerminalRecord();
  markTurnStarted(contradiction, 4);
  markTurnExitReason(contradiction, "solver_authority_contradiction");
  markTurnExitReason(contradiction, "later");
  assert.equal(settle(contradiction, { threw: false, inferredReason: "begin_turn_refused" }), true);
  assert.equal(settle(contradiction, { threw: false }), false, "one terminal line per turn");
  assert.deepEqual(lines.pop(), { reason: "solver_authority_contradiction", generation: 4 }, "the exit's own reason wins");

  for (const [outcome, reason] of [
    [{ threw: true, cancelled: true }, "cancelled"],
    [{ threw: true, cancelled: false }, "uncaught_error"],
    [{ threw: false, inferredReason: "superseded" }, "superseded"],
    [{ threw: false }, "returned_without_terminal_event"],
  ] as const) {
    const record = createTurnTerminalRecord();
    markTurnStarted(record, 9);
    assert.equal(settle(record, outcome), true);
    assert.equal(lines.pop()?.reason, reason);
  }
  const owner = {};
  assert.equal(turnTerminalRecordFor(owner), turnTerminalRecordFor(owner), "body and wrapper share one record per ask");
  assert.notEqual(turnTerminalRecordFor(owner), turnTerminalRecordFor({}));
}

// --- the live handler --------------------------------------------------------
const file = resolve(__dirname, "../../features/tutor-session/hooks/turn/useQuestionHandler.ts");
const text = readFileSync(file, "utf8");
const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const line = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

function callback(name: string): ts.ArrowFunction {
  let found: ts.ArrowFunction | null = null;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name &&
        node.initializer && ts.isCallExpression(node.initializer) && node.initializer.arguments[0] &&
        ts.isArrowFunction(node.initializer.arguments[0])) found = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, `${name} useCallback`);
  return found;
}
/** Walk a function body without entering nested functions. */
function ownNodes(body: ts.Node, visit: (node: ts.Node, ancestors: ts.Node[]) => void): void {
  const walk = (node: ts.Node, ancestors: ts.Node[]) => {
    visit(node, ancestors);
    if (ts.isFunctionLike(node) && node !== body) return;
    ts.forEachChild(node, (child) => walk(child, [...ancestors, node]));
  };
  ts.forEachChild(body, (child) => walk(child, [body]));
}
const callText = (node: ts.Node) => node.getText(source).replace(/\s+/g, " ");

const teach = callback("teachQuestion");
assert.ok(teach.body && ts.isBlock(teach.body));
const statements: ts.CallExpression[] = [];
const returns: Array<{ node: ts.ReturnStatement; ancestors: ts.Node[] }> = [];
ownNodes(teach.body, (node, ancestors) => {
  if (ts.isCallExpression(node)) statements.push(node);
  if (ts.isReturnStatement(node)) returns.push({ node, ancestors });
});
const find = (predicate: (call: string) => boolean, what: string) => {
  const matches = statements.filter((call) => predicate(callText(call)));
  assert.equal(matches.length, 1, `exactly one ${what}`);
  return matches[0]!;
};
const submitted = find((call) => call.startsWith('tutorDebug("turn", "question submitted"'), "question submitted log");
const started = find((call) => call.startsWith("markTurnStarted(terminal, turnGeneration)"), "markTurnStarted");
const complete = find((call) => call.startsWith('tutorDebug("turn", "turn complete"'), "turn complete log");
const completedMark = find((call) => call === "markTurnCompleted(terminal)", "markTurnCompleted");
const contradiction = find((call) => call === 'markTurnExitReason(terminal, "solver_authority_contradiction")', "contradiction reason");

// No exit between the submitted log and the start mark.
for (const { node } of returns) {
  assert.ok(!(node.pos > submitted.end && node.pos < started.pos), `return at line ${line(node)} precedes the start mark`);
}
// turn complete marks the record right away, in the finally of the main try.
const statementOf = (node: ts.Node) => {
  let current = node;
  while (!ts.isExpressionStatement(current)) current = current.parent;
  return current;
};
const completeStatement = statementOf(complete);
const block = completeStatement.parent as ts.Block;
assert.equal(block.statements[block.statements.indexOf(completeStatement) + 1], statementOf(completedMark),
  "markTurnCompleted directly follows the turn complete log");
const mainTry = block.parent;
assert.ok(ts.isTryStatement(mainTry) && mainTry.finallyBlock === block, "turn complete is written in the main try's finally");
// The contradiction branch names itself before it returns.
const contradictionIf = (() => {
  let current: ts.Node = contradiction;
  while (!ts.isIfStatement(current)) current = current.parent;
  return current;
})();
assert.match(contradictionIf.expression.getText(source), /audit\.status === "contradiction"/);
assert.ok(ts.isBlock(contradictionIf.thenStatement) &&
  contradictionIf.thenStatement.statements.some((statement) => ts.isReturnStatement(statement)), "the contradiction branch returns");

// Every exit after the start: inside the main try it ends with turn complete;
// outside it the wrapper writes turn failed.
const exits = returns.filter(({ node }) => node.pos > started.end).map(({ node, ancestors }) => ({
  line: line(node),
  terminal: ancestors.includes(mainTry.tryBlock) || ancestors.includes(mainTry.catchClause!)
    ? "turn complete (main finally)"
    : "turn failed (handleQuestion finally)",
}));
const early = exits.filter((exit) => exit.terminal.startsWith("turn failed"));
assert.ok(early.length >= 6, "superseded, begin-turn failure, stop, billing, epoch and contradiction exits are all listed");
assert.ok(early.some((exit) => exit.line > line(contradiction) && exit.line < line(contradictionIf) + 25), "the contradiction exit is an early exit");

// handleQuestion settles the same record after every exit of the body.
const handle = callback("handleQuestion");
let settled = false;
const visit = (node: ts.Node) => {
  if (ts.isTryStatement(node) && callText(node.tryBlock).includes("return await teachQuestion(rawQuestion, admittedOptions, saveExit);")) {
    const finallyText = node.finallyBlock ? callText(node.finallyBlock) : "";
    settled = finallyText.includes("settleTurnTerminalRecord(terminal,") &&
      finallyText.includes("const terminal = turnTerminalRecordFor(saveExit);") &&
      finallyText.includes('tutorDebug("turn", event, details)');
    assert.ok(node.catchClause && callText(node.catchClause).includes("throw error;"), "the wrapper rethrows after settling");
  }
  ts.forEachChild(node, visit);
};
visit(handle.body);
assert.ok(settled, "handleQuestion settles the body's record in the finally around teachQuestion");
// The only other call is the not-ready path, which returns before a turn starts.
const calls = (text.match(/teachQuestion\(rawQuestion/g) ?? []).length;
assert.equal(calls, 2, "teachQuestion runs from the admission wrapper and the not-ready queue only");
const notReady = returns.find(({ node }) => node.pos < submitted.pos);
assert.ok(notReady, "the not-ready queue returns before the turn is submitted");

console.log(`verify-turn-terminal-event: ${exits.length} exits after start; ${early.length} early exits now end with turn failed (lines ${early.map((exit) => exit.line).join(", ")}), the rest with turn complete`);
