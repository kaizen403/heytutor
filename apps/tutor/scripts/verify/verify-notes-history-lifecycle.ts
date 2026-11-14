import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import * as React from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import type { NotesChatMessage } from "../../lib/boards/notesChatClient";

const app = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
const dom = new JSDOM('<div id="root"></div>', { url: "https://synthetic.invalid/" });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true }, document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true }, React: { value: React, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true },
});
// The history owner, fetch helper, React effects and retry UI remain real.
// Voice input and message rendering are outside this regression.
mock.module(resolve(app, "features/tutor-session/components/NotesChatThread.tsx"), {
  namedExports: { NotesChatThread: ({ messages }: { messages: NotesChatMessage[] }) => React.createElement("div", null, messages.map(message => message.content).join(" | ")) },
});
mock.module(resolve(app, "features/tutor-session/components/NotesChatComposer.tsx"), {
  namedExports: { NotesChatComposer: () => null },
});
const { createRoot } = load("react-dom/client") as typeof import("react-dom/client");
const { useNotesChat } = load(resolve(app, "features/tutor-session/hooks/useNotesChat.ts")) as typeof import("../../features/tutor-session/hooks/useNotesChat");
const { NotesChatSidebar } = load(resolve(app, "features/tutor-session/components/NotesChatSidebar.tsx")) as typeof import("../../features/tutor-session/components/NotesChatSidebar");
let current: ReturnType<typeof useNotesChat> | undefined;
function Probe({ boardId, enabled = true }: { boardId: string; enabled?: boolean }) {
  const api = useNotesChat(boardId, enabled);
  React.useEffect(() => { current = api; }, [api]);
  return React.createElement(NotesChatSidebar, {
    notes: { turns: [], lectureInProgress: false }, messages: api.messages, sending: api.sending,
    error: api.error, historyError: api.historyError, onRetryHistory: api.reloadHistory,
    onSend: () => {},
  });
}
const failures: unknown[] = [];
const unhandled = (error: unknown) => failures.push(error);
process.on("unhandledRejection", unhandled);
const root = createRoot(dom.window.document.getElementById("root")!, { onUncaughtError: unhandled });
let mounted = true;
const requests: { path: string; signal: AbortSignal | null | undefined; resolve: (response: Response) => void; reject: (error: unknown) => void }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const path = new URL(String(url), "https://synthetic.invalid").pathname;
  if (init?.method === "POST") return new Response('data: {"delta":"A fresh answer."}\n\ndata: {"done":true}\n\n');
  return new Promise<Response>((resolve, reject) => requests.push({ path, signal: init?.signal, resolve, reject }));
};
const drain = async () => { await new Promise<void>(resolve => setImmediate(resolve)); await new Promise<void>(resolve => setImmediate(resolve)); };
const render = async (boardId: string, enabled = true) => act(async () => { root.render(React.createElement(Probe, { boardId, enabled })); await drain(); });
const message = (content: string): NotesChatMessage => ({ id: "saved-" + content, role: "assistant", content, createdAt: 1, tag: null });
async function reply(index: number, response: Response) { await act(async () => { requests[index]!.resolve(response); await drain(); }); }
async function reject(index: number) { await act(async () => { requests[index]!.reject(new TypeError("synthetic connection failure")); await drain(); }); }

async function main() {
  try {
    await render("board-a");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.path, "/api/boards/board-a/notes-chat");
    await reject(0);
    assert.equal(failures.length, 0, "a mounted history rejection must have an owner");
    assert.match(dom.window.document.querySelector('[role="status"]')?.textContent ?? "", /saved messages.*load/i);
    const retry = dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="Retry loading saved messages"]');
    assert(retry && !retry.disabled, "history failure exposes an actionable retry");
    await act(async () => { retry.click(); await drain(); });
    assert.equal(requests.length, 2, "only an explicit retry starts another history request");
    await reply(1, Response.json({ messages: [message("Saved history")] }));
    assert.equal(current!.historyError, null);
    assert.equal(current!.messages[0]?.content, "Saved history");

    await render("board-b");
    await render("board-c");
    assert.equal(requests[2]!.signal?.aborted, true, "changing boards cancels the old history request");
    await reject(2); // Transport deliberately ignores abort: ownership still handles a late rejection.
    assert.equal(current!.historyError, null);
    await reply(3, Response.json({ messages: [message("Current board")] }));
    assert.equal(current!.messages[0]?.content, "Current board");

    for (const [name, response] of [
      ["http", new Response("unavailable", { status: 503 })],
      ["json", new Response("not json", { headers: { "content-type": "application/json" } })],
      ["shape", Response.json({ messages: null })],
      ["message", Response.json({ messages: [{ role: "assistant", content: 42 }] })],
    ] as const) {
      await render("board-" + name);
      await reply(requests.length - 1, response);
      assert.match(current!.historyError ?? "", /saved messages.*load/i, name + " failure must remain visible");
      assert.equal(failures.length, 0);
    }
    await render("draft-board");
    await reply(requests.length - 1, Response.json({ messages: [] }));
    assert.equal(current!.historyError, null, "the API's empty draft history stays a success");
    assert.equal(current!.messages.length, 0);

    await render("active-chat");
    const pendingHistory = requests.length - 1;
    await act(async () => { await current!.send("A new question", null, false); await drain(); });
    await reply(pendingHistory, Response.json({ messages: [message("Older response")] }));
    assert(current!.messages.some(message => message.content === "A new question"), "late history cannot erase a newly sent message");
    assert(current!.messages.some(message => message.content === "A fresh answer."));

    const beforeDisabled = requests.length;
    await render("disabled", false);
    assert.equal(requests.length, beforeDisabled, "disabled notes make no request");
    await render("unmount");
    const pendingUnmount = requests.length - 1;
    await act(async () => { root.unmount(); mounted = false; });
    assert.equal(requests[pendingUnmount]!.signal?.aborted, true);
    await reject(pendingUnmount);
    assert.equal(failures.length, 0, "cleanup and late network rejection cannot leak an unhandled promise");
    console.log("notes history lifecycle: actual effects, fetch helper, retry UI, cleanup, stale results, failures and empty drafts pass");
  } finally {
    if (mounted) await act(async () => root.unmount());
    globalThis.fetch = realFetch;
    process.off("unhandledRejection", unhandled);
    mock.restoreAll(); dom.window.close();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
