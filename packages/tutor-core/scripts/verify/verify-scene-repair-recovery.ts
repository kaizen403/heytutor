/** Harness 1: the actual repair transport must explain the failing input, not IDs alone. */
import assert from "node:assert/strict";
import { repairSceneDocument, type SceneRepairError } from "../../src/planners/scenePlannerV2";

const originalFetch = globalThis.fetch;
const candidate = {
  schemaVersion: "scene-document/v2", source: { question: "Construct the stated ellipse." },
  constructions: [{ id: "curve-build", operator: "conic", outputs: ["curve"],
    inputs: { kind: "ellipse", center: "centre", a: "axis-a", b: "axis-b", tMin: "bad-angle-27", tMax: "end-angle" } }],
  entities: [{ id: "curve", kind: "curve" }],
};
const errors: SceneRepairError[] = [{
  code: "invalid_conic_tMin", severity: "fatal", path: "constructions[0].inputs.tMin", entityIds: ["curve"],
  message: "tMin must resolve to a finite angle in radians.", expected: "finite radian quantity", actual: "bad-angle-27",
}];
const prompts: string[] = [];
globalThis.fetch = (async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
  prompts.push(body.messages.at(-1)!.content);
  return Response.json({ choices: [{ message: { content: JSON.stringify(candidate) } }] });
}) as typeof fetch;
const options = { proxyUrl: "https://repair-fixture.invalid", constructionOperators: ["conic", "point"], repairRecoveryEnabled: false };

async function main(): Promise<void> {
  try {
    await repairSceneDocument(candidate.source.question, candidate, errors, options);
    await repairSceneDocument(candidate.source.question, candidate, errors,
      { ...options, repairRecoveryEnabled: true });
    assert.ok(!prompts[0]!.includes('"tMin":"bad-angle-27"'), "off preserves the legacy structure-only prompt");
    assert.ok(prompts[1]!.includes('"id":"curve-build"'), "feedback identifies the failing construction");
    assert.ok(prompts[1]!.includes('"tMin":"bad-angle-27"'), "repair can inspect the exact failing construction inputs");
    for (const fact of [errors[0]!.code, errors[0]!.path!, errors[0]!.message, "finite radian quantity"]) {
      assert.ok(prompts[1]!.includes(fact), `repair retains the exact validator rule: ${fact}`);
    }
    assert.deepEqual(errors[0]!.entityIds, ["curve"], "feedback does not rewrite validator ownership");
    assert.equal(candidate.constructions[0]!.inputs.tMin, "bad-angle-27", "feedback does not patch invalid geometry");
    console.log("scene repair recovery: exact failing element/input/rule feedback and unchanged off path pass");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
