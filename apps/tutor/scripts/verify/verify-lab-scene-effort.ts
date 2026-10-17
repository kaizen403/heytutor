/** Offline contract for the scene-only lecture-lab effort experiment. No model calls. */
import assert from "node:assert/strict";
import { LECTURE_LAB_HEADER } from "../../lib/billing/flags";
import { serverChatBody } from "../../lib/llm/chatRequest";
import { labProviderConfig } from "../../lib/llm/labProviderConfig";
import {
  applyLectureLabSceneEffort,
  lectureLabSceneEffort,
  LECTURE_LAB_SCENE_EFFORT_HEADER,
  type LectureLabSceneEffort,
} from "../../lib/llm/labSceneEffort";
import { completionTokenCap, providerChatBody } from "../../lib/llm/llmProvider";
import { parseOptions } from "../lecture-lab/run";
import { readFileSync } from "node:fs";

const token = "offline-scene-effort-fixture";
const efforts: readonly LectureLabSceneEffort[] = ["low", "medium", "high"];
const sceneContext = { provider: "azure", semanticSceneV2: true };
const authEnv = (value?: string): NodeJS.ProcessEnv => ({ NODE_ENV: "test", LECTURE_LAB_TOKEN: value });
for (const effort of efforts) {
  const options = parseOptions(["--eval", "fixture.jsonl", "--max-usd", "1", "--scene-reasoning-effort", effort]);
  assert.equal(options.sceneReasoningEffort, effort);
  assert.equal(options.scenePlannerLimitMs, 60_000);
}
assert.equal(parseOptions(["--eval", "fixture.jsonl", "--max-usd", "1"]).sceneReasoningEffort, undefined);
assert.throws(() => parseOptions(["--max-usd", "1", "--scene-reasoning-effort", "high"]), /evaluation-only/);
for (const effort of ["", "HIGH", "xhigh", "true"]) {
  assert.throws(() => parseOptions(["--eval", "fixture.jsonl", "--max-usd", "1", `--scene-reasoning-effort=${effort}`]), /must be low, medium or high/);
}

function request(effort?: string, presentedToken?: string): Request {
  const headers = new Headers();
  if (effort !== undefined) headers.set(LECTURE_LAB_SCENE_EFFORT_HEADER, effort);
  if (presentedToken !== undefined) headers.set(LECTURE_LAB_HEADER, presentedToken);
  return new Request("https://scene-effort.fixture.invalid/api/chat", { method: "POST", headers });
}

assert.equal(LECTURE_LAB_SCENE_EFFORT_HEADER, "x-heytutor-lab-scene-effort");
for (const effort of efforts) {
  assert.equal(lectureLabSceneEffort(request(effort, token), authEnv(token)), effort,
    "only an authenticated lab request may select a valid effort");
  for (const presented of [undefined, "wrong-token", `${token}x`]) {
    assert.equal(lectureLabSceneEffort(request(effort, presented), authEnv(token)), undefined,
      "missing, wrong and differently sized tokens never authorize the control");
  }
  for (const configured of [undefined, "", "another-token"]) {
    assert.equal(lectureLabSceneEffort(request(effort, token), authEnv(configured)), undefined,
      "an absent or mismatched server token keeps the control disabled");
  }
}
for (const effort of [undefined, "", "none", "minimal", "xhigh", "HIGH", "Medium", "high,low", "hi gh", "1"]) {
  assert.equal(lectureLabSceneEffort(request(effort, token), authEnv(token)), undefined,
    "absent and invalid effort values are ignored even with the correct lab token");
}

// Build the exact provider-translated low body first. The experiment must not
// let Azure's per-effort translation change the completion ceiling as well.
for (const contentCap of [4800, 5200]) {
  for (const tier of [undefined, "default", "priority"]) {
    const source = {
      model: "offline-deployment",
      messages: [{ role: "system", content: "Return a checked scene." }, { role: "user", content: "Fixture." }],
      max_tokens: contentCap,
      thinking: { type: "disabled" },
      temperature: 0,
      stream: false,
      response_format: { type: "json_object" },
      ...(tier === undefined ? {} : { service_tier: tier }),
    };
    const sourceBefore = structuredClone(source);
    const wire = Object.freeze(providerChatBody(source, { provider: "azure" }, {}));
    const before = structuredClone(wire);
    const beforeBytes = JSON.stringify(wire);
    assert.equal(wire.reasoning_effort, "low");
    assert.equal(completionTokenCap(wire), contentCap + 2048);
    for (const effort of efforts) {
      const selected = lectureLabSceneEffort(request(effort, token), authEnv(token));
      const actual = applyLectureLabSceneEffort(wire, selected, sceneContext);
      assert.equal(actual.service_tier, tier, "the effort experiment cannot select a service tier");
      assert.deepEqual(actual, { ...before, reasoning_effort: effort },
        "effort is the only provider-bound field that may differ between arms");
      assert.equal(completionTokenCap(actual), contentCap + 2048,
        "medium/high keep the production-low completion ceiling, including reasoning");
      if (effort === "low") assert.equal(JSON.stringify(actual), beforeBytes,
        "the low arm is byte-identical to the production-low wire body");
      assert.deepEqual(wire, before, "applying an arm cannot mutate its translated source body");
      assert.deepEqual(source, sourceBefore, "provider and effort translation leave the caller's body untouched");
    }
    assert.equal(applyLectureLabSceneEffort(wire, undefined, sceneContext), wire,
      "the absent control preserves the original body object");
    for (const [lane, context] of [
      ["turn plan", { provider: "azure", semanticSceneV2: false }],
      ["ProblemIR", { provider: "azure", semanticSceneV2: false }],
      ["code lesson", { provider: "azure", semanticSceneV2: false }],
      ["teaching", { provider: "azure", semanticSceneV2: false }],
      ["example picker", { provider: "azure", semanticSceneV2: true, diagramExamplePicker: true }],
      ["unknown provider", { provider: "other", semanticSceneV2: true }],
    ] satisfies Array<[string, { provider: string; semanticSceneV2: boolean; diagramExamplePicker?: boolean }]>) {
      for (const effort of efforts) {
        assert.equal(applyLectureLabSceneEffort(wire, effort, context), wire, `${lane} remains untouched`);
      }
    }
    const fireworks = providerChatBody(source, { provider: "fireworks" }, {});
    assert.equal(applyLectureLabSceneEffort(fireworks, "high", { provider: "fireworks", semanticSceneV2: true }), fireworks,
      "the Azure-only lab experiment cannot change Fireworks requests");
  }
}

