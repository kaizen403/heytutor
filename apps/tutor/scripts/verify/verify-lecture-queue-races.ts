import * as React from "react";
import { makeLectureJobs, JOB_TIMEOUT_MS } from "../../features/admin/lib/lectureJobs";
import { useLectureQueue } from "../../features/admin/hooks/useLectureQueue";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const question = { id: "p", topicId: "physics|1|test", difficulty: "easy" as const, question: "Explain motion" };
const sameTick = makeLectureJobs([question], 1234);
const nextTick = makeLectureJobs([question], 1234);
assert(sameTick[0]!.id !== nextTick[0]!.id, "same-millisecond enqueues must have distinct job IDs");

// Exercise the real hook without mounting the expensive tutor shell or calling paid APIs.
// A tiny React dispatcher retains hooks across renders; fetch is a local board-only fake.
type Slot = { value: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const slots: Slot[] = [];
let cursor = 0;
const effects: Array<() => void> = [];
const internals = (React as typeof React & {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
const originalDispatcher = internals.H;
const depsChanged = (old?: readonly unknown[], next?: readonly unknown[]) =>
  !old || !next || old.length !== next.length || old.some((value, i) => !Object.is(value, next[i]));
const dispatcher = {
  useState<T>(initial: T | (() => T)) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: typeof initial === "function" ? (initial as () => T)() : initial };
    return [slots[index]!.value as T, (next: T | ((previous: T) => T)) => {
      const previous = slots[index]!.value as T;
      slots[index]!.value = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
    }] as const;
  },
  useRef<T>(initial: T) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: { current: initial } };
    return slots[index]!.value as { current: T };
  },
  useMemo<T>(make: () => T, deps?: readonly unknown[]) {
    const index = cursor++;
    if (!slots[index] || depsChanged(slots[index]!.deps, deps)) slots[index] = { value: make(), deps };
    return slots[index]!.value as T;
  },
  useCallback<T>(callback: T, deps?: readonly unknown[]) { return this.useMemo(() => callback, deps); },
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
    const index = cursor++;
    if (slots[index] && !depsChanged(slots[index]!.deps, deps)) return;
    effects.push(() => {
      slots[index]?.cleanup?.();
      slots[index] = { value: null, deps, cleanup: effect() || undefined };
    });
  },
};
function RenderQueue() { return useLectureQueue(); }
function render() {
  cursor = 0;
  internals.H = dispatcher;
  try { return RenderQueue(); }
  finally { internals.H = originalDispatcher; effects.splice(0).forEach((effect) => effect()); }
}
const boardRequests: Array<ReturnType<typeof deferred<Response>>> = [];
const deletedBoardIds: string[] = [];
const conditionalDeleteIds: string[] = [];
const boardDetails = new Map<string, { preview: string; turns: unknown[] }>();
const turnsArrivingAfterInspection = new Set<string>();
const pendingDetails = new Map<string, ReturnType<typeof deferred<Response>>>();
const detailResponses = new Map<string, Response>();
const deleteResponses = new Map<string, Response | Error>();
let failNextBoardList = false;
const boardIndex = new Map<string, string>();
const timeoutHandlers: Array<() => void> = [];
const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: unknown }).window;
(globalThis as { window: unknown }).window = {
  localStorage: { getItem: (key: string) => boardIndex.get(key) ?? null, setItem: (key: string, value: string) => { boardIndex.set(key, value); } },
  setTimeout: (fn: () => void, ms: number) => {
    if (ms === JOB_TIMEOUT_MS) { timeoutHandlers.push(fn); return timeoutHandlers.length; }
    return setTimeout(fn, 0);
  },
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
};
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/api/boards") && init?.method === "POST") {
    const request = deferred<Response>();
    boardRequests.push(request);
    return request.promise;
  }
  if (new URL(url, "http://localhost").pathname === "/api/boards" && !init?.method) {
    if (failNextBoardList) { failNextBoardList = false; throw new Error("offline listing"); }
    return Response.json({ boards: [] });
  }
  if (url.endsWith("/api/board-name")) return Response.json({ title: "Motion" });
  if (init?.method === "DELETE" && url.includes("/api/boards/")) {
    const [path, query] = url.split("?");
    const id = path!.split("/").at(-1)!;
    deletedBoardIds.push(id);
    if (new URLSearchParams(query).get("ifEmpty") === "1") conditionalDeleteIds.push(id);
    if (turnsArrivingAfterInspection.has(id)) {
      boardDetails.set(id, { preview: "", turns: [{}] });
      if (new URLSearchParams(query).get("ifEmpty") === "1") {
        return Response.json({ error: "board is not empty" }, { status: 409 });
      }
    }
    const response = deleteResponses.get(id);
    if (response instanceof Error) throw response;
    return response ?? Response.json({ ok: true });
  }
  if (!init?.method && url.includes("/api/boards/")) {
    const id = new URL(url, "http://localhost").pathname.split("/").at(-1)!;
    const pending = pendingDetails.get(id);
    if (pending) return pending.promise;
    const custom = detailResponses.get(id);
    if (custom) return custom;
    const detail = boardDetails.get(id) ?? { preview: "", turns: [] };
    return Response.json({ board: { id, preview: detail.preview }, turns: detail.turns });
  }
  if (init?.method === "PATCH") return Response.json({ board: null });
  throw new Error(`Unexpected external request: ${url}`);
};
function boardResponse(id: string) {
  return Response.json({ board: { id, title: "Motion", preview: "", createdAt: 1 } });
}
async function tick() { await new Promise((resolve) => setTimeout(resolve, 5)); }
async function verify() {
try {
  let queue = render();
  let staleReady = 0;
  let currentReady = 0;
  queue.enqueue([question], { onReady: () => { staleReady++; } });
  assert(boardRequests.length === 1, "first board creation must start");
  const oldId = render().jobs[0]!.id;
  queue.handleComplete(oldId);
  await tick();
  assert(render().jobs[0]!.status === "running", "completion before a board attaches must be ignored");
  queue.stopAll();
  queue.startAgain({ onReady: () => { currentReady++; } });
  await tick();
  assert(Number(boardRequests.length) === 2, "restart must launch despite an unresolved old board creation");
  queue = render();
  assert(queue.jobs.length === 1 && queue.jobs[0]!.id !== oldId, "restart replaces jobs with fresh identities");
  boardRequests[0]!.resolve(boardResponse("stale-board"));
  await tick();
  queue = render();
  assert(queue.jobs[0]!.status === "running" && !queue.jobs[0]!.boardId, "late stale board cannot patch the new run");
  assert(queue.runtimes.length === 0 && staleReady === 0 && currentReady === 0, "late stale board cannot mount or call onReady");
  assert(deletedBoardIds.filter((id) => id === "stale-board").length === 1, "late stale board is deleted once");
  boardRequests[1]!.resolve(boardResponse("fresh-board"));
  await tick();
  queue = render();
  assert(queue.jobs[0]!.boardId === "fresh-board" && queue.runtimes.length === 1, "fresh job attaches its own board");
  assert(Number(currentReady) === 1 && staleReady === 0, "only fresh onReady runs");
  queue.handlePhase(oldId, "thinking");
  queue.handleComplete(oldId);
  await tick();
  queue = render();
  assert(queue.jobs[0]!.status === "running" && queue.jobs[0]!.phase === "idle", "old shell callbacks cannot affect the new run");
  queue.handleComplete(queue.jobs[0]!.id);
  await tick();
  assert(render().jobs[0]!.status === "complete", "current completion still works");

  // A board create that never returns must time out and free its slot for a queued sibling.
  queue.setConcurrency(1);
  render();
  const requestsBeforeTimeout = boardRequests.length;
  const timersBeforeTimeout = timeoutHandlers.length;
  queue.enqueue([question, question]);
  const timedOut = render().jobs.at(-2)!.id;
  assert(boardRequests.length === requestsBeforeTimeout + 1, "only the first board starts at concurrency one");
  assert(timeoutHandlers.length === timersBeforeTimeout + 1, "board creation starts the job deadline");
  const timeout = timeoutHandlers.at(-1);
  assert(timeout, "timeout must be installed before board creation resolves");
  timeout();
  await tick();
  queue = render();
  assert(queue.jobs.find((job) => job.id === timedOut)?.error === "timed out", "board creation must be covered by job timeout");
  assert(boardRequests.length === requestsBeforeTimeout + 2, "timeout releases the pump slot to the next queued job");
  const runtimeCount = queue.runtimes.length;
  boardRequests[requestsBeforeTimeout]!.resolve(boardResponse("late-timeout-board"));
  await tick();
  queue = render();
  assert(queue.jobs.find((job) => job.id === timedOut)?.boardId === undefined && queue.runtimes.length === runtimeCount,
    "late response after timeout must not attach a board");
  assert(deletedBoardIds.filter((id) => id === "late-timeout-board").length === 1, "late timeout board is deleted once");
  assert(!deletedBoardIds.includes("fresh-board"), "attached recordings must not be deleted");
  boardRequests.at(-1)!.reject(new Error("offline"));
  await tick();
  assert(render().jobs.at(-1)!.error === "could not create board", "failed board request frees the final slot");
  queue.stopAll();
  queue.handlePhase(timedOut, "thinking");
  assert(render().jobs.find((job) => job.id === timedOut)?.phase === "idle", "stopped shell phase callback must be ignored");

  async function lateAfterStop(id: string, beforeResponse?: () => void) {
    const before = boardRequests.length;
    queue.enqueue([question]);
    assert(boardRequests.length === before + 1, `create must start for ${id}`);
    queue.stopAll();
    beforeResponse?.();
    boardRequests[before]!.resolve(boardResponse(id));
    await tick();
    assert(!render().jobs.some((job) => job.boardId === id), `${id} must not attach to a stopped job`);
  }

  await lateAfterStop("stopped-board");
  assert(deletedBoardIds.includes("stopped-board"), "stop without restart also cleans up a late create");
  assert(conditionalDeleteIds.includes("stopped-board"), "orphan cleanup must ask the server for empty-only deletion");

  turnsArrivingAfterInspection.add("turn-after-inspection");
  await lateAfterStop("turn-after-inspection");
  assert(conditionalDeleteIds.includes("turn-after-inspection"), "late cleanup must use conditional DELETE despite an empty GET");
  assert(JSON.parse(boardIndex.get("heytutor:admin:lecture-boards:v1") ?? "{}")["turn-after-inspection"],
    "a turn saved after inspection keeps its board indexed when conditional DELETE refuses it");

  boardDetails.set("saved-turn", { preview: "", turns: [{}] });
  await lateAfterStop("saved-turn");
  boardDetails.set("saved-preview", { preview: "persisted lesson", turns: [] });
  await lateAfterStop("saved-preview");
  assert(!deletedBoardIds.includes("saved-turn") && !deletedBoardIds.includes("saved-preview"),
    "a persisted turn or preview must protect a late board from deletion");
  const indexKey = "heytutor:admin:lecture-boards:v1";
  const remembered = JSON.parse(boardIndex.get(indexKey) ?? "{}") as Record<string, unknown>;
  assert(remembered["saved-turn"] && remembered["saved-preview"], "saved boards remain indexed for discovery");

  await lateAfterStop("held-board", () => queue.setHeldBoardId("held-board"));
  assert(!deletedBoardIds.includes("held-board"), "a held board must not be deleted");
  queue.setHeldBoardId(null);

  deleteResponses.set("delete-failed", Response.json({ error: "unavailable" }, { status: 503 }));
  await lateAfterStop("delete-failed");
  assert(deletedBoardIds.includes("delete-failed"), "cleanup attempts deletion");
  assert(JSON.parse(boardIndex.get(indexKey) ?? "{}")["delete-failed"], "failed deletion preserves board metadata");
  deleteResponses.set("delete-threw", new Error("offline"));
  await lateAfterStop("delete-threw");
  assert(JSON.parse(boardIndex.get(indexKey) ?? "{}")["delete-threw"], "network deletion errors preserve board metadata");

  detailResponses.set("inspection-failed", Response.json({ error: "unavailable" }, { status: 503 }));
  failNextBoardList = true;
  await lateAfterStop("inspection-failed");
  assert(!deletedBoardIds.includes("inspection-failed"), "uncertain board inspection must not delete the board");
  assert(JSON.parse(boardIndex.get(indexKey) ?? "{}")["inspection-failed"], "uncertain inspection preserves board metadata");

  // An inspection can stall while a new run adopts that same ID. Recheck
  // ownership after the GET resolves, before issuing the destructive DELETE.
  const pending = deferred<Response>();
  pendingDetails.set("shared-board", pending);
  const oldRequest = boardRequests.length;
  queue.enqueue([question]);
  queue.stopAll();
  boardRequests[oldRequest]!.resolve(boardResponse("shared-board"));
  await tick();
  queue.enqueue([question]);
  boardRequests[oldRequest + 1]!.resolve(boardResponse("shared-board"));
  await tick();
  assert(render().jobs.at(-1)?.boardId === "shared-board", "new run attaches the shared board");
  pending.resolve(Response.json({ board: { id: "shared-board", preview: "" }, turns: [] }));
  await tick();
  assert(!deletedBoardIds.includes("shared-board"), "stale cleanup must not delete a board adopted by a new run");
  queue.stopAll();
  await tick();
  slots.forEach((slot) => slot.cleanup?.());
  console.log("verify-lecture-queue-races: passed");
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = originalWindow;
  internals.H = originalDispatcher;
}
}
void verify().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
