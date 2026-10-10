/** Real registry checkpoint anchors must retain teaching chronology after delayed ACKs. */
import assert from "node:assert/strict";
import type { RecordedSegmentPayload, StoredTurn, TurnCheckpointInput, TurnCheckpointResult, TurnCloseInput } from "../../lib/boards/boardsClient";
import { LiveTurnSaveRegistry, overlayLiveTurnEvent, type LiveTurnMirrorEvent } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { lessonPageRecord } from "../../features/tutor-session/lib/turn/doubtTurn";

const BOARD = "chronology-board";
const QUESTION = "Explain the next step.";
const parent = (id: string, orderIndex: number): StoredTurn => ({
  id, orderIndex, question: QUESTION, rawResponse: "Earlier work.", speedMultiplier: 1,
  traceId: null, status: "stopped", persistedStatus: "stopped", kind: "lesson",
  sceneDocument: null, sceneEngineVersion: null, validationReport: null,
  visualStatus: "text_only", sceneArtifacts: null, segments: [],
});
const row = (text: string): RecordedSegmentPayload => ({
  orderIndex: 0, narration: text, spokenText: text,
  command: { type: "WRITE", params: [90, 140], text, charPosition: 0, narrationBefore: "" },
  audioBytes: null, durationMs: null, timings: null,
});
interface Call {
  boardId: string;
  turnId: string;
  input: TurnCheckpointInput | TurnCloseInput;
  resolve(result: TurnCheckpointResult): void;
}
function harness() {
  const owner = {};
  let nextId = 0;
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  const calls: Call[] = [];
  const events: LiveTurnMirrorEvent[] = [];
  let visible: StoredTurn[] = [];
  const registry = new LiveTurnSaveRegistry({
    transport: {
      checkpoint: (boardId, turnId, input) => new Promise(resolve => calls.push({ boardId, turnId, input, resolve })),
      close: (boardId, turnId, input) => new Promise(resolve => calls.push({ boardId, turnId, input, resolve })),
    },
    setTimer: fn => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimer: id => { timers.delete(Number(id)); },
    now: () => 1_000, isOnline: () => true, mintId: () => `local-${++nextId}`,
  });
  registry.attach(owner, {
    openBoardId: () => BOARD,
    mirror: event => {
      events.push(event);
      const snapshot: StoredTurn = event.source === "server" ? event.turn : {
        ...event.turn, segments: event.rows.map((held, orderIndex) => ({ ...held, id: `${event.turnId}:${orderIndex}`, audioUrl: null })),
      };
      visible = overlayLiveTurnEvent(visible, event, snapshot);
    },
  });
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
  const observe = (saved: StoredTurn[]) => { visible = [...saved]; registry.observeBoard(BOARD, saved); };
  const begin = (generation: number, kind: "lesson" | "doubt" | "resume" = "lesson", boardId = BOARD) => registry.begin({
    owner, generation, boardId, kind, traceId: null, question: QUESTION, preview: QUESTION,
    speedMultiplier: 1, continuesBoard: kind !== "lesson", page: lessonPageRecord(boardId, QUESTION),
  });
  const teach = async (generation: number) => { registry.recordRow(owner, generation, row(`work ${generation}`), { intro: false }); await settle(); };
  const ack = async (call: Call, orderIndex: number) => {
    call.resolve({ ok: true, turn: { ...parent(call.turnId, orderIndex), status: call.input.status ?? "stopped" },
      serverSeq: call.input.seq, serverCount: call.input.baseCount + (call.input.segments?.length ?? 0),
      serverSceneSeq: call.input.seq, sceneAccepted: true, stale: false, final: false });
    await settle();
  };
  const fail = async (call: Call) => {
    call.resolve({ ok: false, status: 403, error: "fixture first save denied", reason: "forbidden", retryable: false });
    await settle();
  };
  return { registry, owner, calls, events, timers, observe, begin, teach, ack, fail, settle,
    visible: () => visible.map(turn => turn.id) };
}

async function continuationWaitsForNewlySavedPredecessor() {
  for (const kind of ["doubt", "resume"] as const) {
    const h = harness();
    h.observe([parent("P", 0)]);
    const a = h.begin(1);
    await h.teach(1);
    a.close();
    const b = h.begin(2, kind);
    await h.teach(2);
    b.close();
    assert.equal(h.calls.length, 1, "the continuation waits while its predecessor first save is pending");
    await h.ack(h.calls[0]!, 1);
    const firstB = h.calls.find(call => call.turnId === b.turnId);
    assert(firstB, "the predecessor ACK releases the continuation's first PUT");
    assert.equal(firstB.input.orderAfterTurnId, a.turnId,
      `${kind} must be inserted after its taught predecessor, rather than the older GET anchor P`);
    assert.equal(firstB.input.orderBeforeTurnId, undefined);
    await h.ack(firstB, 2);
    assert.deepEqual(h.visible(), ["P", a.turnId, b.turnId], "replay overlay preserves the same chronology");
  }
}

