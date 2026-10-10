/** Real save client + registry + student messages; only browser/network/clock IO is replaced. */
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  checkpointTurn,
  closeTurnKeepalive,
  classifySaveFailure,
  type RecordedSegmentPayload,
  type StoredTurn,
} from "../../lib/boards/boardsClient";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { SaveFailureBanner } from "../../features/tutor-session/components/BoardErrorBanner";
import { SaveStatusChip } from "../../features/tutor-session/components/SaveStatusChip";

Object.defineProperty(globalThis, "React", {
  value: React,
  configurable: true,
});
const originalFetch = globalThis.fetch;
const quota = () =>
  Response.json(
    { code: "storage_admission_rejected", error: "Storage limit reached" },
    { status: 413 },
  );
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const owner = {};
const row: RecordedSegmentPayload = {
  orderIndex: 0,
  narration: "Force is mass times acceleration.",
  spokenText: "Force is mass times acceleration.",
  command: {
    type: "WRITE",
    params: [90, 145, 19],
    text: "F = ma",
    charPosition: 0,
    narrationBefore: "",
  },
  audioBytes: new Uint8Array([0xff, 0xfb, 0x90, 0x00]),
  durationMs: 1200,
  timings: null,
};
function harness() {
  let id = 0;
  const calls: Array<{
    method: string;
    metadata: Record<string, unknown>;
    audioSizes: number[];
    answer: (r: Response) => void;
    reject: (e: Error) => void;
  }> = [];
  const timers = new Map<number, () => void>();
  globalThis.fetch = async (_url, init) => {
    const body = init?.body;
    const metadata =
      body instanceof FormData
        ? JSON.parse(String(body.get("metadata")))
        : JSON.parse(String(body));
    const audioSizes =
      body instanceof FormData
        ? [...body.entries()]
            .filter(([key]) => key.startsWith("audio-"))
            .map(([, value]) => (value instanceof Blob ? value.size : 0))
        : [];
    return new Promise<Response>((answer, reject) =>
      calls.push({
        method: init?.method ?? "GET",
        metadata,
        audioSizes,
        answer,
        reject,
      }),
    );
  };
  const registry = new LiveTurnSaveRegistry({
    transport: { checkpoint: checkpointTurn, close: closeTurnKeepalive },
    now: () => 1000,
    isOnline: () => true,
    mintId: () => `turn-${++id}`,
    setTimer: (callback) => {
      const key = ++id;
      timers.set(key, callback);
      return key;
    },
    clearTimer: (key) => {
      timers.delete(Number(key));
    },
  });
  const handle = registry.begin({
    owner,
    generation: 1,
    boardId: "board-1",
    traceId: "trace-1",
    kind: "lesson",
    question: "What is force?",
    preview: "What is force?",
    speedMultiplier: 1,
    continuesBoard: false,
  });
  const ack = async (index: number, final = false) => {
    const call = calls[index]!;
    const rows = (call.metadata.appendSegments as unknown[] | undefined) ?? [];
    const turn: StoredTurn = {
      id: handle.turnId,
      orderIndex: 0,
      question: "What is force?",
      rawResponse: "Force is mass times acceleration.",
      speedMultiplier: 1,
      traceId: "trace-1",
      sceneDocument: null,
      sceneEngineVersion: null,
      validationReport: null,
      visualStatus: "text_only",
      sceneArtifacts: null,
      segments: [],
      status: final ? "complete" : (call.metadata.status as "live" | "stopped"),
    };
    call.answer(
      Response.json({
        turn,
        serverCount: final
          ? null
          : Number(call.metadata.baseCount) + rows.length,
        serverSeq: call.metadata.seq,
        sceneAccepted: true,
        stale: false,
        final,
      }),
    );
    await tick();
  };
  return { calls, registry, handle, ack, timers };
}

