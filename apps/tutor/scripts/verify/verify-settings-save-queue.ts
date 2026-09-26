import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSettingsPatchQueue } from "../../lib/account/settingsPatchQueue";
import type { SaveStatus } from "../../lib/account/settingsPatchQueue";

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function verifyQueuedSliderSurvivesFailedRequest() {
  const first = deferred();
  const sent: Array<Record<string, unknown>> = [];
  const timers: Array<() => void> = [];
  const statuses: SaveStatus[] = [];
  const queue = createSettingsPatchQueue<{ markerThickness: number; pencilColor: string }>({
    send: (patch) => { sent.push(patch); return sent.length === 1 ? first.promise : Promise.resolve(); },
    schedule: (callback) => { timers.push(callback); return timers.length; },
    cancel: () => undefined,
    onStatus: (status) => statuses.push(status),
  });
  queue.enqueue({ markerThickness: 0.8 });
  queue.enqueue({ markerThickness: 1.4 });
  queue.enqueue({ pencilColor: "blue" });
  assert.deepEqual(sent, [{ markerThickness: 0.8 }], "only one request is in flight");
  first.reject(new Error("offline"));
  await flush();
  assert.equal(statuses.at(-1), "retrying", "transient failure is visible until saved");
  assert.equal(timers.length, 1, "queued values retry without another edit");
  timers.shift()!();
  await flush();
  assert.deepEqual(sent.at(-1), { markerThickness: 1.4, pencilColor: "blue" }, "latest values win on retry");
  assert.equal(statuses.at(-1), "saved");
  queue.dispose();
}

async function verifyRetryAfterTransientFailure() {
  const sent: Array<Record<string, unknown>> = [];
  const timers: Array<() => void> = [];
  const queue = createSettingsPatchQueue<{ markerThickness: number }>({
    send: async (patch) => { sent.push(patch); if (sent.length === 1) throw new Error("unavailable"); },
    schedule: (callback) => { timers.push(callback); return timers.length; },
    cancel: () => undefined,
  });
  queue.enqueue({ markerThickness: 1.2 });
  await flush();
  assert.equal(timers.length, 1, "an isolated failed edit also retries");
  timers.shift()!();
  await flush();
  assert.deepEqual(sent, [{ markerThickness: 1.2 }, { markerThickness: 1.2 }]);
  queue.dispose();
}

async function verifyNavigationKeepsTransientRetry() {
  let retry: (() => void) | null = null;
  let calls = 0;
  const queue = createSettingsPatchQueue<{ markerThickness: number }>({
    send: async () => { if (++calls === 1) throw new Error("offline"); },
    schedule: (callback) => { retry = callback; return 42; },
    cancel: () => { throw new Error("navigation must not cancel a pending retry"); },
  });
  queue.enqueue({ markerThickness: 1 });
  await flush();
  queue.dispose();
  assert.ok(retry, "a transient failure has a retry scheduled");
  (retry as () => void)();
  await flush();
  assert.equal(calls, 2, "navigation still lets a failed edit finish");
}

async function verifyNavigationDrainsQueuedEdit() {
  const first = deferred();
  const sent: Array<Record<string, unknown>> = [];
  const statuses: string[] = [];
  const queue = createSettingsPatchQueue<{ markerThickness: number }>({
    send: (patch) => { sent.push(patch); return sent.length === 1 ? first.promise : Promise.resolve(); },
    onStatus: (status) => statuses.push(status),
  });
  queue.enqueue({ markerThickness: 0.8 });
  queue.enqueue({ markerThickness: 1.4 });
  queue.dispose(); // SettingsScreen unmounts on route change.
  first.resolve();
  await flush();
  assert.deepEqual(sent, [{ markerThickness: 0.8 }, { markerThickness: 1.4 }], "navigation must not drop the second edit");
  assert.ok(!statuses.includes("saved"), "an unmounted screen receives no later status update");
}

async function verifyPermanentFailureStopsRetrying() {
  for (const status of [401, 403]) {
    const timers: Array<() => void> = [];
    const statuses: string[] = [];
    let calls = 0;
    const queue = createSettingsPatchQueue<{ markerThickness: number }>({
      send: async () => { calls++; throw Object.assign(new Error("unauthorized"), { status }); },
      schedule: (callback) => { timers.push(callback); return timers.length; },
      onStatus: (next) => statuses.push(next),
    });
    queue.enqueue({ markerThickness: 1.2 });
    await flush();
    assert.equal(calls, 1, `${status} is attempted once`);
    assert.equal(timers.length, 0, `${status} must not schedule a retry`);
    assert.equal(statuses.at(-1), "error", `${status} must report a failed save`);
    queue.dispose();
  }
}

async function verifyServerFailureRetries() {
  const timers: Array<() => void> = [];
  let calls = 0;
  const queue = createSettingsPatchQueue<{ markerThickness: number }>({
    send: async () => { if (++calls === 1) throw Object.assign(new Error("unavailable"), { status: 503 }); },
    schedule: (callback) => { timers.push(callback); return timers.length; },
  });
  queue.enqueue({ markerThickness: 1 });
  await flush();
  assert.equal(timers.length, 1, "5xx is retryable");
  timers.shift()!();
  await flush();
  assert.equal(calls, 2);
  queue.dispose();
}

async function verifyStatusWaitsForLastPatch() {
  const first = deferred();
  const second = deferred();
  const statuses: string[] = [];
  let calls = 0;
  const queue = createSettingsPatchQueue<{ markerThickness: number }>({
    send: () => ++calls === 1 ? first.promise : second.promise,
    onStatus: (status) => statuses.push(status),
  });
  queue.enqueue({ markerThickness: 0.8 });
  queue.enqueue({ markerThickness: 1.4 });
  first.resolve();
  await flush();
  assert.equal(calls, 2);
  assert.equal(statuses.at(-1), "saving", "the second pending edit is not saved yet");
  second.resolve();
  await flush();
  assert.equal(statuses.at(-1), "saved");
  queue.dispose();
}

void (async () => {
  await verifyQueuedSliderSurvivesFailedRequest();
  await verifyRetryAfterTransientFailure();
  await verifyNavigationKeepsTransientRetry();
  await verifyNavigationDrainsQueuedEdit();
  await verifyPermanentFailureStopsRetrying();
  await verifyServerFailureRetries();
  await verifyStatusWaitsForLastPatch();
  const screen = readFileSync(new URL("../../features/account/SettingsScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /status: response\.status/, "PATCH exposes HTTP status for retry classification");
  assert.match(screen, /aria-live="polite"/, "save outcome is visible on the settings screen");
  console.log("✓ settings autosave drains after navigation, retries transient errors, stops on 4xx, and reports save status");
})().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
