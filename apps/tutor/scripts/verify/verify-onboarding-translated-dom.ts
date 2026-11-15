/**
 * Google Translate replaces text nodes with nested <font> elements. React
 * still remembers the original Text node, so inserting a choice checkmark
 * before that detached node used to throw NotFoundError (HEYTUTOR-21).
 *
 * node --experimental-test-module-mocks --import tsx scripts/verify/verify-onboarding-translated-dom.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import * as React from "react";
import { act } from "react";
import { JSDOM } from "jsdom";

const load = createRequire(import.meta.url);
const rootPath = resolve(import.meta.dirname, "../..");
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "https://synthetic.invalid/onboarding" });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  React: { value: React, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true },
});
mock.module("next/navigation", { namedExports: { useRouter: () => ({ replace() {}, refresh() {} }) } });
mock.module(resolve(rootPath, "../../packages/tutor-core/src/index.ts"), {
  namedExports: { DEFAULT_ACCENT: "india", DEFAULT_AUDIO_LANGUAGE: "en", DEFAULT_FAMILIARITY: "normal" },
});
const { createRoot } = load("react-dom/client") as typeof import("react-dom/client");
const { OnboardingScreen } = load(resolve(rootPath, "features/account/OnboardingScreen.tsx")) as typeof import("../../features/account/OnboardingScreen");
const errors: unknown[] = [];
const root = createRoot(dom.window.document.getElementById("root")!, { onUncaughtError: (error) => errors.push(error) });

function button(label: string): HTMLButtonElement {
  const found = [...dom.window.document.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  assert(found, `missing button ${label}`);
  return found;
}
async function click(target: HTMLButtonElement): Promise<void> {
  await act(async () => target.click());
  assert.equal(errors.length, 0, String(errors[0]));
}
async function submit(): Promise<void> {
  const form = dom.window.document.querySelector("form");
  assert(form);
  await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(errors.length, 0, String(errors[0]));
}
function translateText(container: Element): void {
  const walker = dom.window.document.createTreeWalker(container, dom.window.NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) textNodes.push(walker.currentNode as Text);
  for (const text of textNodes) {
    const outer = dom.window.document.createElement("font");
    const inner = dom.window.document.createElement("font");
    inner.textContent = `译 ${text.textContent}`;
    outer.append(inner);
    text.replaceWith(outer);
  }
}

async function main(): Promise<void> {
  await act(async () => root.render(React.createElement(OnboardingScreen, { initialName: "Synthetic learner", nextPath: "/", suggestedRole: "college" })));
  await submit();
  await click(button("18 or older"));
  await click(dom.window.document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!);
  await click(button("First year"));
  await submit();

  const physics = button("Physics");
  translateText(physics);
  await click(physics);
  assert.equal(physics.getAttribute("aria-pressed"), "true", "a translated subject remains selectable");
  assert(physics.querySelector("svg"), "selection reveals the checkmark");
  assert.match(physics.textContent ?? "", /译 Physics/, "selection preserves translated text");
  await click(physics);
  assert.equal(physics.getAttribute("aria-pressed"), "false", "a translated subject can be deselected");
  assert.equal(physics.querySelector("svg"), null);
  assert.match(physics.textContent ?? "", /译 Physics/);

  const india = button("India");
  const uk = button("UK");
  translateText(india);
  translateText(uk);
  await click(uk);
  assert.equal(uk.getAttribute("aria-pressed"), "true", "a translated voice can be selected");
  assert.equal(india.getAttribute("aria-pressed"), "false", "the previous translated voice can be deselected");
  assert.match(uk.textContent ?? "", /译 UK/);

  const normal = button("Normal");
  const fresh = button("New");
  translateText(normal);
  translateText(fresh);
  await click(fresh);
  assert.equal(fresh.getAttribute("aria-pressed"), "true", "a translated familiarity can be selected");
  assert.equal(normal.getAttribute("aria-pressed"), "false", "the previous translated familiarity can be deselected");
  await act(async () => root.unmount());
  dom.window.close();
  console.log("onboarding translated DOM: subject, voice and familiarity choices preserve translated text");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