async function aFreshExternalSuccessorStillOutranksAnOlderLocalTurn() {
  const h = harness(); h.observe([parent("P", 0)]);
  const a = h.begin(1); await h.teach(1); a.close();
  h.observe([parent("P", 0), parent("X", 1)]);
  const b = h.begin(2, "resume"); await h.teach(2); b.close();
  await h.ack(h.calls[0]!, 1);
  const firstB = h.calls.find(call => call.turnId === b.turnId)!;
  assert.equal(firstB.input.orderAfterTurnId, "X", "other-tab work first observed after A stays before the later B");
  assert.equal(firstB.input.orderBeforeTurnId, undefined);
  assert.equal(h.registry.reopen(BOARD).find(event => event.turnId === a.turnId)?.orderBeforeTurnId, "X", "the late A uses its first newly observed successor");
}

async function anEarlierLocalHistoryReceiptCannotBecomeASuccessor() {
  const h = harness(); h.observe([parent("P", 0)]);
  const older = h.begin(1); await h.teach(1); older.close();
  await h.ack(h.calls[0]!, 1);
  const a = h.begin(2); await h.teach(2); a.close();
  // The same tab's earlier H was not in A's opening GET; a later fresh GET
  // now includes it. It remains A's predecessor rather than a new successor.
  h.observe([parent("P", 0), parent(older.turnId, 1)]);
  const b = h.begin(3, "doubt"); await h.teach(3); b.close();
  const firstA = h.calls.find(call => call.turnId === a.turnId)!;
  await h.ack(firstA, 2);
  const firstB = h.calls.find(call => call.turnId === b.turnId)!;
  assert.equal(firstB.input.orderAfterTurnId, a.turnId, "the latest local predecessor outranks an earlier local GET receipt");
  assert.equal(h.registry.reopen(BOARD).find(event => event.turnId === a.turnId)?.orderBeforeTurnId, b.turnId,
    "observing an earlier local ACK must not create a contradictory successor anchor");
}

async function aFailedPredecessorCanStillBeInsertedBeforeLaterSaves() {
  for (const withExternalHistory of [false, true]) {
    const h = harness(); h.observe([parent("P", 0)]);
    const a = h.begin(1); await h.teach(1); a.close();
    await h.fail(h.calls[0]!);
    if (withExternalHistory) h.observe([parent("P", 0), parent("X", 1)]);
    const b = h.begin(2, "resume"); await h.teach(2); b.close();
    const firstB = h.calls.find(call => call.turnId === b.turnId)!;
    assert.equal(firstB.input.orderAfterTurnId, withExternalHistory ? "X" : "P",
      "a failed predecessor cannot supply an unauthenticated durable anchor or block a later save");
    await h.ack(firstB, withExternalHistory ? 2 : 1);
    h.registry.retry(BOARD); await h.settle();
    const retryA = h.calls.findLast(call => call.turnId === a.turnId)!;
    assert.notEqual(retryA, h.calls[0]);
    assert.equal(retryA.input.orderAfterTurnId, "P");
    assert.equal(retryA.input.orderBeforeTurnId, withExternalHistory ? "X" : b.turnId,
      "late first creation preserves the first known successor rather than moving behind it");
    await h.ack(retryA, 1);
    const updateB = h.calls.findLast(call => call.turnId === b.turnId)!;
    assert.notEqual(updateB, firstB);
    assert.equal(updateB.input.status, "stopped", "Stop while the first PUT was pending causes an existing-turn update");
    assert.equal(updateB.input.orderAfterTurnId, undefined, "an existing-turn update never requests reinsertion");
    assert.equal(updateB.input.orderBeforeTurnId, undefined);
  }
}

async function localOnlyAndUnrelatedBoardControls() {
  const h = harness();
  const foreign = h.begin(1, "lesson", "other-board"); await h.teach(1);
  await h.ack(h.calls[0]!, 0);
  const a = h.begin(2); await h.teach(2); a.close();
  const b = h.begin(3, "resume"); await h.teach(3); b.close();
  const firstA = h.calls.find(call => call.turnId === a.turnId)!;
  assert.equal(firstA.input.orderAfterTurnId, undefined, "another board cannot become an ordering anchor");
  await h.ack(firstA, 0);
  const firstB = h.calls.find(call => call.turnId === b.turnId)!;
  assert.equal(firstB.input.orderAfterTurnId, a.turnId, "a local-only board retains its predecessor without a history receipt");
  assert.notEqual(firstB.input.orderAfterTurnId, foreign.turnId);

  const event = h.events.findLast(held => held.turnId === a.turnId)!;
  const fetched = [parent(a.turnId, 0), parent("unknown-between", 1), parent(b.turnId, 2)];
  assert.deepEqual(overlayLiveTurnEvent(fetched, { ...event, orderBeforeTurnId: b.turnId }, parent(a.turnId, 9)).map(turn => turn.id),
    [a.turnId, "unknown-between", b.turnId], "content replacement retains fetched position around unknown history");
}

async function main() {
  await continuationWaitsForNewlySavedPredecessor();
  await aFreshExternalSuccessorStillOutranksAnOlderLocalTurn();
  await anEarlierLocalHistoryReceiptCannotBecomeASuccessor();
  await aFailedPredecessorCanStillBeInsertedBeforeLaterSaves();
  await localOnlyAndUnrelatedBoardControls();
  console.log("live-turn-ordering: delayed doubt/resume ACKs, local vs external receipts, late first creation, updates and board isolation pass");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
