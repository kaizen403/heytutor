import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import * as React from "react";
import { act } from "react";
import { JSDOM } from "jsdom";

const load = createRequire(import.meta.url);
const app = resolve(import.meta.dirname, "../..");
const dom = new JSDOM('<div id="root"></div>', { url: "https://synthetic.invalid/login" });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true }, document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true }, React: { value: React, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true },
});
let signInCalls = 0;
let rejectSignIn = true;
let destination: string | undefined;
mock.module("next-auth/react", { namedExports: { signIn: async () => {
  signInCalls++;
  if (rejectSignIn) throw new TypeError("synthetic connection failure");
  return { ok: true };
} } });
mock.module("next/navigation", { namedExports: { useRouter: () => ({ replace(path: string) { destination = path; }, refresh() {} }) } });
mock.module(resolve(app, "../../packages/tutor-core/src/index.ts"), {
  namedExports: { DEFAULT_ACCENT: "india", DEFAULT_AUDIO_LANGUAGE: "en", DEFAULT_FAMILIARITY: "normal" },
});
const { createRoot } = load("react-dom/client") as typeof import("react-dom/client");
const { LoginScreen } = load(resolve(app, "features/account/LoginScreen.tsx")) as typeof import("../../features/account/LoginScreen");
const { OnboardingScreen } = load(resolve(app, "features/account/OnboardingScreen.tsx")) as typeof import("../../features/account/OnboardingScreen");
const errors: unknown[] = [];
const unhandled = (error: unknown) => { errors.push(error); };
process.on("unhandledRejection", unhandled);
const root = createRoot(dom.window.document.getElementById("root")!, { onUncaughtError: unhandled });
const realFetch = globalThis.fetch;
async function drain(): Promise<void> { await new Promise<void>(resolve => setImmediate(resolve)); }
async function submit(): Promise<void> {
  const form = dom.window.document.querySelector("form");
  assert(form);
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await drain(); });
}

async function main(): Promise<void> {
  try {
    await act(async () => root.render(React.createElement(LoginScreen, { nextPath: "/", googleEnabled: false, emailEnabled: true, devLoginEnabled: false })));
    const input = dom.window.document.querySelector<HTMLInputElement>("input[type=email]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "learner@synthetic.invalid");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await submit();
    assert.equal(signInCalls, 1, "the real form dispatched sign-in");
    assert.equal(errors.length, 0, "a rejected email request must be handled");
    assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /could not send.*try again/i);
    assert.equal(dom.window.document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled, false, "failure permits a retry");
    rejectSignIn = false;
    await submit();
    assert.equal(signInCalls, 2);
    assert.match(dom.window.document.querySelector('[role="status"]')?.textContent ?? "", /check your inbox/i);

    await act(async () => root.render(React.createElement(OnboardingScreen, { initialName: "Synthetic learner", nextPath: "/", suggestedRole: "college" })));
    await submit();
    const under13 = [...dom.window.document.querySelectorAll("button")].find(button => /under 13/i.test(button.textContent ?? ""));
    assert(under13);
    await act(async () => under13.click());
    let refusalCalls = 0;
    globalThis.fetch = async (_url, init) => {
      refusalCalls++;
      assert.deepEqual(JSON.parse(String(init?.body)), { ageBand: "under_13" });
      throw new TypeError("synthetic connection failure");
    };
    await submit();
    await drain();
    assert.equal(refusalCalls, 1);
    assert.equal(errors.length, 0, "refusal redirect must not leave an unhandled rejection");
    assert.equal(destination, "/login?refused=1", "the under-age learner never advances into tutoring");
    console.log("account network failures: email retry and under-age refusal complete without unhandled rejections");
  } finally {
    globalThis.fetch = realFetch;
    await act(async () => root.unmount());
    dom.window.close();
    process.off("unhandledRejection", unhandled);
    mock.restoreAll();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
