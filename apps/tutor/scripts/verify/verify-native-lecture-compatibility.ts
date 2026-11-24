/** Actual composer handlers with local OCR/React adapters; no browser or network. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import ts from "typescript";
import { createFallbackTurnPlanV3, withComputedQuantityRoster } from "@heytutor/tutor-core";

const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const origins = requireApp(path.join(appRoot, "features/tutor-session/lib/input/questionSource.ts")) as
  typeof import("../../features/tutor-session/lib/input/questionSource");
const inputFile = path.join(appRoot, "features/tutor-session/components/InputBar.tsx");
const compiled = ts.transpileModule(readFileSync(inputFile, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
type Node = { type: unknown; props: Record<string, unknown> };
function composer(accept = true) {
  const slots: unknown[] = [], effects: Array<() => unknown> = [], submitted: Array<{ text: string; photo: boolean }> = [];
  let cursor = 0, dirty = false;
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; dirty = true; }];
    },
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback: <T,>(value: T) => value,
    useEffect(effect: () => unknown, deps: unknown[]) {
      const index = cursor++, previous = slots[index] as unknown[] | undefined;
      if (!previous || !deps || deps.some((value, index) => value !== previous[index])) effects.push(effect);
      slots[index] = deps;
    },
    useLayoutEffect() {},
    useSyncExternalStore: (_subscribe: unknown, _snapshot: unknown, serverSnapshot: () => unknown) => serverSnapshot(),
  };
  const jsx = (type: unknown, props: Record<string, unknown>): Node => ({ type, props });
  const mod = { exports: {} as { InputBar: (props: Record<string, unknown>) => Node } };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return react;
    if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (specifier.endsWith("/questionSource")) return origins;
    if (specifier.endsWith("/compressQuestionImage")) return { compressQuestionImage: async () => "local-ocr-fixture" };
    if (specifier.endsWith("/useVoiceInput")) return { useVoiceInput: () => ({ isRecording: false, isTranscribing: false, volume: 0, error: null, toggle() {} }) };
    return requireApp(specifier.startsWith("@/") ? path.join(appRoot, specifier.slice(2)) : specifier);
  }, mod, mod.exports);
  let tree: Node;
  function walk(value: unknown, type: string): Node | undefined {
    if (!value || typeof value !== "object" || !("type" in value) || !("props" in value)) return;
    const node = value as Node;
    if (node.type === type) return node;
    for (const child of [node.props.children].flat(Infinity)) { const found = walk(child, type); if (found) return found; }
  }
  function invoke(node: Node, name: string, event: unknown): void {
    const handler = node.props[name];
    assert.equal(typeof handler, "function", `${node.type} exposes ${name}`);
    (handler as (event: unknown) => unknown)(event);
  }
  function render(prefill?: { text: string; nonce: number }) {
    for (let pass = 0; pass < 4; pass++) {
      cursor = 0; dirty = false;
      tree = mod.exports.InputBar({ onSubmit: (text: string) => { submitted.push({ text, photo: origins.isPhotoQuestion(text) }); return Promise.resolve(accept); }, prefill });
      if (!dirty) break;
    }
    const field = walk(tree!, "textarea")!;
    const ref = field.props.ref;
    if (ref && typeof ref === "object" && "current" in ref) ref.current = { value: field.props.value, style: {}, focus() {}, setSelectionRange() {} };
    while (effects.length) effects.shift()!();
    return tree!;
  }
  const field = () => walk(tree!, "textarea")!;
  return { render, submitted, field,
    edit(text: string) { invoke(field(), "onChange", { target: { value: text } }); render(); },
    async photo() { invoke(walk(tree!, "input")!, "onChange", { target: { files: [new File(["fixture"], "question.png", { type: "image/png" })], value: "" } }); await setImmediate(); render(); },
    async submit() { invoke(walk(tree!, "form")!, "onSubmit", { preventDefault() {} }); await setImmediate(); render(); },
  };
}

async function main() {
  const originalFetch = globalThis.fetch, originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  globalThis.fetch = async input => {
    assert(String(input).endsWith("/api/extract-question"), "only the local OCR adapter may be called");
    return Response.json({ question: "OCR fixture asks x + y = 7", latencyMs: 1 });
  };
  try {
    const typed = composer(); typed.render(); typed.edit("Typed fixture asks x - y = 3"); await typed.submit();
    assert.deepEqual(typed.submitted, [{ text: "Typed fixture asks x - y = 3", photo: false }]);
    assert.equal(typed.field().props.value, "", "accepted ordinary submission retains existing clear behavior");
    const photo = composer(); photo.render(); await photo.photo();
    assert.equal(photo.field().props.value, "OCR fixture asks x + y = 7");
    photo.edit("Edited OCR fixture asks x + y = 8"); await photo.submit();
    assert.deepEqual(photo.submitted, [{ text: "Edited OCR fixture asks x + y = 8", photo: true }], "editing OCR cannot enter the text-only native route");
    const rejected = composer(false); rejected.render(); await rejected.photo(); rejected.edit("Retained OCR draft"); await rejected.submit();
    assert.equal(rejected.field().props.value, "Retained OCR draft", "failed admission preserves the original draft behavior");
    assert.equal(rejected.submitted[0]?.photo, true);
    rejected.edit(""); rejected.edit("New typed draft after clearing photo"); await rejected.submit();
    assert.equal(rejected.submitted.at(-1)?.photo, false, "clearing a photo draft restores ordinary text eligibility");
    const remount = composer(); remount.render({ text: "Edited OCR fixture asks x + y = 8", nonce: 1 }); await remount.submit();
    assert.equal(remount.submitted[0]?.photo, true, "queued/remounted known OCR remains excluded");
    const prefill = composer(); prefill.render(); await prefill.photo(); prefill.render({ text: "Unrelated typed prefill", nonce: 2 }); await prefill.submit();
    assert.equal(prefill.submitted[0]?.photo, false, "a new text prefill cannot inherit an earlier photo draft");
    for (let index = 0; index < 130; index++) origins.markPhotoQuestion(`bounded OCR origin ${index}`);
    assert.equal(origins.isPhotoQuestion("bounded OCR origin 0"), false);
    assert.equal(origins.isPhotoQuestion("bounded OCR origin 129"), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
  }

  const plan = createFallbackTurnPlanV3("Native numeric identity fixture");
  plan.unknowns = [];
  plan.derived = [{ id: "energy", symbol: "K", value: 0.125, unit: "MeV", provenance: "derived" }];
  const before = structuredClone(plan), roster = withComputedQuantityRoster(plan);
  assert.deepEqual(roster.unknowns, [{ id: "energy", symbol: "K", unit: "MeV" }]);
  assert.deepEqual({ ...roster, unknowns: [] }, before, "restoring target identities changes no scientific value or evidence");
  assert.deepEqual(plan, before, "the accepted plan is never mutated");
  assert.equal(withComputedQuantityRoster(roster), roster, "repeat save/replay does not append identities");
  const explicit = { ...plan, unknowns: [{ id: "radius", symbol: "r", unit: "fm" }] };
  assert.equal(withComputedQuantityRoster(explicit), explicit, "declared target roles retain priority");
  for (const invalid of [
    { ...plan, derived: [...plan.derived, ...plan.derived] },
    { ...plan, derived: [{ ...plan.derived[0]!, value: NaN }] },
    { ...plan, givens: [{ ...plan.derived[0]!, provenance: "given" as const }] },
  ]) assert.equal(withComputedQuantityRoster(invalid), invalid, "malformed/overlapping data cannot invent target identities");
  console.log("native lecture compatibility: actual OCR/edit/submit/remount/clear/prefill lifecycle and immutable numeric target roster pass; no network");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
