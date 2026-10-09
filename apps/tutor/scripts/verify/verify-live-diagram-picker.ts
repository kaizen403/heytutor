import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  pickLiveDiagramExampleIds,
  scenePlannerUrlWithExampleIds,
} from "../../features/tutor-session/lib/scene/diagramExamplePickerClient";

async function main(): Promise<void> {
const plan = {
  schemaVersion: "turn-plan/v3" as const,
  question: "Sketch a projectile trajectory",
  givens: [],
  unknowns: [],
  derived: [],
  assumptions: [],
  qualitativeClaims: [],
  lawIds: [],
  visualRequirement: "required" as const,
};

const picked = await pickLiveDiagramExampleIds({
  question: plan.question,
  plan,
  traceId: "picker-test",
  fetchImpl: async () => Response.json({
    choices: [{ message: { content: '{"ids":["synthesized:projectile","bad id"]}' } }],
  }),
});
assert.deepEqual(picked.ids, ["synthesized:projectile"]);
assert.equal(picked.status, "picked");

const failed = await pickLiveDiagramExampleIds({
  question: plan.question,
  plan,
  fetchImpl: async () => Response.json({ error: "upstream" }, { status: 502 }),
});
assert.deepEqual(failed.ids, []);
assert.equal(failed.status, "failed", "a failed picker falls back to no examples");

const slow = await pickLiveDiagramExampleIds({
  question: plan.question,
  plan,
  timeoutMs: 5,
  fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const keepAlive = setTimeout(() => reject(new Error("test picker did not abort")), 50);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(keepAlive);
      reject(new DOMException("timeout", "AbortError"));
    }, { once: true });
  }),
});
assert.deepEqual(slow.ids, []);
assert.equal(slow.status, "timeout", "a slow picker falls back at its deadline");

assert.equal(
  scenePlannerUrlWithExampleIds("/api/chat", ["one", "two"]),
  "/api/chat?diagramExampleIds=one%2Ctwo",
  "the browser sends ids, not example documents",
);

const routeSource = readFileSync(resolve(process.cwd(), "app/api/chat/route.ts"), "utf8");
assert.match(routeSource, /diagramExamplePicker \? \[DEFAULT_CHEAP_FIREWORKS_MODEL\]/);
assert.match(routeSource, /reservePaidUsage\(\{ actor, grant, kind: "planner"/);
assert.match(routeSource, /diagram_example_picker: diagramExamplePicker/);
assert.match(routeSource, /injectLiveDiagramExamples/);
assert.match(routeSource, /resolveLiveDiagramExamples/);

console.log("live diagram picker billing, tracing, timeout, and transport verification passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
