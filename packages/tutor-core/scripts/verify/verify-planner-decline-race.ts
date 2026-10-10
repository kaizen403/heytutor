/**
 * A valid text_only answer is a decline, not a figure. It must not open the
 * valid-candidate grace window that cancels a sibling lane still drawing the
 * scene; a valid scene that arrives first still closes the round.
 */
import assert from "node:assert/strict";
import { planSceneDocumentWithRepair } from "../../src/planners/scenePlannerV2";

const originalFetch = globalThis.fetch;
const reply = (document: Record<string, unknown>, delayMs: number) => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response(
  JSON.stringify({ choices: [{ message: { content: JSON.stringify(document) } }] }),
  { status: 200, headers: { "content-type": "application/json" } },
)), delayMs));
const decline = { schemaVersion: "scene-document/v2", visualDecision: { mode: "text_only", reason: "no stated values" } };
const scene = { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "drawn" }, figure: "scene" };
// Mirrors production scoring: a required-visual decline is valid but ranks far below any valid scene.
const validate = (candidate: Record<string, unknown>) => (candidate as { visualDecision?: { mode?: string } }).visualDecision?.mode === "text_only"
  ? { valid: true, errors: [], value: candidate, qualityScore: 100_000 }
  : { valid: true, errors: [], value: candidate, qualityScore: 10 };
async function run(primary: [Record<string, unknown>, number], alternate: [Record<string, unknown>, number]) {
  globalThis.fetch = async (_input, init) => {
    const lane = new Headers(init?.headers).get("x-scene-planner-lane");
    const [document, delayMs] = lane === "alternate" ? alternate : primary;
    return reply(document, delayMs);
  };
  const started = Date.now();
  const result = await planSceneDocumentWithRepair("draw the setup", validate, { proxyUrl: "http://planner.test", timeoutMs: 5000 });
  return { selected: result?.response.document, elapsedMs: Date.now() - started };
}
try {
  const late = await run([decline, 20], [scene, 1500]);
  assert.equal((late.selected as { figure?: string } | undefined)?.figure, "scene", "a fast decline must not cancel a scene arriving after the grace window");
  const both = await run([decline, 20], [decline, 300]);
  assert.equal((both.selected as { visualDecision?: { mode?: string } } | undefined)?.visualDecision?.mode, "text_only", "two declines still return the decline");
  assert(both.elapsedMs < 2500, `two declines return promptly: ${both.elapsedMs} ms`);
  const sceneFirst = await run([scene, 20], [decline, 1500]);
  assert.equal((sceneFirst.selected as { figure?: string } | undefined)?.figure, "scene", "a valid scene first still wins");
  assert(sceneFirst.elapsedMs < 1400, `a valid scene first still closes the round after the grace window: ${sceneFirst.elapsedMs} ms`);
  console.log("planner decline race: a decline never cancels a drawing sibling; scenes still close the round");
} finally {
  globalThis.fetch = originalFetch;
}