// A malicious ordinary client still loses vendor fields at the existing server
// boundary; an unauthenticated effort header cannot put them back afterward.
const malicious = {
  messages: [{ role: "user", content: "Offline fixture." }],
  reasoning_effort: "high",
  thinking: { type: "enabled", budget_tokens: 99_999 },
  max_completion_tokens: 99_999,
  service_tier: "priority",
};
for (const kind of ["planner", "teaching"] satisfies Array<"planner" | "teaching">) {
  const sanitized = serverChatBody(malicious, kind);
  for (const field of ["reasoning_effort", "thinking", "max_completion_tokens", "service_tier"]) {
    assert.equal(sanitized[field], undefined, `ordinary ${kind} clients cannot supply ${field}`);
  }
  const wire = providerChatBody({ ...sanitized, max_tokens: 4800, thinking: { type: "disabled" } }, { provider: "azure" }, {});
  const before = JSON.stringify(wire);
  const selected = lectureLabSceneEffort(request("high", "attacker"), authEnv(token));
  const actual = applyLectureLabSceneEffort(wire, selected, { provider: "azure", semanticSceneV2: kind === "planner" });
  assert.equal(actual, wire, "an unauthenticated header preserves the production request object");
  assert.equal(JSON.stringify(actual), before, "an unauthenticated header preserves production wire bytes");
}

// Preflight must report the selected scene arm without changing the caps used
// to reserve spend, any other lane, the deployment, or service-tier identity.
const fixtureEnv = {
  LLM_PROVIDER: "azure",
  AZURE_OPENAI_ENDPOINT: "https://scene-effort.fixture.invalid",
  AZURE_OPENAI_API_KEY: "offline-fixture-only",
  AZURE_OPENAI_DEPLOYMENT: "offline-scene-deployment",
  LECTURE_LAB_TOKEN: token,
  AZURE_OPENAI_MIN_REASONING_EFFORT: undefined,
  DIAGRAM_PLANNER_PRIORITY: undefined,
};
const priorEnv = new Map(Object.keys(fixtureEnv).map((key) => [key, process.env[key]]));
try {
  for (const [key, value] of Object.entries(fixtureEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const baseline = labProviderConfig();
  assert.equal(baseline.planningSpeed.sceneEffort, "low");
  for (const effort of efforts) {
    const config = labProviderConfig(request(effort, token));
    assert.equal(config.planningSpeed.sceneEffort, effort, "authenticated preflight identifies the selected scene effort");
    assert.deepEqual([config.provider, config.deployment, config.configured], [baseline.provider, baseline.deployment, baseline.configured]);
    assert.equal(config.plannerOutputCap, baseline.plannerOutputCap, "all arms reserve the same planner completion ceiling");
    assert.equal(config.teachingOutputCap, baseline.teachingOutputCap, "scene effort cannot expand teaching reservations");
    assert.equal(config.planningSpeed.requestTier, baseline.planningSpeed.requestTier);
    assert.equal(config.planningSpeed.priority, baseline.planningSpeed.priority);
    assert.deepEqual(config.visualNeed, baseline.visualNeed, "the visual-need policy is outside this intervention");
  }
  for (const ignored of [request(), request("high"), request("high", "wrong-token"), request("xhigh", token)]) {
    assert.deepEqual(labProviderConfig(ignored), baseline, "unauthorized, absent and invalid controls leave preflight unchanged");
  }
} finally {
  for (const [key, value] of priorEnv) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

console.log("lab scene effort: authenticated scene-only one-field intervention, fixed caps, immutable low wire and production isolation pass");

// Protect the wiring as well as the pure boundary; the provider translator must
// not overwrite the arm after authentication, nor may config omit the request.
const route = readFileSync(new URL("../../app/api/chat/route.ts", import.meta.url), "utf8");
assert.match(route, /labSceneEffort: lectureLabSceneEffort\(request\)/);
assert.match(route, /applyLectureLabSceneEffort\(\s*providerChatBody\([\s\S]*?labSceneEffort,\s*\{ provider: llm.provider, semanticSceneV2, diagramExamplePicker \}/);
const configRoute = readFileSync(new URL("../../app/api/lecture-lab/config/route.ts", import.meta.url), "utf8");
assert.match(configRoute, /labProviderConfig\(request\)/);
