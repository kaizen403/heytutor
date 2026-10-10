// Visual need when Jev is unavailable (null) versus an explicit "none".
//
// Student runs showed {"evaluated":null,"effective":"none"} on matrix stems:
// the visual-need route answered null (deadline, open circuit, missing key)
// and the planner's "none" then skipped every figure, including a matrix
// table the engine binds from the question itself. A null is not a decision.
// Only a stem the engine reads as a complete source program is reopened to
// "optional"; an explicit Jev "none" and every stem without a bound program
// keep their previous behaviour.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inferSceneCapabilities, questionRequiresVisual } from "@heytutor/tutor-core";
import { resolveVisualRequirement } from "../../features/tutor-session/lib/scene/visualRequirement";
import { shouldAttemptExactScene } from "../../features/tutor-session/lib/scene/diagramGeneration";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { fetchVisualNeed } from "../../features/tutor-session/lib/scene/visualNeedClient";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

let checks = 0;
const check = (condition: unknown, message: string): void => { checks++; assert.ok(condition, message); };

// 1. The decision table. The first five rows are the existing policy and must not move.
const table: Array<[Parameters<typeof resolveVisualRequirement>, string, string]> = [
  [["none", "required", false], "required", "Jev rescues a planner no-draw call"],
  [["optional", null, true], "required", "the deterministic requirement survives Jev failure"],
  [["required", "none", false], "required", "Jev cannot veto a required visual"],
  [["none", "optional", false], "optional", "a helpful Jev decision runs scene planning"],
  [["optional", "none", false], "none", "a no-draw Jev decision avoids optional unrelated scenes"],
  [["none", null, false, true], "optional", "Jev unavailable on a bound source program: the program may draw"],
  [["none", "none", false, true], "none", "an explicit Jev none still stands on a source program"],
  [["none", null, false, false], "none", "Jev unavailable without a source program: the planner none stands"],
  [["none", null, false], "none", "the default is no source program"],
  [["optional", null, false, true], "optional", "an optional plan is unchanged"],
  [["required", null, false, true], "required", "a required plan is unchanged"],
];
for (const [args, expected, message] of table) check(resolveVisualRequirement(...args) === expected, `${message}: ${JSON.stringify(args)} -> ${expected}`);

// 2. The live handler passes the engine's own source-program capability.
const handler = readFileSync(resolve(__dirname, "../../features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
check(/resolveVisualRequirement\(\s*turnPlan\.visualRequirement,\s*evaluatedVisualNeed,\s*questionRequiresVisual\(question\),\s*inferSceneCapabilities\(question, \{ turnPlan \}\)\.hasSourceProgram === true,\s*\)/.test(handler),
  "the live visual decision receives the engine source-program capability");
const selection = readFileSync(resolve(__dirname, "../../features/tutor-session/lib/scene/productionSceneSelection.ts"), "utf8");
check(handler.includes("selectProductionScene({") && selection.includes('turnPlan.visualRequirement === "none" && !questionRequiresVisual(question)'), "the shared live no-figure skip still keys on an effective none");

// 3. Real stems through the same decision the live turn makes with Jev null
// and a planner "none".
const plan = (question: string): TurnPlanV3 => ({ schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "none" });
const effective = (question: string, evaluated: "required" | "optional" | "none" | null = null) => {
  const turnPlan = plan(question);
  return resolveVisualRequirement(turnPlan.visualRequirement, evaluated, questionRequiresVisual(question), inferSceneCapabilities(question, { turnPlan }).hasSourceProgram === true);
};
for (const question of [
  "A=[[1,2],[3,4]] and B=[[0,1],[1,0]]. Find AB and BA.",
  "A=[[1,2],[3,4]] and B=[[0,1],[1,0]]. Show A and B and find AB and BA.",
  "A=[[1,2,3],[4,5,6]]. Find the transpose of A.",
]) {
  check(effective(question) === "optional", `Jev null on a matrix program reopens the figure: ${question}`);
  check(effective(question, "none") === "none", `explicit Jev none still skips: ${question}`);
  const capabilities = inferSceneCapabilities(question, { turnPlan: plan(question) });
  check(shouldAttemptExactScene({ visualRequirement: "optional", chemistryLane: false, familyCount: capabilities.families.length, hasArchetype: false, hasSourceProgram: capabilities.hasSourceProgram }), `the source program is attempted: ${question}`);
  const selected = selectVerifiedRepresentation({ question, turnPlan: { ...plan(question), visualRequirement: "optional" }, families: capabilities.families, exact: null });
  check(selected.sceneDocument.entities.some((entity) => entity.kind === "matrix_array"), `the engine fallback draws the bound matrix table: ${question}`);
}
for (const question of [
  "A car moving at 20 m/s brakes uniformly at 2 m/s^2 until it comes to rest. Find the time taken and the distance travelled.",
  "Convert 72 km/h into m/s.",
  "What is a diagonal matrix?",
  "A=[[1,2],[3,4]]. Find the determinant of A.",
  "Given points = [[0,0],[2,2],[3,10]], return the minimum cost to connect all points.",
]) {
  check(effective(question) === "none", `Jev null without a bound source program keeps the planner none: ${question}`);
}

// 4. The client maps every unavailable outcome to null, never to a decision.
async function main(): Promise<void> {
  const reply = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
  check(await fetchVisualNeed({ url: "x", question: "q", fetchImpl: reply({ decision: null, source: "unavailable" }) }) === null, "route unavailable -> null");
  check(await fetchVisualNeed({ url: "x", question: "q", fetchImpl: reply({ error: "x" }, 500) }) === null, "route error -> null");
  check(await fetchVisualNeed({ url: "x", question: "q", fetchImpl: reply({ decision: "none", source: "jev" }) }) === "none", "an explicit none is kept as none");
  const hanging = ((_url: string, init?: RequestInit) => new Promise((_resolve, rejectFetch) => init?.signal?.addEventListener("abort", () => rejectFetch(new Error("aborted"))))) as unknown as typeof fetch;
  const started = Date.now();
  check(await fetchVisualNeed({ url: "x", question: "q", fetchImpl: hanging }) === null, "a hanging route times out to null");
  const waited = Date.now() - started;
  check(waited >= 2_900 && waited < 4_000, `the client timeout is the documented 3 s (waited ${waited} ms)`);
  console.log(`visual-need null policy passed (${checks} checks)`);
}

// AbortSignal.timeout uses an unref'd timer; without a live handle node would
// exit mid-wait with code 0 and the gate would pass without finishing.
const keepAlive = setInterval(() => undefined, 1_000);
let finished = false;
process.on("exit", (code) => { if (!finished && code === 0) { console.error("visual-need null gate exited before finishing"); process.exitCode = 1; } });
main().then(() => { finished = true; }).catch((error) => { console.error(error); process.exitCode = 1; finished = true; }).finally(() => clearInterval(keepAlive));
