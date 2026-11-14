import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { fetchBoards } from "../../lib/boards/boardsClient";

// Execute the actual three consumers and client. React scheduling/navigation
// are controlled ports; no network, database, providers or Sentry are used.
const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const noop = () => {};
const ref = <T,>(current: T) => ({ current });
const board = { id: "saved", title: "Saved lesson", preview: "", createdAt: 1, pinnedAt: null, archivedAt: null };
const originalFetch = globalThis.fetch;
const tests: Array<[string, () => Promise<void>]> = [];
const check = (name: string, run: () => Promise<void>) => tests.push([name, run]);

type Element = { props?: Record<string, unknown> };
function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return textOf((node as Element).props?.children);
}
function mount(kind: "session" | "shell" | "library") {
  const states: unknown[] = [], deps: Array<unknown[] | undefined> = [], cleanups: Array<(() => void) | undefined> = [];
  let cursor = 0, pending: Array<() => void> = [], writesAfterUnmount = 0, unmounted = false;
  const captured: unknown[] = [];
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (next: unknown) => {
        if (unmounted) writesAfterUnmount++;
        states[index] = typeof next === "function" ? next(states[index]) : next;
      }];
    },
    useRef(initial: unknown) { const index = cursor++; return states[index] ??= ref(initial); },
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    useLayoutEffect: noop,
    useEffect(effect: () => (() => void) | void, values: unknown[]) {
      const index = cursor++;
      if (deps[index] && values.every((value, i) => Object.is(value, deps[index]![i]))) return;
      deps[index] = values;
      // Isolate startup board reads from replay/TTS/registry platform effects.
      if (kind === "session" && !/fetchBoards|startBoardListRead/.test(effect.toString())) return;
      pending.push(() => { cleanups[index]?.(); cleanups[index] = effect() ?? undefined; });
    },
  };
  const cache = new Map<string, Record<string, unknown>>();
  function load(filename: string): Record<string, unknown> {
    if (cache.has(filename)) return cache.get(filename)!;
    const mod = { exports: {} as Record<string, unknown> }; cache.set(filename, mod.exports);
    const override = process.env.BOARD_LIST_OWNER_SOURCE_DIR;
    const source = override && Object.values({ session: "useBoardSession.ts", shell: "AccountAppShell.tsx", library: "LibraryScreen.tsx" }).includes(path.basename(filename))
      ? path.join(override, path.basename(filename)) : filename;
    const js = ts.transpileModule(readFileSync(source, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", js)((id: string) => {
      if (id === "react") return hooks;
      if (id === "@sentry/nextjs") return { captureException: (error: unknown) => captured.push(error) };
      if (id === "next/navigation") return { useRouter: () => ({ push: noop }), usePathname: () => "/library" };
      if (id.endsWith("useAccountMe")) return { useAccountMe: () => null, toShellProfile: () => null };
      const resolved = id.startsWith("@/") ? path.join(app, id.slice(2)) : id.startsWith(".") ? path.resolve(path.dirname(filename), id) : id;
      if (resolved.endsWith("/boardListRead")) return load(`${resolved}.ts`);
      return requireApp(resolved);
    }, mod, mod.exports);
    return mod.exports;
  }
  const files = { session: "features/tutor-session/hooks/useBoardSession.ts", shell: "features/app-shell/AccountAppShell.tsx", library: "features/account/LibraryScreen.tsx" };
  const ownerModule = load(path.join(app, files[kind]));
  const params = {
    sessionId: "draft-a", isDraft: true, router: { push: noop }, phase: "idle", speedMultiplier: 1,
    whiteboardRef: ref(null), cancelRef: ref(false), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""), liveQuestionRef: ref(""),
    captureNotesEpoch: () => false, ttsClientRef: ref(null), voicePreferencesRef: ref({}), speedRef: ref(1), stopTurnRef: ref(null),
    replayAudioRef: ref(null), replayAudioPreloadRef: ref(new Map()), setNarrationText: noop, setCurrentSegmentText: noop,
    resetBoardLayout: noop, executeCommand: async () => {},
  };
  return {
    render() {
      cursor = 0;
      const fn = ownerModule[kind === "session" ? "useBoardSession" : kind === "shell" ? "AccountAppShell" : "LibraryScreen"] as (props: unknown) => Record<string, unknown>;
      const result = fn(params);
      const effects = pending; pending = []; effects.forEach((effect) => effect());
      return result;
    },
    unmount() { unmounted = true; cleanups.forEach((cleanup) => cleanup?.()); },
    replayEffects() { cleanups.forEach((cleanup) => cleanup?.()); cleanups.length = 0; deps.length = 0; },
    params,
    captured,
    writesAfterUnmount: () => writesAfterUnmount,
  };
}

