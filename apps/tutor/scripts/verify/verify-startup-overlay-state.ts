import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const file = path.resolve(import.meta.dirname, "../../features/tutor-session/components/ThinkingOverlay.tsx");
const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const loaded = { exports: {} as Record<string, unknown> };
new Function("require", "module", "exports", compiled)((specifier: string) => {
  if (specifier === "@heytutor/whiteboard/pen-spinner") return {
    PenSpinner: () => createElement("span", { "data-pending-spinner": true }),
  };
  if (specifier === "../hooks/usePendingBeat") return { usePendingBeat: () => ({ index: 0, label: "preparing the lecture" }) };
  if (specifier === "./PendingSketch") return { PendingSketch: () => createElement("span", { "data-pending-sketch": true }) };
  return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier);
}, loaded, loaded.exports);
const ThinkingOverlay = loaded.exports.ThinkingOverlay as typeof import("../../features/tutor-session/components/ThinkingOverlay").ThinkingOverlay;
const render = (props: Parameters<typeof ThinkingOverlay>[0]) => renderToStaticMarkup(createElement(ThinkingOverlay, props));
const buttons = (node: unknown): ReactElement<{ onClick: () => void }>[] => {
  if (!node || typeof node !== "object" || !("type" in node) || !("props" in node)) return [];
  const element = node as ReactElement<{ children?: unknown; onClick: () => void }>;
  if (element.type === "button") return [element];
  return [element.props.children].flat().flatMap(buttons);
};

let resumes = 0;
let enables = 0;
const paused = { paused: true, onResume: () => { resumes++; }, onEnableAudio: () => { enables++; } };
const pausedHtml = render(paused);
assert.match(pausedHtml, /role="status"[^>]*>Lecture paused/);
assert.match(pausedHtml, /<button[^>]*type="button"[^>]*>Resume<\/button>/);
assert(!pausedHtml.includes("data-pending-spinner"));
assert(!pausedHtml.includes("data-pending-sketch"));
assert(!pausedHtml.includes("wb-progress-bar"));
assert(!pausedHtml.includes("Tap to enable audio"), "intentional pause takes precedence over any previously blocked playback");
buttons(ThinkingOverlay(paused))[0]!.props.onClick();
assert.equal(resumes, 1);
assert.equal(enables, 0);

const doubtHtml = render({ ...paused, onBoardAt: { x: 640, y: 300 }, scale: 0.5 });
assert(!doubtHtml.includes("wb-pending "), "a paused doubt must leave the current board page visible without the lesson frost");
assert.match(doubtHtml, />Resume<\/button>/);
const blockedHtml = render({ onEnableAudio: () => { enables++; } });
assert.match(blockedHtml, /Audio needs your permission/);
assert.match(blockedHtml, />Tap to enable audio<\/button>/);
assert(!blockedHtml.includes("data-pending-spinner"));
buttons(ThinkingOverlay({ onEnableAudio: () => { enables++; } }))[0]!.props.onClick();
assert.equal(enables, 1);

const normalHtml = render({});
assert.match(normalHtml, /aria-label="Preparing the lecture"/);
assert(normalHtml.includes("data-pending-spinner"));
assert(!normalHtml.includes("<button"), "normal startup must not grow a Play gate");
const normalDoubt = render({ onBoardAt: { x: 640, y: 300 }, scale: 0.5 });
assert.match(normalDoubt, /aria-label="Thinking about your doubt"/);
assert(!normalDoubt.includes("wb-pending "));
console.log("verified paused startup has an accessible Resume action, no pending animations, and preserves the doubt page");
