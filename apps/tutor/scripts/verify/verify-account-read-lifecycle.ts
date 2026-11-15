import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const noop = () => {};
const profile = { id: "synthetic-account", name: "Student", subjects: [], ageBand: "under_18" };
const snapshot = { boardCount: 0, lessonCount: 0, narrationMinutes: 0, exportCount: 0, lastBoard: null };
type Element = { props?: Record<string, unknown> };
function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return textOf((node as Element).props?.children);
}
function retryOf(node: unknown): unknown {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) return node.map(retryOf).find(Boolean);
  const props = (node as Element).props;
  if (/Retry/.test(textOf(props?.children)) && typeof props?.onClick === "function") return props.onClick;
  return retryOf(props?.children);
}
// Execute complete real read effects and components; React scheduling and
// router are ports. Other account UI stays unrendered. Fetch cannot escape.
function mount(name: "ProfileScreen" | "UsageScreen") {
  const states: unknown[] = [], deps: unknown[][] = [], cleanup: Array<(() => void) | undefined> = [];
  let index = 0, pending: Array<() => void> = [], unmounted = false, lateWrites = 0;
  const captured: unknown[] = [];
  const react = {
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in states)) states[slot] = initial;
      return [states[slot], (next: unknown) => {
        if (unmounted) lateWrites++;
        states[slot] = typeof next === "function" ? next(states[slot]) : next;
      }];
    },
    useEffect(effect: () => (() => void) | void, values: unknown[]) {
      const slot = index++;
      if (deps[slot] && values.every((v, i) => Object.is(v, deps[slot][i]))) return;
      deps[slot] = values;
      pending.push(() => { cleanup[slot]?.(); cleanup[slot] = effect() ?? undefined; });
    },
  };
  const filename = path.join(app, `features/account/${name}.tsx`);
  const source = process.env.ACCOUNT_READ_SOURCE_DIR ? path.join(process.env.ACCOUNT_READ_SOURCE_DIR, `${name}.tsx`) : filename;
  const js = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const mod = { exports: {} as Record<string, (props: unknown) => unknown> };
  new Function("require", "module", "exports", js)((id: string) => {
    if (id === "react") return react;
    if (id === "@sentry/nextjs") return { captureException: (error: unknown) => captured.push(error) };
    if (id === "next/navigation") return { useRouter: () => ({ push: noop }) };
    return requireApp(id.startsWith("@/") ? path.join(app, id.slice(2)) : id.startsWith(".") ? path.resolve(path.dirname(filename), id) : id);
  }, mod, mod.exports);
  return {
    render() { index = 0; const result = mod.exports[name]({}); const effects = pending; pending = []; effects.forEach((effect) => effect()); return result; },
    unmount() { unmounted = true; cleanup.forEach((effect) => effect?.()); },
    lateWrites: () => lateWrites,
    captured,
  };
}
async function main() {
  const original = globalThis.fetch;
  const failures: string[] = [];
  const run = async (name: string, body: () => Promise<void>) => {
    try { await body(); console.log(`pass ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
  };
  try {
    for (const name of ["ProfileScreen", "UsageScreen"] as const) {
      for (const failure of ["network", "body", "http", "missing-profile"] as const) await run(`${name} ${failure} is owned and recoverable`, async () => {
        globalThis.fetch = async (url) => {
          assert.equal(url, "/api/account/me");
          if (failure === "network") throw new TypeError("synthetic offline");
          if (failure === "body") return new Response("{");
          if (failure === "missing-profile") return Response.json({});
          return Response.json({ profile, snapshot }, { status: 401 });
        };
        const unhandled: unknown[] = [];
        const listener = (error: unknown) => unhandled.push(error);
        process.on("unhandledRejection", listener);
        const owner = mount(name);
        try {
          owner.render(); await tick(); const result = owner.render();
          assert.deepEqual(unhandled, []);
          assert.equal(owner.captured.length, 1, "real active failures remain observable to telemetry");
          assert.match(textOf(result), /Could not load.*account|Could not load.*profile/i);
          const retry = retryOf(result) as () => void;
          assert.equal(typeof retry, "function");
          globalThis.fetch = async () => Response.json({ profile, snapshot });
          retry(); owner.render(); await tick();
          assert.doesNotMatch(textOf(owner.render()), /Could not load/);
        } finally { owner.unmount(); await tick(); process.off("unhandledRejection", listener); }
      });
      await run(`${name} cleanup rejects late identity`, async () => {
        let finish: (value: unknown) => void = noop;
        globalThis.fetch = async () => ({ ok: true, json: () => new Promise((resolve) => { finish = resolve; }) }) as Response;
        const owner = mount(name); owner.render(); await tick(); owner.unmount();
        finish({ profile, snapshot }); await tick();
        assert.equal(owner.lateWrites(), 0);
        assert.equal(owner.captured.length, 0, "cleanup cancellation is not reported as an active failure");
      });
    }
  } finally { globalThis.fetch = original; }
  assert.deepEqual(failures, []);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
