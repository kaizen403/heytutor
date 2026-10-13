/** Real transport/admission; only the Web Locks platform's release IPC is controlled. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { LessonClaim } from "../../features/tutor-session/lib/turn/lessonOwnership";

const sourcePath = process.env.LESSON_LOCK_RELEASE_SOURCE ?? path.resolve(
  import.meta.dirname, "../../features/tutor-session/lib/turn/lessonOwnership.ts",
);
const sourceModule = { exports: {} };
new Function("module", "exports", ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(sourceModule, sourceModule.exports);
const { LessonAdmission, browserLessonTransport } = sourceModule.exports as typeof import(
  "../../features/tutor-session/lib/turn/lessonOwnership"
);
const tick = async () => { for (let i = 0; i < 64; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function observe<T>(promise: Promise<T>) {
  const outcome: { state: "pending" | "fulfilled" | "rejected"; value?: T; error?: unknown } = { state: "pending" };
  void promise.then(value => { outcome.state = "fulfilled"; outcome.value = value; }, error => {
    outcome.state = "rejected"; outcome.error = error;
  });
  return outcome;
}
type PlatformRequest = {
  name: string;
  callback: (lock: { name: string } | null) => Promise<void>;
  completion: ReturnType<typeof deferred<void>>;
  granted: boolean;
  ownsLock: boolean;
  callbackFinished: boolean;
  requestSettled: boolean;
};
/** Callback completion does not remove a lock: only the released request promise does. */
function platform() {
  const held = new Map<string, PlatformRequest | "foreign">();
  const requests: PlatformRequest[] = [];
  let queries = 0;
  let holdNextGrant = false;
  let queryError = false;
  let beforeGrant: (() => void) | undefined;
  const grant = (request: PlatformRequest) => {
    assert.equal(request.granted, false, "platform request callback runs once");
    request.granted = true;
    beforeGrant?.();
    request.ownsLock = !held.has(request.name);
    if (request.ownsLock) held.set(request.name, request);
    void request.callback(request.ownsLock ? { name: request.name } : null).then(() => {
      request.callbackFinished = true;
      if (!request.ownsLock) {
        request.requestSettled = true;
        request.completion.resolve();
      }
    }, error => {
      request.callbackFinished = true;
      request.requestSettled = true;
      if (held.get(request.name) === request) held.delete(request.name);
      request.completion.reject(error);
    });
  };
  return {
    held,
    requests,
    get queries() { return queries; },
    deferNextGrant() { holdNextGrant = true; },
    setBeforeGrant(fn: () => void) { beforeGrant = fn; },
    failQuery() { queryError = true; },
    grant,
    releasePhysical(request: PlatformRequest) {
      assert.equal(request.callbackFinished, true, "release IPC follows callback completion");
      if (held.get(request.name) === request) held.delete(request.name);
    },
    settleRelease(request: PlatformRequest, reject = false) {
      assert.equal(request.callbackFinished, true, "released promise follows callback completion");
      assert.equal(request.requestSettled, false, "released promise settles once");
      request.requestSettled = true;
      if (reject) request.completion.reject(Error("controlled release IPC rejection"));
      else request.completion.resolve();
    },
    locks: {
      request(name: string, options: { mode: string; ifAvailable: boolean; signal?: unknown }, callback: PlatformRequest["callback"]) {
        assert.deepEqual(options, { mode: "exclusive", ifAvailable: true }, "retain nonblocking exclusive Web Lock policy");
        const request: PlatformRequest = {
          name, callback, completion: deferred<void>(), granted: false,
          ownsLock: false, callbackFinished: false, requestSettled: false,
        };
        requests.push(request);
        if (holdNextGrant) holdNextGrant = false;
        else grant(request);
        return request.completion.promise;
      },
      async query() {
        queries++;
        if (queryError) throw Error("controlled query failure");
        return { held: [...held.keys()].map(name => ({ name, mode: "exclusive" })), pending: [] };
      },
    },
  };
}
function fixture() {
  const locks = platform();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: locks.locks } });
  const transport = browserLessonTransport();
  return { locks, transport, admission: new LessonAdmission(transport) };
}
async function acquired(f: ReturnType<typeof fixture>, board = "board"): Promise<LessonClaim> {
  const claim = await f.transport.acquire(board, new AbortController().signal);
  assert.equal(typeof claim, "object", "fixture acquires actual transport claim");
  if (typeof claim === "string") throw Error("missing real claim");
  return claim;
}
async function finishRelease(f: ReturnType<typeof fixture>, request: PlatformRequest, reject = false) {
  await tick();
  f.locks.releasePhysical(request);
  f.locks.settleRelease(request, reject);
  await tick();
}
const cases: Array<[string, () => Promise<void>]> = [
  ["probe-waits-released-promise-not-lesson-run", async () => {
    const f = fixture();
    const owner = {};
    const run = deferred<void>();
    const receipt = f.admission.start(owner, "board", { current: () => true, validate: async () => true, run: () => run.promise });
    assert.equal(await receipt.admitted, true);
    const originalRun = observe(receipt.finished);
    f.admission.cancel(owner);
    assert.equal(f.admission.hasAttempt(owner), false, "Stop immediately removes its admission attempt");
    const probe = observe(f.admission.probe("board"));
    await tick();
    assert.equal(probe.state, "pending", "own post-Stop probe must await physical Web Lock release");
    assert.equal(f.locks.queries, 0, "do not query transient own held lock before release IPC settles");
    assert.equal(originalRun.state, "pending", "the interrupted lesson run is deliberately still pending");
    await finishRelease(f, f.locks.requests[0]);
    assert.equal(probe.value, "inactive", "fresh manager query observes released own lock");
    assert.equal(originalRun.state, "pending", "probe never waits for unrelated lesson cleanup");
    run.resolve();
    await receipt.finished;
  }],
  ["same-owner-successor-waits-physical-release", async () => {
    const f = fixture();
    const owner = {};
    const oldRun = deferred<void>();
    const nextRun = deferred<void>();
    const old = f.admission.start(owner, "board", { current: () => true, validate: async () => true, run: () => oldRun.promise });
    assert.equal(await old.admitted, true);
    f.admission.cancel(owner);
    let validations = 0, providerStarts = 0;
    const next = f.admission.start(owner, "board", {
      current: () => true,
      validate: async () => { validations++; return true; },
      run: () => { providerStarts++; return nextRun.promise; },
    });
    const admitted = observe(next.admitted);
    await tick();
    assert.equal(admitted.state, "pending", "fast Continue waits for its prior own platform release");
    assert.equal(f.locks.requests.length, 1, "do not dispatch replacement lock request during own release IPC");
    assert.equal(validations, 0);
    assert.equal(providerStarts, 0);
    await finishRelease(f, f.locks.requests[0]);
    assert.equal(await next.admitted, true);
    assert.equal(validations, 1);
    assert.equal(providerStarts, 1);
    oldRun.resolve();
    await old.finished;
    assert.equal(await f.admission.probe("board"), "active", "late old finally cannot release successor claim");
    assert.equal(f.admission.hasAttempt(owner), true);
    f.admission.cancel(owner);
    await finishRelease(f, f.locks.requests[1]);
    nextRun.resolve();
    await next.finished;
  }],
  ["cancel-successor-during-release-wait", async () => {
    const f = fixture();
    const oldClaim = await acquired(f);
    oldClaim.release();
    const owner = {};
    let validations = 0, providerStarts = 0;
    const next = f.admission.start(owner, "board", {
      current: () => true,
      validate: async () => { validations++; return true; },
      run: async () => { providerStarts++; },
    });
    await tick();
    f.admission.cancel(owner);
    await finishRelease(f, f.locks.requests[0]);
    assert.equal(await next.admitted, false);
    await next.finished;
    assert.equal(f.locks.requests.length, 1, "aborted waiter must recheck signal before replacement request");
    assert.equal(validations, 0);
    assert.equal(providerStarts, 0);
  }],
  ["other-board-probe-and-acquire-independent", async () => {
    const f = fixture();
    const claim = await acquired(f, "a");
    claim.release();
    const waiting = observe(f.transport.probe("a"));
    const otherProbe = observe(f.transport.probe("b"));
    const otherAcquire = observe(f.transport.acquire("b", new AbortController().signal));
    await tick();
    assert.equal(otherProbe.value, "inactive", "unrelated board probe must not await another board's release");
    assert.equal(typeof otherAcquire.value, "object", "unrelated board acquire must not await another board's release");
    if (!otherAcquire.value || typeof otherAcquire.value === "string") throw Error("missing other board claim");
    const other = otherAcquire.value;
    assert.equal(await f.transport.probe("b"), "active");
    assert.equal(waiting.state, "pending", "only the released board is fenced");
    other.release();
    await finishRelease(f, f.locks.requests[1]);
    await finishRelease(f, f.locks.requests[0]);
    assert.equal(waiting.value, "inactive");
  }],
  ["unreleased-claim-stays-active-and-busy", async () => {
    const f = fixture();
    const claim = await acquired(f);
    assert.equal(await f.transport.probe("board"), "active");
    assert.equal(await f.transport.acquire("board", new AbortController().signal), "busy");
    assert.equal(f.locks.requests.length, 2, "ordinary active owner still uses nonblocking manager arbitration");
    claim.release();
    await finishRelease(f, f.locks.requests[0]);
  }],
  ["foreign-owner-remains-authoritative-after-own-release", async () => {
    const f = fixture();
    const claim = await acquired(f);
    claim.release();
    const probe = observe(f.transport.probe("board"));
    const next = observe(f.transport.acquire("board", new AbortController().signal));
    await tick();
    const request = f.locks.requests[0];
    f.locks.releasePhysical(request);
    f.locks.held.set(request.name, "foreign");
    f.locks.settleRelease(request);
    await tick();
    assert.equal(probe.value, "active", "own completion does not manufacture inactivity over another owner");
    assert.equal(next.value, "busy", "replacement acquisition still respects foreign owner");
  }],
  ["release-is-idempotent", async () => {
    const f = fixture();
    const claim = await acquired(f);
    claim.release(); claim.release(); claim.release();
    const first = observe(f.transport.probe("board"));
    const second = observe(f.transport.probe("board"));
    await tick();
    assert.equal(first.state, "pending");
    assert.equal(second.state, "pending");
    await finishRelease(f, f.locks.requests[0]);
    assert.equal(first.value, "inactive");
    assert.equal(second.value, "inactive");
    claim.release();
    assert.equal(await f.transport.probe("board"), "inactive", "late repeat release must not create an orphaned barrier");
    assert.equal(f.locks.requests.length, 1);
  }],
  ["abort-before-request-and-during-grant", async () => {
    const f = fixture();
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    assert.equal(await f.transport.acquire("board", alreadyAborted.signal), "busy");
    assert.equal(f.locks.requests.length, 0);
    const raced = new AbortController();
    f.locks.setBeforeGrant(() => raced.abort());
    const claim = await f.transport.acquire("board", raced.signal);
    assert.equal(typeof claim, "object", "grant-race returns an already-released claim for admission's current guard");
    const probe = observe(f.transport.probe("board"));
    await tick();
    assert.equal(probe.state, "pending", "aborted granted claim still waits for physical release");
    await finishRelease(f, f.locks.requests[0]);
    assert.equal(probe.value, "inactive");
  }],
  ["already-aborted-acquire-does-not-wait-own-release", async () => {
    const f = fixture();
    const claim = await acquired(f);
    claim.release();
    const aborted = new AbortController();
    aborted.abort();
    const next = observe(f.transport.acquire("board", aborted.signal));
    await tick();
    assert.equal(next.value, "busy", "already-aborted acquire must return before an outstanding own-release wait");
    assert.equal(f.locks.requests.length, 1);
    await finishRelease(f, f.locks.requests[0]);
  }],
  ["rejected-release-settles-own-barrier", async () => {
    const f = fixture();
    const claim = await acquired(f);
    claim.release();
    const probe = observe(f.admission.probe("board"));
    await tick();
    assert.equal(probe.state, "pending");
    await finishRelease(f, f.locks.requests[0], true);
    assert.equal(probe.value, "inactive", "rejected request settlement must not leave a permanent own-release wait");
    assert.equal(await f.transport.probe("board"), "inactive");
  }],
  ["late-old-settlement-cannot-clear-new-own-release", async () => {
    const f = fixture();
    const first = await acquired(f);
    // A second native request was dispatched before release was published, but its native grant task is delayed.
    f.locks.deferNextGrant();
    const secondPromise = f.transport.acquire("board", new AbortController().signal);
    assert.equal(f.locks.requests.length, 2);
    first.release();
    await tick();
    f.locks.releasePhysical(f.locks.requests[0]);
    f.locks.grant(f.locks.requests[1]);
    const second = await secondPromise;
    assert.equal(typeof second, "object");
    if (typeof second === "string") throw Error("missing successor claim");
    second.release();
    await tick();
    first.release(); // Repeated old-owner cleanup cannot overwrite the newer release barrier.
    f.locks.settleRelease(f.locks.requests[0]);
    await tick();
    const probe = observe(f.transport.probe("board"));
    const successor = observe(f.transport.acquire("board", new AbortController().signal));
    await tick();
    assert.equal(probe.state, "pending", "old completion cannot erase the newer board-specific release fence");
    assert.equal(successor.state, "pending");
    assert.equal(f.locks.requests.length, 2);
    await finishRelease(f, f.locks.requests[1]);
    assert.equal(probe.value, "inactive");
    assert.equal(typeof successor.value, "object");
    if (!successor.value || typeof successor.value === "string") throw Error("missing final successor claim");
    successor.value.release();
    await finishRelease(f, f.locks.requests[2]);
  }],
  ["waiting-probe-follows-newer-own-release", async () => {
    const f = fixture();
    const first = await acquired(f);
    f.locks.deferNextGrant();
    const secondPromise = f.transport.acquire("board", new AbortController().signal);
    first.release();
    await tick();
    const probe = observe(f.transport.probe("board"));
    f.locks.releasePhysical(f.locks.requests[0]);
    f.locks.grant(f.locks.requests[1]);
    const second = await secondPromise;
    if (typeof second === "string") throw Error("missing successor claim");
    second.release();
    await tick();
    f.locks.settleRelease(f.locks.requests[0]);
    await tick();
    assert.equal(probe.state, "pending", "a waiting probe must follow the newer own-release barrier before querying");
    assert.equal(f.locks.queries, 0);
    await finishRelease(f, f.locks.requests[1]);
    assert.equal(probe.value, "inactive");
  }],
  ["waiting-acquire-follows-newer-own-release", async () => {
    const f = fixture();
    const first = await acquired(f);
    f.locks.deferNextGrant();
    const secondPromise = f.transport.acquire("board", new AbortController().signal);
    first.release();
    await tick();
    const next = observe(f.transport.acquire("board", new AbortController().signal));
    f.locks.releasePhysical(f.locks.requests[0]);
    f.locks.grant(f.locks.requests[1]);
    const second = await secondPromise;
    if (typeof second === "string") throw Error("missing successor claim");
    second.release();
    await tick();
    f.locks.settleRelease(f.locks.requests[0]);
    await tick();
    assert.equal(next.state, "pending", "a waiting acquire must follow the newer own-release barrier before dispatching");
    assert.equal(f.locks.requests.length, 2);
    await finishRelease(f, f.locks.requests[1]);
    if (!next.value || typeof next.value === "string") throw Error("missing final successor claim");
    next.value.release();
    await finishRelease(f, f.locks.requests[2]);
  }],
  ["manager-unknown-stays-conservative", async () => {
    const f = fixture();
    f.locks.failQuery();
    assert.equal(await f.admission.probe("board"), "unknown");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {} } });
    assert.equal(await f.transport.probe("board"), "unknown");
    assert.equal(await f.transport.acquire("board", new AbortController().signal), "unknown");
  }],
  ["waiting-probe-rechecks-after-helper-return", async () => {
    const f = fixture();
    const first = await acquired(f);
    f.locks.deferNextGrant();
    const secondPromise = f.transport.acquire("board", new AbortController().signal);
    first.release();
    await tick();
    const trace: string[] = [];
    const query = f.locks.locks.query;
    f.locks.locks.query = async () => { trace.push("manager-query"); return query(); };
    const waiting = observe(f.transport.probe("board"));
    f.locks.releasePhysical(f.locks.requests[0]);
    f.locks.grant(f.locks.requests[1]);
    const second = await secondPromise;
    if (typeof second === "string") throw Error("missing successor claim");
    f.locks.settleRelease(f.locks.requests[0]);
    // The next native grant's cleanup publishes its release in a microtask
    // between the awaited helper returning and the public caller querying.
    await Promise.resolve();
    await Promise.resolve();
    second.release();
    trace.push("second-release-returned");
    await tick();
    assert.equal(waiting.state, "pending", "probe must follow a newer release published before its manager query");
    assert.deepEqual(trace, ["second-release-returned"], "no transient manager query after a newer own release");
    assert.equal(f.locks.requests[1].requestSettled, false);
    await finishRelease(f, f.locks.requests[1]);
    assert.equal(waiting.value, "inactive");
  }],
  ["waiting-acquire-rechecks-after-helper-return", async () => {
    const f = fixture();
    const first = await acquired(f);
    f.locks.deferNextGrant();
    const secondPromise = f.transport.acquire("board", new AbortController().signal);
    first.release();
    await tick();
    const trace: string[] = [];
    const request = f.locks.locks.request;
    f.locks.locks.request = (...args) => { trace.push("manager-request"); return request(...args); };
    const waiting = observe(f.transport.acquire("board", new AbortController().signal));
    f.locks.releasePhysical(f.locks.requests[0]);
    f.locks.grant(f.locks.requests[1]);
    const second = await secondPromise;
    if (typeof second === "string") throw Error("missing successor claim");
    f.locks.settleRelease(f.locks.requests[0]);
    await Promise.resolve();
    await Promise.resolve();
    second.release();
    trace.push("second-release-returned");
    await tick();
    assert.equal(waiting.state, "pending", "acquire must follow a newer release published before its manager request");
    assert.deepEqual(trace, ["second-release-returned"], "no transient busy request after a newer own release");
    assert.equal(f.locks.requests.length, 2);
    await finishRelease(f, f.locks.requests[1]);
    if (!waiting.value || typeof waiting.value === "string") throw Error("missing final successor claim");
    waiting.value.release();
    await finishRelease(f, f.locks.requests[2]);
  }],
];
async function main() {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const requested = process.env.LESSON_LOCK_RELEASE_CASE;
  const selected = requested ? cases.filter(([name]) => name === requested) : cases;
  assert.ok(selected.length > 0, `unknown LESSON_LOCK_RELEASE_CASE: ${requested}`);
  try {
    for (const [name, run] of selected) {
      let timeout!: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          run(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new assert.AssertionError({
              message: `gate did not settle: ${name}`, actual: "pending", expected: "settled",
            })), 1_000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      console.log(`PASS ${name}`);
    }
    console.log(`PASS lesson lock release: ${selected.length} actual transport/admission groups`);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
