import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import { captureBoardThumbnail } from "../../features/tutor-session/lib/board/boardThumbnail";
import { CommunityCard } from "../../features/community/CommunityCard";
import type { TutorSessionExportApi } from "../../features/tutor-session/TutorSessionShell";
import type { CodeLessonState } from "../../features/tutor-session/lib/code-lesson/codeLessonController";
import { pageTurnsEndingAt } from "../../lib/boards/boardContinuation";
import type { useBoardThumbnail } from "../../features/tutor-session/hooks/useBoardThumbnail";

Object.defineProperty(globalThis, "React", { value: React, configurable: true });

/** The canvas boundary records ink; the production code-panel painter runs. */
class Canvas {
  width = 1200; height = 700;
  ink: string[] = []; text: string[] = [];
  mime = "image/webp";
  getContext() {
    const painter = {
      drawImage: (source: Canvas) => { this.ink = [...source.ink]; },
      fillText: (text: string) => { this.text.push(text); },
      measureText: (text: string) => ({ width: text.length * 8 }),
    };
    return new Proxy(painter, { get: (target, name) => name in target ? target[name as keyof typeof target] : () => {} });
  }
  toBlob(done: (blob: Blob) => void) { done(new Blob([JSON.stringify(this)], { type: this.mime })); }
}

async function verifyCapture() {
  const source = new Canvas();
  source.ink = ["finished figure", "last equation at bottom of final page"];
  let output = new Canvas();
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => output } });
  const board = { captureFrame: (options: unknown) => {
    assert.deepEqual(options, { pixelRatio: 1, hideCursor: true });
    return source as unknown as HTMLCanvasElement;
  } };
  const blob = await captureBoardThumbnail(board);
  assert(blob);
  assert.deepEqual(output.ink, source.ink, "the final equation and figure survive together");
  assert.equal(output.width / output.height, source.width / source.height, "the page is not cropped");
  assert.equal(blob.type, "image/webp");

  const plan = getMockCodeLessonPlan("Explain binary search");
  const section = plan.sections[0]!;
  section.blocks[0]!.code = "finished_code\nNEVER_REVEALED";
  const state: CodeLessonState = {
    plan, mode: "complete", activeSectionIndex: 0,
    revealedChars: { [section.blocks[0]!.id]: "finished_code".length },
    typingBlockId: null, typeAlong: null, spokenLine: null,
  };
  output = new Canvas();
  await captureBoardThumbnail(board, state);
  assert(output.text.join("").includes("finished_code"), "the DOM code panel is in the thumbnail");
  assert(!output.text.join("").includes("NEVER_REVEALED"), "unrevealed code must not be invented");
  output = new Canvas(); output.mime = "image/png";
  assert.equal(await captureBoardThumbnail(board), null, "unsupported WebP is not mislabeled");
  assert.equal(await captureBoardThumbnail(null), null);
  delete (globalThis as { document?: unknown }).document;
}

/** Mount the actual renderer with deterministic React, network and timers. */
function mountRenderer() {
  const effects: Array<() => (() => void)> = [];
  let timeout: (() => void) | undefined;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout: (fn: () => void) => { timeout = fn; return 1; }, clearTimeout: () => {},
  } });
  const result: Array<Blob | null> = [];
  let adminPreview = false;
  let signal: AbortSignal | undefined;
  const turns = [
    { id: "old", question: "Old page", segments: [], sceneArtifacts: null },
    { id: "last", question: "Final page", segments: [], sceneArtifacts: null },
  ];
  const code = ts.transpileModule(readFileSync(new URL("../../features/community/CommunityThumbnailRenderer.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} as { default: (props: object) => { props: { children: { props: {
    onExportApi: (api: Partial<TutorSessionExportApi> | null) => void;
    readBoard: (id: string) => Promise<{ turns: typeof turns } | null>;
  } } } } } };
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "react") return { useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn, useEffect: (fn: () => (() => void)) => effects.push(fn) };
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }) };
    if (name.endsWith("TutorSessionShell")) return { TutorSessionShell: "Board" };
    if (name.endsWith("boardContinuation")) return { pageTurnsEndingAt };
    if (name.endsWith("communityClient")) return { fetchCommunityBoard: async (_id: string, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return { board: { adminPreview }, turns };
    } };
    throw new Error(`Unexpected import: ${name}`);
  }, mod, mod.exports);
  const tree = mod.exports.default({ boardId: "board", onComplete: (_id: string, blob: Blob | null) => result.push(blob) });
  const cleanups = effects.map((effect) => effect());
  return { props: tree.props.children.props, result, hide: () => { adminPreview = true; },
    timeout: () => timeout?.(), unmount: () => cleanups.forEach((cleanup) => cleanup()), signal: () => signal };
}