for (const status of [401, 503]) check(`HTTP ${status} never returns partial success`, async () => {
  let page = 0;
  globalThis.fetch = async () => ++page === 1 ? Response.json({ boards: [board], nextPage: 1 }) : new Response("refused", { status });
  await assert.rejects(fetchBoards(), "an incomplete library must be a failed read");
});
check("missing list is not empty success", async () => {
  globalThis.fetch = async () => Response.json({});
  await assert.rejects(fetchBoards());
});
check("bounded pagination cannot silently truncate", async () => {
  let page = 0;
  globalThis.fetch = async () => Response.json({ boards: [board], nextPage: ++page });
  await assert.rejects(fetchBoards());
  assert.equal(page, 20);
});
for (const kind of ["session", "shell", "library"] as const) {
  for (const failure of ["network", "body", "http"] as const) check(`${kind} owns ${failure} failure and retry`, async () => {
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      if (failure === "network") throw new TypeError("synthetic offline");
      return new Response(failure === "body" ? "{" : "refused", { status: failure === "http" ? 503 : 200 });
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    const owner = mount(kind);
    try {
      owner.render(); await tick();
      const result = owner.render();
      assert.deepEqual(unhandled, [], "the effect must own rejected startup work");
      assert.equal(owner.captured.length, 1, "preserve one genuine failure receipt");
      const retry = (kind === "session" ? result.retryBoards : kind === "shell" ? (result.props as Record<string, unknown>).onRetryBoards : findRetry(result)) as (() => void) | undefined;
      const error = kind === "session" ? result.boardsError : kind === "shell" ? (result.props as Record<string, unknown>).boardsError : textOf(result);
      assert.match(String(error), /Could not load.*boards/i, "failure must remain observable, not look like an empty library");
      assert.equal(requests, 1, "no unbounded automatic retries");
      assert.equal(typeof retry, "function", "the owning consumer exposes recovery");
      globalThis.fetch = async () => Response.json({ boards: [board] });
      retry!(); owner.render(); await tick();
      const recovered = owner.render();
      const boards = kind === "session" ? recovered.boards : kind === "shell" ? (recovered.props as Record<string, unknown>).boards : textOf(recovered);
      if (kind === "library") assert.match(String(boards), /Saved lesson/);
      else assert.equal((boards as typeof board[])[0]?.id, board.id);
    } finally { owner.unmount(); await tick(); process.off("unhandledRejection", onUnhandled); }
  });
  check(`${kind} ignores a late body after cleanup`, async () => {
    let finish: (body: unknown) => void = noop;
    globalThis.fetch = async () => ({ ok: true, json: () => new Promise((resolve) => { finish = resolve; }) }) as Response;
    const owner = mount(kind); owner.render(); await tick(); owner.unmount();
    finish({ boards: [board] }); await tick();
    assert.equal(owner.writesAfterUnmount(), 0);
    assert.equal(owner.captured.length, 0, "cleanup does not report an active read failure");
  });
  check(`${kind} survives strict effect replay`, async () => {
    let calls = 0;
    globalThis.fetch = async (_input, init) => {
      calls++;
      if (calls > 1) return Response.json({ boards: [board] });
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError"))));
    };
    const owner = mount(kind);
    try {
      owner.render(); owner.replayEffects(); owner.render(); await tick();
      const result = owner.render();
      assert.equal(calls, 2);
      const boards = kind === "session" ? result.boards : kind === "shell" ? (result.props as Record<string, unknown>).boards : textOf(result);
      if (kind === "library") assert.match(String(boards), /Saved lesson/);
      else assert.equal((boards as typeof board[])[0]?.id, board.id);
    } finally { owner.unmount(); }
  });
}
check("tutor account list survives board changes and preserves live rows", async () => {
  let finish: (body: unknown) => void = noop;
  globalThis.fetch = async () => ({ ok: true, json: () => new Promise((resolve) => { finish = resolve; }) }) as Response;
  const owner = mount("session");
  try {
    const initial = owner.render(); await tick();
    owner.params.sessionId = "draft-b";
    (initial.setBoards as (rows: unknown[]) => void)([{ ...board, id: "live", title: "Newly created" }]);
    owner.render(); finish({ boards: [board, { ...board, id: "live", title: "Old title" }] }); await tick();
    const rows = owner.render().boards as typeof board[];
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.id === "live")?.title, "Newly created");
  } finally { owner.unmount(); }
});
function findRetry(node: unknown): unknown {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) return node.map(findRetry).find(Boolean);
  const props = (node as Element).props;
  if (/Retry/i.test(textOf(props?.children)) && typeof props?.onClick === "function") return props.onClick;
  return findRetry(props?.children);
}
async function main() {
  const failures: string[] = [];
  try {
    for (const [name, run] of tests) {
      try { await run(); console.log(`pass ${name}`); }
      catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
    }
  } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual(failures, []);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
