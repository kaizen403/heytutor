import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  pickLiveDiagramExampleIds,
  awaitLiveDiagramExamplePicker,
  scenePlannerUrlWithExampleIds,
} from "../../features/tutor-session/lib/scene/diagramExamplePickerClient";
import {
  injectLiveDiagramExamples,
  parseLiveDiagramExampleIds,
  resolveLiveDiagramExamples,
} from "../../lib/scene/diagramExampleLibrary.server";
import { loadDiagramExemplarLibrary } from "../lecture-lab/diagramExamples";

async function main(): Promise<void> {
let selectedIds: string[] = [];
let settlePicker!: () => void;
const deferredPicker = new Promise<void>((resolve) => { settlePicker = () => { selectedIds = ["synthetic:segment"]; resolve(); }; });
const joined = awaitLiveDiagramExamplePicker(deferredPicker, true);
assert.deepEqual(selectedIds, []);
settlePicker();
await joined;
assert.deepEqual(selectedIds, ["synthetic:segment"], "even a nonnumeric plan joins the bounded picker before scene construction");
assert.equal(await awaitLiveDiagramExamplePicker(new Promise(() => {}), false), 0, "switch-off paths do not wait");
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

// Exercise the actual browser response parser, URL transport, server parser,
// allowlisted resolver and planner-body injection, not a copy of either regex.
const library = loadDiagramExemplarLibrary(resolve(process.cwd(), "../../data/diagram-eval/v1/exemplars/_library.jsonl"), []);
for (let offset = 0; offset < library.length; offset += 3) {
  const ids = library.slice(offset, offset + 3).map(example => example.id);
  const roundTrip = await pickLiveDiagramExampleIds({
    question: plan.question, plan,
    fetchImpl: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ ids }) } }] }),
  });
  assert.deepEqual(roundTrip.ids, ids, "every checked library ID must survive the browser response parser");
  const url = new URL(scenePlannerUrlWithExampleIds("/api/chat", roundTrip.ids), "http://localhost");
  const admittedIds = parseLiveDiagramExampleIds(url.searchParams.get("diagramExampleIds"));
  assert.deepEqual(admittedIds, ids, "every checked library ID must survive URL encoding and the server parser");
  const resolved = resolveLiveDiagramExamples("Unrelated public regression fixture.", admittedIds);
  assert.deepEqual(resolved.map(example => example.id), ids);
  const injected = JSON.parse(injectLiveDiagramExamples(JSON.stringify({ messages: [
    { role: "user", content: "Plan a checked figure." },
  ] }), resolved)) as { messages: Array<{ content: string }> };
  for (const id of ids) assert.ok(injected.messages[0]!.content.includes(id), "resolved examples reach the scene planner");
}
assert.deepEqual(parseLiveDiagramExampleIds(`curated:maths/x--1,bad id,../private,a?b,a#b,a%2Fb,${"a".repeat(129)}`), ["curated:maths/x--1"]);
assert.deepEqual(resolveLiveDiagramExamples("Unrelated public regression fixture.", ["curated:maths/not-in-library--1", "https://host/x"]), [],
  "permitting slash does not bypass the checked library allowlist");
const curated = library.find(example => example.sourceKind === "curated")!;
assert.deepEqual(resolveLiveDiagramExamples(curated.question!, [curated.id]), [], "source-question leak exclusion still applies");

let noFigureRequests = 0;
const noFigure = await pickLiveDiagramExampleIds({
  question: "Explain a definition without a figure.",
  plan: { ...plan, visualRequirement: "none" },
  fetchImpl: async () => { noFigureRequests += 1; return Response.json({}); },
});
assert.equal(noFigureRequests, 0, "a final no-figure turn must not dispatch a paid picker request");
assert.deepEqual(noFigure.ids, []);

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
assert.match(routeSource, /diagramExamplePicker \? \[resolveCheapFireworksModel\(\)\]/);
const handlerSource = readFileSync(resolve(process.cwd(), "features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
assert(handlerSource.indexOf("startDiagramExamplePicker(turnPlan)") > handlerSource.indexOf("const evaluatedVisualNeed ="),
  "picker admission must wait for the merged live visual decision, including rescue of preliminary none");
assert(handlerSource.indexOf("const pickerWaitMs =") < handlerSource.indexOf("const planning = await runScenePlanningOverlap"));
assert.match(handlerSource, /preferPlanner: diagramStrategyDecision\.strategy === "strict"/);
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