async function verifyRenderer() {
  const mounted = mountRenderer();
  const loaded = await mounted.props.readBoard("board");
  assert.deepEqual(loaded?.turns.map((turn) => turn.id), ["last"], "only the ending page is restored");
  mounted.hide();
  assert.equal(await mounted.props.readBoard("board"), null, "admin-only previews cannot become public thumbnails");
  let finish: (blob: Blob) => void = () => {};
  let captures = 0;
  const api = { hasSavedTurns: true, captureThumbnail: () => {
    captures++;
    return new Promise<Blob>((resolve) => { finish = resolve; });
  } };
  mounted.props.onExportApi({ ...api, boardReady: false });
  assert.equal(captures, 0, "cannot photograph while loading");
  mounted.props.onExportApi({ ...api, boardReady: true });
  mounted.props.onExportApi({ ...api, boardReady: true });
  assert.equal(captures, 1);
  assert.equal(mounted.result.length, 0, "wait for the last restored stroke");
  const final = new Blob(["final page"]);
  finish(final);
  await Promise.resolve();
  assert.deepEqual(mounted.result, [final]);
  mounted.timeout();
  assert.equal(mounted.result.length, 1, "timeout cannot complete twice");
  mounted.unmount();
  assert.equal(mounted.signal()?.aborted, true);

  const failed = mountRenderer();
  failed.props.onExportApi({ boardReady: true, hasSavedTurns: true, captureThumbnail: async () => { throw new Error("tainted image"); } });
  await Promise.resolve();
  assert.deepEqual(failed.result, [null], "a failed picture releases the next queued board");
  failed.unmount();
  const stalled = mountRenderer();
  stalled.timeout();
  assert.deepEqual(stalled.result, [null]);
  stalled.unmount();
  delete (globalThis as { window?: unknown }).window;
}

/** Actual effect dependencies, cleanup, timers and a delayed save/capture. */
async function verifySavedRevisionRefresh() {
  let cleanup: (() => void) | undefined;
  let dependencies: unknown[] | undefined;
  let timerId = 0;
  const timers = new Map<number, () => Promise<void>>();
  const storage = new Map<string, string>();
  const uploads: string[] = [];
  const code = ts.transpileModule(readFileSync(new URL("../../features/tutor-session/hooks/useBoardThumbnail.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as { useBoardThumbnail: typeof useBoardThumbnail } };
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "react") return { useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
      if (dependencies && dependencies.every((value, index) => Object.is(value, deps[index]))) return;
      cleanup?.();
      dependencies = deps;
      cleanup = effect();
    } };
    if (name.endsWith("communityClient")) return { uploadBoardThumbnail: async (_id: string, blob: Blob) => {
      uploads.push(await blob.text()); return true;
    } };
    throw new Error(`Unexpected import: ${name}`);
  }, mod, mod.exports);
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout: (callback: () => Promise<void>) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
  } });
  const fire = async () => {
    assert.equal(timers.size, 1, "a late final save must schedule a fresh thumbnail without adding a turn");
    const [id, callback] = [...timers][0]!;
    timers.delete(id);
    await callback();
  };
  let revisionKey = "local";
  let finishCapture: ((blob: Blob) => void) | null = null;
  const input: Parameters<typeof useBoardThumbnail>[0] & { revision: number } = {
    enabled: true, boardId: "saved-board", turnCount: 1, revision: 0,
    getRevision: () => revisionKey,
    publishable: () => true,
    captureThumbnail: async () => finishCapture
      ? new Promise<Blob>((resolve) => { finishCapture = resolve; })
      : new Blob([revisionKey]),
  };
  mod.exports.useBoardThumbnail(input);
  // The server replaces the one local turn during the settling delay.
  revisionKey = "server-final";
  mod.exports.useBoardThumbnail({ ...input, revision: 1 });
  await fire();
  assert.deepEqual(uploads, ["server-final"], "the server's final revision replaces the old picture");
  assert([...storage.values()].includes("server-final"));

  // A save can also finish while asynchronous restoration/capture is pending.
  revisionKey = "resumed-local";
  finishCapture = () => {};
  mod.exports.useBoardThumbnail({ ...input, revision: 2 });
  const oldCapture = fire();
  const release = finishCapture;
  revisionKey = "resumed-server";
  mod.exports.useBoardThumbnail({ ...input, revision: 3 });
  release(new Blob(["stale capture"]));
  await oldCapture;
  assert.deepEqual(uploads, ["server-final"], "an obsolete capture cannot overwrite the newest revision");
  finishCapture = null;
  await fire();
  assert.deepEqual(uploads, ["server-final", "resumed-server"]);
  cleanup?.();
  delete (globalThis as { window?: unknown }).window;
}

async function main() {
  await verifyCapture();
  await verifyRenderer();
  await verifySavedRevisionRefresh();
  const html = renderToStaticMarkup(<CommunityCard board={{ id: "b", title: "Final board", question: "HANDWRITTEN_QUESTION_PLACEHOLDER", subject: "maths", author: { name: "Student", initial: "S" }, createdAt: 1, viewCount: 1, remixCount: 0, featured: false, thumbnailUrl: null }} />);
  assert(!html.includes("HANDWRITTEN_QUESTION_PLACEHOLDER"));
  assert(!html.includes("--font-hand"));
  assert(html.includes("Loading board"));
  console.log("verify-community-thumbnail: completed page, hidden pen, revealed code, public-only restore, capture readiness, failures and no handwritten placeholder passed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
