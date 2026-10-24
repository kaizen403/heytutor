/**
 * Mounts the real `useBoardLayout` hook against a recording whiteboard and a
 * virtual clock, for gates that drive page turns. The whiteboard keeps the
 * work ink it was asked to write and wipes it the way `eraseWorkInk` does:
 * every work stroke is dropped at once unless the wipe is cancelled before
 * it starts. `BOARD_LAYOUT_HOOK_SOURCE` swaps in another copy of the hook (an
 * older revision) to prove a gate fails on it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
export const boardLayoutHookPath = path.join(app, "features/tutor-session/hooks/useBoardLayout.ts");

export type BoardCall = { kind: "erase" | "write" | "box" | "snapshot" | "clear"; at: number; text?: string; x?: number; y?: number; fontSize?: number; path?: string };
export type InkRow = { text: string; x: number; y: number };
type Hooks = typeof import("../../features/tutor-session/hooks/useBoardLayout");

export function mountBoardLayout(options: { diagramActive?: boolean } = {}) {
  let now = 10_000, sequence = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const original = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  replace("performance", { now: () => now });
  replace("setTimeout", (run: () => void, delay = 0) => { const id = ++sequence; timers.set(id, { at: now + delay, run }); return id; });
  replace("clearTimeout", (id: number) => { timers.delete(id); });
  const step = (): boolean => {
    const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (!next) return false;
    timers.delete(next[0]); now = Math.max(now, next[1].at); next[1].run();
    return true;
  };
  const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  /** Run the virtual clock until `work` settles. */
  const settle = async <T,>(work: Promise<T>): Promise<T> => {
    let done = false; let value: T | undefined; let failure: unknown; let failed = false;
    work.then((result) => { done = true; value = result; }, (error) => { done = true; failed = true; failure = error; });
    for (let guard = 0; guard < 10_000 && !done; guard++) {
      await drain();
      if (done) break;
      step();
    }
    assert(done, "board work settles on the virtual clock");
    if (failed) throw failure;
    return value as T;
  };
  /** Run the virtual clock forward by `ms`, firing every timer due. */
  const advance = async (ms: number) => {
    const until = now + ms;
    for (let guard = 0; guard < 10_000; guard++) {
      await drain();
      const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next || next[1].at > until) break;
      step();
    }
    now = Math.max(now, until);
    await drain();
  };

  const calls: BoardCall[] = [];
  /** The work ink actually on the board. */
  const ink: InkRow[] = [];
  const wb = {
    captureSnapshot: () => { calls.push({ kind: "snapshot", at: now }); return "data:image/png;base64,"; },
    eraseWorkInk: async (_duration: number, shouldCancel?: () => boolean) => {
      if (shouldCancel?.()) return;
      calls.push({ kind: "erase", at: now });
      ink.length = 0;
    },
    clearBoard: async () => { calls.push({ kind: "clear", at: now }); ink.length = 0; },
    getInkSettings: () => ({}),
    writeText: async (text: string, x: number, y: number, _duration: number, _schedule: unknown, fontSize: number, shouldCancel?: () => boolean) => {
      if (shouldCancel?.()) return;
      calls.push({ kind: "write", at: now, text, x, y, fontSize });
      ink.push({ text, x, y });
    },
    drawAnnotation: async (kind: string, pathData: string, _duration: number, opts?: { shouldCancel?: () => boolean }) => {
      if (opts?.shouldCancel?.()) return;
      if (kind === "box") calls.push({ kind: "box", at: now, path: pathData });
    },
  };
  const ref = <T,>(current: T) => ({ current });
  const source = process.env.BOARD_LAYOUT_HOOK_SOURCE ?? boardLayoutHookPath;
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return { useRef: ref, useCallback: <T,>(fn: T) => fn };
    if (specifier === "./useBoardViewport") return { useBoardViewport: () => ({}) };
    if (specifier === "@heytutor/tutor-core") return { tutorDebug: () => {} };
    return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
      : specifier.startsWith(".") ? path.resolve(path.dirname(boardLayoutHookPath), specifier) : specifier);
  }, mod, mod.exports);
  const hooks = mod.exports as unknown as Hooks;
  const cancelRef = ref(false);
  const board = hooks.useBoardLayout({
    whiteboardRef: ref(wb) as never, cancelRef, fbdPhaseStartedRef: ref(options.diagramActive === true), liveQuestionRef: ref("Relative velocity"),
  });
  return {
    hooks, board, calls, ink, cancelRef, settle, advance, now: () => now,
    close: () => { for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    } },
  };
}

export type MountedBoardLayout = ReturnType<typeof mountBoardLayout>;
