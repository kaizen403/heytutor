/**
 * Every exit of a billed lesson saves it. Source anchors over the hooks that
 * own those exits; the save logic itself is driven in `verify-live-turn-save.ts`.
 *
 * - `handleQuestion` runs the question inside one try whose finally closes the
 *   turn's save: completion, Stop, a board switch, a 402, an error, a planning
 *   failure and an uncaught exception all pass through it.
 * - The save handle is minted right after billing passed, before the first
 *   await that can end the turn, and the page record is attached to it.
 * - Completion states the turn complete and the outcome is awaited before an
 *   automatic recording reports success. Nothing claims "saved" early, and the
 *   old one-shot and before-a-doubt saves are gone.
 * - Stop closes at once (the aborted chain may never unwind), after a figure
 *   kept for a doubt is committed. The board switch still stops the turn.
 * - Figure intro rows are released on commit and dropped on rollback.
 * - Each finished segment is recorded, and the segment Stop cut off is kept.
 * - `pagehide` sends the keepalive close before halting, in the capture phase;
 *   `beforeunload` prompts only with unsent data; telemetry's page away body
 *   gives room to the close.
 * - Reopening a board waits for its saves and keeps this tab's unsaved turns
 *   over the server copy; a stopped code lesson is not
 *   marked complete; the shell gets the save status, retry, and the live turn.
 *
 * Slices are taken between two anchors, and both must exist: a missing end
 * anchor fails the gate instead of slicing to the end of the file.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

function between(source: string, file: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert(from >= 0, `${file}: start anchor "${start}" is gone. Repoint this gate; do not relax it.`);
  const to = source.indexOf(end, from + start.length);
  assert(to > from, `${file}: end anchor "${end}" is gone after "${start}". Repoint this gate; do not relax it.`);
  return source.slice(from, to);
}

function inOrder(source: string, label: string, ...parts: string[]): void {
  let at = -1;
  for (const part of parts) {
    const next = source.indexOf(part, at + 1);
    assert(next > at, `${label}: "${part}" is missing or out of order`);
    at = next;
  }
}

let checks = 0;
const check = (condition: unknown, message: string) => {
  assert(condition, message);
  checks += 1;
};

// --- useQuestionHandler ------------------------------------------------------
{
  const file = "features/tutor-session/hooks/turn/useQuestionHandler.ts";
  const source = read(file);
  const wrapper = between(source, file, "const handleQuestion = useCallback(", "return { handleQuestion };");
  inOrder(wrapper, "handleQuestion closes the save in one finally",
    "const saveExit: LiveTurnSaveExit = { handle: null };",
    "try {",
    "return await teachQuestion(rawQuestion, admittedOptions, saveExit);",
    "} finally {",
    "saveExit.handle?.close();",
  );
  check(true, "one finally");

  const body = between(source, file, "const teachQuestion = useCallback(", "const handleQuestion = useCallback(");
  const refusal = between(body, file, "if (!billed.ok) {", "const liveSave = sessionId");
  check(refusal.includes("finishLectureUi(turnGeneration);\n        return;"), "a billing refusal returns before any save handle exists");
  const begin = between(body, file, "const liveSave = sessionId", "saveExit.handle = liveSave;");
  check(begin.includes("liveTurnSave().begin({") && begin.includes("owner: cancelRef") && begin.includes("generation: turnGeneration"),
    "the save handle is minted for this shell's turn once billing passed");
  check(begin.includes("traceId: currentTraceIdRef.current"), "saved under the billed trace");
  const afterBilling = body.slice(body.indexOf("const liveSave = sessionId"));
  const firstAwait = afterBilling.search(/\bawait\b/);
  const handoff = afterBilling.indexOf("saveExit.handle = liveSave;");
  check(firstAwait > 0 && handoff > 0 && handoff < firstAwait && afterBilling.indexOf("await beginBoardEpoch()") >= firstAwait,
    "the handle reaches the finally before the first await that can end the turn");
  inOrder(body, "the page record goes to the save", "boardPageRef.current = page;", "liveSave?.setPage(page);");

  const completion = between(body, file, "if (liveSave && rawResponseRef.current) {", "} catch (error) {");
  inOrder(completion, "completion saves complete and awaits the outcome for recordings",
    "const completed = liveSave.complete({ rawResponse: rawResponseRef.current });",
    "if (onComplete) {",
    "const saved = await completed;",
    "if (saved.ok) {",
  );
  check(!/page\.turn\.saved\s*=\s*true/.test(source), "nothing claims the turn saved before the server answered");
  check(!source.includes("saveTurnToBoard") && !/\bsaveTurn\(/.test(source) && !source.includes("partialTurnSave"),
    "the one-shot save and the save before a doubt are gone");
}

// --- useTurnControl ------------------------------------------------------------
{
  const file = "features/tutor-session/hooks/turn/useTurnControl.ts";
  const source = read(file);
  const stop = between(source, file, "const stopTurn = useCallback(", "useEffect(() => {\n    stopTurnRef.current = stopTurn;");
  inOrder(stop, "Stop closes the save after a kept figure commits",
    "introKeptByStopRef.current = activeIntroTransaction;",
    "activeIntroTransactionRef.current = null;",
    "liveTurnSave().closeOwner(cancelRef);",
    "finishLectureUi();",
  );
  check(stop.split("liveTurnSave().closeOwner(cancelRef);").length === 2, "Stop closes exactly once, after the figure");
  const idleReturn = stop.indexOf('if (phase === "idle" && !isReplaying) {');
  check(idleReturn > 0 && stop.indexOf("liveTurnSave().closeOwner(cancelRef);") > idleReturn,
    "an idle Stop (a finished turn) does not touch the save");
  const intro = between(source, file, "const enqueueVerifiedIntro = useCallback(", "const stopTurn = useCallback(");
  inOrder(intro, "the figure's held rows go out when it commits",
    "wb.commitDrawTransaction(transactionId);",
    "page.figureDrawn = true;",
    "liveTurnSave().figureCommitted(cancelRef, turnGeneration);",
  );
  inOrder(intro, "a rolled back figure's rows are dropped",
    "recordedSegmentsRef.current = recordedSegmentsRef.current.filter((row) => !introRecordedRows.has(row));",
    "liveTurnSave().dropIntroRows(cancelRef, turnGeneration);",
  );
}

// --- useSegmentRunner ------------------------------------------------------------
{
  const file = "features/tutor-session/hooks/turn/useSegmentRunner.ts";
  const source = read(file);
  const record = between(source, file, "if (segmentCompleted && !isCancelled()) {", 'tutorDebug("segment", "runSegment end"');
  inOrder(record, "each finished segment is saved as it is recorded",
    "preparedSave.complete(recordedRow)",
    "recordedSegmentsRef.current.push(recordedRow);",
    "liveTurnSave().recordRow(cancelRef, turnGeneration, recordedRow, { intro: onRecorded !== undefined });",
  );
  check(record.includes("preparedSave?.interrupt();"), "failed or cancelled shown work settles its prepared token");
  const prepare = between(source, file, "const preparedSave = liveTurnSave().prepareSegment", "let timingTelemetryCount");
  check(prepare.includes("audioBytes: null, durationMs: null, timings: null") && prepare.includes("segment.verifiedDiagramIntro === true"), "prepared cuts are silent and verified intro remains atomic");
  check(prepare.includes("preparedSave?.markShown()"), "only actual observations mark the prepared token");
  check(source.includes("onInkStarted: markShown") && between(source, file, "const markVoiceStarted = () =>", "const speakOptions").includes("markShown();"), "ink and accepted voice observations both establish shown work");

}

// --- page lifecycle ----------------------------------------------------------------
{
  const file = "features/tutor-session/hooks/useLecturePageHalt.ts";
  const source = read(file);
  const pageHide = between(source, file, "const onPageHide = () => {", "const onBeforeUnload");
  inOrder(pageHide, "pagehide sends the keepalive close before it halts", "liveTurnSave().pageHideClose();", "halt();");
  check(source.includes('window.addEventListener("pagehide", onPageHide, { capture: true });'),
    "registered in the capture phase, ahead of the telemetry listener a turn adds later");
  const unload = between(source, file, "const onBeforeUnload = (event: BeforeUnloadEvent) => {", 'window.addEventListener("pagehide"');
  inOrder(unload, "beforeunload prompts only with unsent lesson data",
    "if (liveTurnSave().hasUnsentData()) {", "event.preventDefault();", "return;");
  check(!unload.includes("halt();"), "cancelled beforeunload never halts even without dirty rows");

  const telemetry = read("lib/obs/turnTelemetry.ts");
  const lifecycle = between(telemetry, "turnTelemetry.ts", "if (lifecycle) {", "await send(pendingEvents, pendingMetadata, lifecycle);");
  check(lifecycle.includes("MAX_PAGE_AWAY_TELEMETRY_BYTES"), "telemetry's page away body leaves room for the lesson close");
}

// --- useBoardSession ----------------------------------------------------------------
{
  const file = "features/tutor-session/hooks/useBoardSession.ts";
  const source = read(file);
  const restore = between(source, file, "const restoreBoardFromApi = useCallback(", "const settleBoardRestore = useCallback(");
  inOrder(restore, "reopening a board waits for its own saves first",
    "await liveTurnSave().drained(boardId, RESTORE_SAVE_DRAIN_MS);",
    "if (isStale()) return;",
    "await fetchBoardDetail(boardId);",
  );
  check(/const RESTORE_SAVE_DRAIN_MS = 8_000;/.test(source), "for at most 8 s");
  inOrder(restore, "a failed or slow save's local turns are laid over the older server copy before the board is drawn",
    "await fetchBoardDetail(boardId);",
    "storedTurnsRef.current = detail?.turns ?? [];",
    "for (const local of liveTurnSave().reopen(boardId)) mirrorLiveTurnRef.current(local);",
    "const turns = storedTurnsRef.current;",
    "conversationHistoryRef.current = compactConversationHistory(",
    "for (const turn of turns) {",
  );
  checks += 1;
  check(restore.includes('if (codeLesson && storedTurnStatus(turn) === "complete") {'),
    "a stopped code lesson is not marked complete");
  check(!/\n\s*if \(codeLesson\) \{\s*codeLessonControllerRef\?\.current\?\.markLessonComplete\(\);/.test(restore),
    "no unguarded markLessonComplete");
  const mirror = between(source, file, "const mirrorLiveTurn = useCallback(", "const mirrorLiveTurnRef");
  check(mirror.includes("if (event.boardId !== activeSessionIdRef.current) return;"),
    "a stopped lesson lands in storedTurnsRef only while its board is open");
  const switchEffect = between(source, file, "const generation = ++restoreGenerationRef.current;\n    stopTurnRef.current?.();", "}, [sessionId, cancelRef, stopTurnRef, revokeReplayBlobUrls]);");
  check(switchEffect.length > 0, "a board switch still stops (and so closes) the live turn");
  const api = between(source, file, "    persistTurnForReplay,\n    settleBoardRestore,", "  };\n}");
  for (const name of ["saveStatus", "retrySave", "getLiveTurn", "hasLiveTurn"]) {
    check(api.includes(`${name},`), `useBoardSession returns ${name} for the shell`);
  }
}

console.log(`verify-lesson-never-lost: every exit saves (${checks} checks)`);