async function machineCodeClassification() {
  assert.equal(
    classifySaveFailure(413, {
      code: "storage_admission_rejected",
      error: "Storage limit reached",
    }).reason,
    "quota",
    "413 admission code must explain full storage even if wording changes",
  );
  assert.equal(
    classifySaveFailure(413, {
      code: "upload_parts_invalid",
      error: "Audio too large",
    }).reason,
    "too_large",
    "real upload bounds stay distinct from account storage",
  );
  const verify = classifySaveFailure(503, {
    code: "storage_verification_failed",
    error: "Could not measure storage",
  });
  assert.equal(verify.reason, "storage_verification");
  assert.equal(verify.retryable, true);
  assert.equal(
    classifySaveFailure(429, { error: "turn storage quota exceeded" }).reason,
    "lesson_limit",
    "saved lesson count limit is not byte storage full",
  );
  assert.equal(
    classifySaveFailure(409, {
      code: "storage_commit_rejected",
      error: "upload reservation expired",
    }).reason,
    "server",
    "expired reservations can retry and are not full storage",
  );
}
async function quotaPutAndStudentRetry() {
  const h = harness();
  h.registry.recordRow(owner, 1, row, { intro: false });
  await tick();
  h.calls[0]!.answer(quota());
  await tick();
  const status = h.registry.statusFor("board-1");
  assert(status.kind === "failed");
  assert.match(status.message, /storage is full/i);
  assert.match(status.message, /delete.*board|free.*space/i);
  assert.match(status.message, /keep.*tab open/i);
  assert(h.registry.hasUnsentData(), "413 retains original row and audio");
  const completion = h.handle.complete({
    rawResponse: "Force is mass times acceleration.",
  });
  await tick();
  assert.equal((await completion).ok, false);
  assert.equal(
    h.registry.reopen("board-1").length,
    1,
    "same-tab reopen retains failed completed lesson",
  );
  const alert = renderToStaticMarkup(
    React.createElement(SaveFailureBanner, {
      message: status.message,
      onRetrySave: () => h.registry.retry("board-1"),
      onDismiss: () => {},
    }),
  );
  assert(
    alert.includes(status.message),
    "actual student banner must render specific quota cause and remedy",
  );
  const chip = renderToStaticMarkup(
    React.createElement(SaveStatusChip, {
      status,
      onRetrySave: () => h.registry.retry("board-1"),
    }),
  );
  assert(
    chip.includes(status.message),
    "header exposes specific reason after banner dismissal",
  );
  h.registry.retry("board-1");
  await tick();
  assert.equal(
    h.calls.length,
    2,
    "Try again emits a real new PUT instead of silently doing nothing",
  );
  const first = h.calls[0]!;
  const retry = h.calls[1]!;
  assert.equal(retry.method, "PUT");
  assert.equal(retry.metadata.question, first.metadata.question);
  assert.deepEqual(
    retry.metadata.appendSegments,
    first.metadata.appendSegments,
  );
  assert.deepEqual(retry.audioSizes, [row.audioBytes!.length]);
  await h.ack(1, true);
  assert.equal(h.registry.statusFor("board-1").kind, "saved");
  assert.equal(h.registry.hasUnsentData(), false);
}
async function specificBannerMessage() {
  const message =
    "Your storage is full. This lesson has not saved. Keep this tab open and free space, then try again.";
  const alert = renderToStaticMarkup(
    React.createElement(SaveFailureBanner, {
      message,
      onRetrySave: () => {},
      onDismiss: () => {},
    }),
  );
  assert(
    alert.includes(message),
    "message cannot be replaced by generic save copy",
  );
}
async function closeFailureAndRace() {
  const h = harness();
  h.registry.recordRow(owner, 1, row, { intro: false });
  await tick();
  h.registry.pageHideClose();
  await tick();
  assert.equal(h.calls[1]!.method, "PATCH");
  h.calls[1]!.answer(quota());
  await tick();
  assert.equal(
    h.registry.statusFor("board-1").kind,
    "failed",
    "failed PATCH must be visible while tab is alive",
  );
  h.registry.pageHideClose();
  await tick();
  assert.equal(
    h.calls[2]!.method,
    "PATCH",
    "failed keepalive is not deduped as saved",
  );
  await h.ack(0);
  assert.equal(
    h.calls.at(-1)!.method,
    "PUT",
    "in-flight PUT can recover failed close and send remaining stopped status",
  );
  assert.equal(
    h.registry.statusFor("board-1").kind,
    "failed",
    "an older PUT cannot clear a newer failed-close warning before recovery lands",
  );
  const recovery = h.calls.length - 1;
  await h.ack(recovery);
  const saved = h.registry.statusFor("board-1");
  assert.equal(saved.kind, "saved");
  h.calls[2]!.answer(quota());
  await tick();
  assert.equal(
    h.registry.statusFor("board-1"),
    saved,
    "late failed close cannot regress a newer successful receipt",
  );
}
async function successfulCloseRecoversOnlyCoveredFailure() {
  const h = harness();
  h.registry.recordRow(owner, 1, row, { intro: false });
  await tick();
  h.registry.pageHideClose();
  await tick();
  h.calls[1]!.answer(quota());
  await tick();
  h.registry.pageHideClose();
  await tick();
  await h.ack(2);
  assert.notEqual(
    h.registry.statusFor("board-1").kind,
    "failed",
    "a newer successful stopped close clears the close failure it covers",
  );
  await h.ack(0);
  assert.equal(
    h.calls.at(-1)!.method,
    "PUT",
    "close recovery must still send unacknowledged late audio",
  );
  assert.deepEqual(h.calls.at(-1)!.audioSizes, [row.audioBytes!.length]);
  await h.ack(h.calls.length - 1);
  assert.equal(h.registry.statusFor("board-1").kind, "saved");

  const old = harness();
  old.registry.recordRow(owner, 1, row, { intro: false });
  await tick();
  old.registry.pageHideClose();
  await tick();
  // Queue another close with changed resume state, so it is a distinct later body.
  old.registry.setResumeState(owner, 1, { checkpoint: "newer state" });
  old.registry.pageHideClose();
  await tick();
  old.calls[2]!.answer(quota());
  await tick();
  await old.ack(1);
  assert.equal(
    old.registry.statusFor("board-1").kind,
    "failed",
    "an older successful close cannot clear a newer failed close",
  );
}
async function closeNetworkFailure() {
  const h = harness();
  h.registry.recordRow(owner, 1, row, { intro: false });
  await tick();
  h.registry.pageHideClose();
  await tick();
  h.calls[1]!.reject(new Error("local fixture disconnected"));
  await tick();
  assert.equal(
    h.registry.statusFor("board-1").kind,
    "failed",
    "a rejected close transport is reported rather than swallowed",
  );
  assert(h.registry.hasUnsentData());
}
async function verificationWarningRetriesAndClears() {
  const h = harness();
  h.registry.recordRow(owner, 1, row, { intro: false });
  await tick();
  h.calls[0]!.answer(
    Response.json(
      {
        code: "storage_verification_failed",
        error: "Storage could not be verified",
      },
      { status: 503 },
    ),
  );
  await tick();
  const status = h.registry.statusFor("board-1");
  assert(status.kind === "failed");
  assert.match(status.message, /could not verify.*storage/i);
  assert.match(status.message, /not saved|not save/i);
  assert.match(status.message, /keep.*tab open/i);
  const alert = renderToStaticMarkup(
    React.createElement(SaveFailureBanner, {
      message: status.message,
      onRetrySave: () => h.registry.retry("board-1"),
      onDismiss: () => {},
    }),
  );
  assert(
    alert.includes(status.message),
    "temporary verification failure is explained from its first response",
  );
  assert(h.registry.hasUnsentData());
  const retry = h.timers.values().next().value;
  assert(retry);
  retry();
  await tick();
  assert.equal(
    h.calls.length,
    2,
    "visible warning does not stop the bounded automatic retry",
  );
  assert.equal(
    h.registry.statusFor("board-1").kind,
    "failed",
    "warning remains until its retry lands",
  );
  await h.ack(1);
  assert.equal(h.registry.statusFor("board-1").kind, "saved");
}
async function main() {
  const failures: string[] = [];
  for (const test of [
    machineCodeClassification,
    specificBannerMessage,
    quotaPutAndStudentRetry,
    closeFailureAndRace,
    successfulCloseRecoversOnlyCoveredFailure,
    closeNetworkFailure,
    verificationWarningRetriesAndClears,
  ]) {
    try {
      await test();
      console.log(`PASS ${test.name}`);
    } catch (error) {
      failures.push(`${test.name}: ${String(error)}`);
      console.error(`FAIL ${failures.at(-1)}`);
    }
  }
  globalThis.fetch = originalFetch;
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(
    "verify-storage-save-client: 7 actual-client and consumer groups passed",
  );
}
void main().catch((error: unknown) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
