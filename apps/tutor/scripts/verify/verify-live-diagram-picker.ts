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
  buildLiveDiagramPickerBody,
  parseLiveDiagramExampleIds,
  resolveLiveDiagramExamples,
} from "../../lib/scene/diagramExampleLibrary.server";
import { buildDiagramExampleCatalogue, loadDiagramExemplarLibrary, type DiagramExemplar } from "../lecture-lab/diagramExamples";
import { pickDiagramExamples } from "../lecture-lab/diagramExamplePicker";

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

// Distinct IDs AND descriptions: simply cloning today's entries would pass
// through deduplication without proving any growth headroom.
const doubled = [...library, ...library.map((example, index) => ({
  ...example, id: `${example.id}:growth`,
  depicts: `${Array.from({ length: 8 }, (_, word) => `v${index}d${word}`).join(" ")} ${example.depicts}`,
}))];
const doubledCatalogue = buildDiagramExampleCatalogue(doubled);
assert.ok(doubledCatalogue.estimatedTokens < 6_000, "a genuinely distinct twice-size library must fit without throwing");
assert.ok(doubledCatalogue.entries.length > buildDiagramExampleCatalogue(library).entries.length,
  "growth must admit additional entries, not discard the whole extension");
assert.deepEqual(buildDiagramExampleCatalogue([...doubled].reverse()), doubledCatalogue, "catalogue packing must be input-order independent");
const relevant: DiagramExemplar = { ...curated, id: "curated:physics/zz-relevant--1",
  depicts: "potentiometer balances unknown emf against calibrated resistance wire null galvanometer" };
const oversized = { ...curated, id: "curated:physics/aa-oversized--1", depicts: "x".repeat(30_000) };
const overflow = [...doubled, oversized, relevant];
const bounded = buildDiagramExampleCatalogue(overflow, { question: "potentiometer unknown emf resistance wire null galvanometer" });
assert.ok(bounded.estimatedTokens < 6_000);
assert.ok(bounded.entries.some(example => example.id === relevant.id), "a relevant late ID must survive overflow shortlisting");
assert.ok(!bounded.entries.some(example => example.id === oversized.id), "one oversized entry must not block later usable entries");
assert.ok(bounded.omittedEntries > 0, "budget omissions must be explicit");
assert.equal(bounded.estimatedTokens, Math.ceil(bounded.text.length / 4), "packing accounts for exactly the sent line lengths and newlines");
assert.deepEqual(buildDiagramExampleCatalogue([...overflow].reverse(), { question: "potentiometer unknown emf resistance wire null galvanometer" }), bounded);
const planGuided = buildDiagramExampleCatalogue(overflow, { plan: { ...plan,
  qualitativeClaims: [{ id: "null", claim: "potentiometer unknown emf resistance wire null galvanometer", expected: true }],
} });
assert.ok(planGuided.entries.some(example => example.id === relevant.id), "live turn-plan evidence also guides overflow");
assert.ok(bounded.entries.every(example => example.depicts.split(/\s+/).length <= 16), "the existing description budget is not increased");
let sentPickerPrompt = "";
const labPick = await pickDiagramExamples(overflow, buildDiagramExampleCatalogue(overflow), {
  question: "potentiometer unknown emf resistance wire null galvanometer", families: [], archetypeId: null,
  env: { LLM_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://test.cognitiveservices.azure.com/",
    AZURE_OPENAI_DEPLOYMENT: "test-deployment", AZURE_OPENAI_API_KEY: "test-key" },
  fetchImpl: async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    sentPickerPrompt = body.messages[0]!.content;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ ids: [relevant.id] }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 } });
  },
});
assert.ok(sentPickerPrompt.includes(relevant.id), "the real lab picker must repack an overflowed global catalogue per turn");
assert.deepEqual(labPick.examples.map(example => example.id), [relevant.id]);
assert.equal(labPick.record.catalogueOmittedEntries, bounded.omittedEntries);
assert.deepEqual(buildDiagramExampleCatalogue([]), { entries: [], text: "", estimatedTokens: 0, omittedEntries: 0 });
const pickerBody = JSON.parse(buildLiveDiagramPickerBody(JSON.stringify({ messages: [
  { role: "user", content: JSON.stringify({ plan }) },
] }), plan.question)) as { messages: Array<{ content: string }> };
assert.ok(pickerBody.messages[0]!.content.includes("CATALOGUE\n"));
assert.ok(pickerBody.messages[0]!.content.includes("curated:"), "the real live picker body exposes eligible curated examples");
console.log(JSON.stringify({ libraryEntries: library.length, catalogue: buildDiagramExampleCatalogue(library).estimatedTokens,
  doubledLibraryEntries: doubled.length, doubledRetained: doubledCatalogue.entries.length,
  doubledEstimatedTokens: doubledCatalogue.estimatedTokens, doubledOmitted: doubledCatalogue.omittedEntries }));

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
