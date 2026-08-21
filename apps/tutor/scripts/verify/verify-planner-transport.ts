import {
  fetchPlannerCompletion,
  resolvePlannerMaxTokens,
  resolvePlannerModels,
} from "../../lib/llm/plannerTransport";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const defaultSceneModels = resolvePlannerModels({
    semanticSceneV2: true,
    turnPlanV3: false,
    plannerPhase: "plan",
    env: {},
  });
  assert(
    defaultSceneModels[0] === "accounts/fireworks/routers/kimi-k2p6-turbo",
    "live scene planning must use the latency-bounded router before the base-model fallback",
  );

  const alternateSceneModels = resolvePlannerModels({
    semanticSceneV2: true,
    turnPlanV3: false,
    plannerPhase: "plan",
    plannerLane: "alternate",
    env: {},
  });
  assert(
    alternateSceneModels[0] === "accounts/fireworks/models/deepseek-v4-flash-0731",
    "the alternate scene lane must use an independent fast model family",
  );
  assert(
    alternateSceneModels.includes("accounts/fireworks/routers/kimi-k2p6-turbo"),
    "the alternate lane must retain the fast router as its transport fallback",
  );
  const alternateTurnModels = resolvePlannerModels({
    semanticSceneV2: false,
    turnPlanV3: true,
    plannerPhase: "plan",
    plannerLane: "alternate",
    env: {},
  });
  assert(
    alternateTurnModels[0] === "accounts/fireworks/models/deepseek-v4-flash-0731",
    "an invalid turn plan must be repaired by an independent model family",
  );
  assert(
    resolvePlannerMaxTokens({
      semanticSceneV2: false,
      turnPlanV3: true,
      plannerPhase: "plan",
      plannerLane: "primary",
      env: {},
    }) === 2800,
    "hard turn plans need enough output budget to finish valid compact JSON",
  );
  const problemIRModels = resolvePlannerModels({
    semanticSceneV2: false,
    turnPlanV3: false,
    problemIRV1: true,
    plannerPhase: "plan",
    env: {},
  });
  assert(
    problemIRModels[0] === "accounts/fireworks/routers/kimi-k2p6-turbo",
    "ProblemIR must use the same bounded generic planner lane rather than a topic model",
  );
  assert(
    resolvePlannerMaxTokens({
      semanticSceneV2: false,
      turnPlanV3: false,
      problemIRV1: true,
      plannerPhase: "plan",
      env: {},
    }) === 3600,
    "ProblemIR JSON must use the bounded structured-planner token budget",
  );

  const configuredAlternateModels = resolvePlannerModels({
    semanticSceneV2: true,
    turnPlanV3: false,
    plannerPhase: "repair",
    plannerLane: "alternate",
    env: {
      FIREWORKS_SCENE_ALTERNATE_MODEL: "alternate-primary",
      FIREWORKS_SCENE_ALTERNATE_FALLBACK_MODELS: "alternate-fallback, alternate-primary",
    },
  });
  assert(
    JSON.stringify(configuredAlternateModels) === JSON.stringify(["alternate-primary", "alternate-fallback"]),
    "alternate model configuration must retain order and remove duplicates",
  );
  assert(
    resolvePlannerMaxTokens({
      semanticSceneV2: true,
      turnPlanV3: false,
      plannerPhase: "plan",
      plannerLane: "primary",
      env: {},
    }) === 4800,
    "the primary scene lane needs enough output budget to avoid truncated JSON",
  );
  assert(
    resolvePlannerMaxTokens({
      semanticSceneV2: true,
      turnPlanV3: false,
      plannerPhase: "plan",
      plannerLane: "alternate",
      env: {},
    }) === 5200,
    "the alternate scene lane needs enough output budget for complete JSON",
  );
  assert(
    resolvePlannerMaxTokens({
      semanticSceneV2: true,
      turnPlanV3: false,
      plannerPhase: "plan",
      plannerLane: "alternate",
      env: { FIREWORKS_SCENE_ALTERNATE_MAX_TOKENS: "9000" },
    }) === 6000,
    "alternate scene token configuration must remain bounded",
  );

  const resolvedModels = resolvePlannerModels({
    semanticSceneV2: true,
    turnPlanV3: false,
    plannerPhase: "plan",
    env: {
      FIREWORKS_SCENE_PLANNER_MODEL: "primary",
      FIREWORKS_SCENE_PLANNER_FALLBACK_MODELS: " fallback-a, fallback-b, primary ",
      FIREWORKS_PLANNER_FALLBACK_MODELS: "generic",
    },
  });
  assert(
    JSON.stringify(resolvedModels) === JSON.stringify(["primary", "fallback-a", "fallback-b", "generic"]),
    "planner models must retain configured order and remove duplicates",
  );

  const requestedModels: string[] = [];
  const delays: number[] = [];
  const transientThenFallback = await fetchPlannerCompletion({
    apiKey: "test-key",
    body: { messages: [] },
    models: ["primary", "fallback"],
    maxAttemptsPerModel: 1,
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(body.model);
      return body.model === "primary"
        ? new Response("busy", { status: 503, headers: { "retry-after": "0.5" } })
        : new Response("ok", { status: 200 });
    },
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    url: "https://planner.test",
  });
  assert(transientThenFallback.response.status === 200, "a transient response must reach the fallback model");
  assert(transientThenFallback.model === "fallback", "the successful fallback model must be reported");
  assert(requestedModels.join(",") === "primary,fallback", "models must be tried in order");
  assert(delays.length === 1 && delays[0] === 500, "Retry-After seconds must control the bounded delay");

  let networkAttempts = 0;
  const networkThenSuccess = await fetchPlannerCompletion({
    apiKey: "test-key",
    body: {},
    models: ["primary", "fallback"],
    maxAttemptsPerModel: 1,
    fetchImpl: async () => {
      networkAttempts += 1;
      if (networkAttempts === 1) throw new TypeError("network unavailable");
      return new Response("recovered", { status: 200 });
    },
    sleep: async () => undefined,
    url: "https://planner.test",
  });
  assert(networkThenSuccess.response.status === 200, "network errors must retry on the next model");
  assert(networkAttempts === 2, "one thrown fetch must produce one retry");

  let permanentAttempts = 0;
  const permanentFailure = await fetchPlannerCompletion({
    apiKey: "test-key",
    body: {},
    models: ["primary", "fallback"],
    fetchImpl: async () => {
      permanentAttempts += 1;
      return new Response("invalid request", { status: 400 });
    },
    sleep: async () => undefined,
    url: "https://planner.test",
  });
  assert(permanentFailure.response.status === 400, "permanent upstream status must be preserved");
  assert(await permanentFailure.response.text() === "invalid request", "permanent response body must be preserved");
  assert(permanentAttempts === 1, "permanent 4xx responses must not be retried");

  const unavailableThenFallbackModels: string[] = [];
  const unavailableThenFallback = await fetchPlannerCompletion({
    apiKey: "test-key",
    body: {},
    models: ["retired", "fallback"],
    maxAttemptsPerModel: 2,
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      unavailableThenFallbackModels.push(body.model);
      return body.model === "retired"
        ? new Response("model not found", { status: 404 })
        : new Response("ok", { status: 200 });
    },
    sleep: async () => undefined,
    url: "https://planner.test",
  });
  assert(unavailableThenFallback.response.status === 200, "an undeployed model must reach the next configured model");
  assert(unavailableThenFallback.model === "fallback", "the successful fallback model must be reported after a 404");
  assert(
    unavailableThenFallbackModels.join(",") === "retired,fallback",
    "a missing model must skip remaining attempts on that id",
  );

  let exhaustedAttempts = 0;
  const exhausted = await fetchPlannerCompletion({
    apiKey: "test-key",
    body: {},
    models: ["primary"],
    maxAttemptsPerModel: 2,
    fetchImpl: async () => {
      exhaustedAttempts += 1;
      return new Response(`busy-${exhaustedAttempts}`, { status: 429 });
    },
    sleep: async () => undefined,
    url: "https://planner.test",
  });
  assert(exhausted.response.status === 429, "the final transient status must be preserved after exhaustion");
  assert(await exhausted.response.text() === "busy-2", "the final transient response body must remain readable");

  let mixedAttempts = 0;
  const mixedFailure = await fetchPlannerCompletion({
    apiKey: "test-key",
    body: {},
    models: ["primary", "fallback"],
    maxAttemptsPerModel: 1,
    fetchImpl: async () => {
      mixedAttempts += 1;
      if (mixedAttempts === 1) return new Response("primary busy", { status: 503 });
      throw new TypeError("fallback network unavailable");
    },
    sleep: async () => undefined,
    url: "https://planner.test",
  });
  assert(mixedFailure.response.status === 503, "the last upstream response must survive later network errors");
  assert(await mixedFailure.response.text() === "primary busy", "the retained upstream error body must remain readable");

  let timeoutSignalObserved = false;
  let timeoutRejected = false;
  try {
    await fetchPlannerCompletion({
      apiKey: "test-key",
      attemptTimeoutMs: 5,
      body: {},
      models: ["primary"],
      maxAttemptsPerModel: 1,
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          timeoutSignalObserved = true;
          reject(init.signal?.reason);
        }, { once: true });
      }),
      url: "https://planner.test",
    });
  } catch {
    timeoutRejected = true;
  }
  assert(timeoutSignalObserved && timeoutRejected, "a stalled planner fetch must abort at its per-attempt deadline");

  console.log("planner transport verification passed");
}

void main();
