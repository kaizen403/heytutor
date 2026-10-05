import { readFileSync } from "node:fs";
import { TEACHING_STARTUP_RETRY_HEADER as CLIENT_STARTUP_RETRY_HEADER } from "@heytutor/tutor-core";
import {
  CODE_LESSON_TEACHING_MAX_TOKENS,
  DEFAULT_TEACHING_FAST_MODEL,
  DEFAULT_TEACHING_MAX_TOKENS,
  DEFAULT_TEACHING_MODEL,
  DEFAULT_TEACHING_RETRY_MODEL,
  TEACHING_STARTUP_RETRY_HEADER,
  TEACHING_TOKEN_CEILING,
  fetchTeachingCompletion,
  classifyTeachingFailure,
  nextTeachingAttempt,
  readTeachingStartupRetry,
  resolveTeachingContentBudget,
  resolveTeachingModel,
  resolveTeachingModelRoute,
  resolveTeachingReasoningEffort,
  teachingAttemptModel,
  teachingAttemptMayHaveGenerated,
} from "../../lib/llm/teachingTransport";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  resolveTeachingModel({}) === DEFAULT_TEACHING_MODEL,
  "teaching should default to Kimi K3",
);
assert(
  DEFAULT_TEACHING_MODEL === "accounts/fireworks/models/kimi-k3",
  "the spoken teaching default must accept thinking: disabled",
);
assert(
  resolveTeachingModel({ FIREWORKS_MODEL: "planner-only-model" }) ===
    DEFAULT_TEACHING_MODEL,
  "FIREWORKS_MODEL must not steal the teaching lane",
);
assert(
  resolveTeachingModel({ FIREWORKS_TEACHING_MODEL: "only-this-model" }) ===
    "only-this-model",
  "FIREWORKS_TEACHING_MODEL must be the only teaching override",
);
assert(
  resolveTeachingModel({}, { fastMode: true }) === DEFAULT_TEACHING_FAST_MODEL,
  "fast mode teaching must default to Kimi K3 Fast",
);
assert(
  DEFAULT_TEACHING_FAST_MODEL === "accounts/fireworks/routers/kimi-k3-fast",
  "the teaching Fast SKU must accept thinking: disabled",
);
assert(
  resolveTeachingModel(
    {
      FIREWORKS_TEACHING_MODEL: "standard-model",
      FIREWORKS_FAST_MODEL: "planner-fast-model",
    },
    { fastMode: true },
  ) === DEFAULT_TEACHING_FAST_MODEL,
  "planner Fast ENV must not steal the teaching lane",
);
assert(
  resolveTeachingModel(
    {
      FIREWORKS_TEACHING_MODEL: "standard-model",
      FIREWORKS_TEACHING_FAST_MODEL: "teaching-fast-model",
    },
    { fastMode: true },
  ) === "teaching-fast-model",
  "fast mode teaching must use FIREWORKS_TEACHING_FAST_MODEL when set",
);
assert(
  resolveTeachingModel(
    {
      FIREWORKS_TEACHING_MODEL: "standard-model",
      FIREWORKS_TEACHING_FAST_MODEL: "teaching-fast-model",
    },
    { fastMode: false },
  ) === "standard-model",
  "turning fast mode off must keep teaching on FIREWORKS_TEACHING_MODEL",
);
assert(
  resolveTeachingReasoningEffort({
    question: "A hard multi-part electromagnetic induction problem",
    hasAuthoritativePlan: true,
    mode: "medium",
  }) === "none",
  "an audited plan must not be solved again during narration",
);
assert(
  resolveTeachingReasoningEffort({
    question: "Derive the moment of inertia and calculate three results",
    hasAuthoritativePlan: false,
    mode: "auto",
  }) === "medium",
  "unplanned fallback teaching lost its reasoning classifier",
);
assert(
  resolveTeachingReasoningEffort({
    question: "can yuou explain me the basics of dynamic programming with code",
    hasAuthoritativePlan: false,
    mode: "auto",
  }) === "none",
  "a polite explain-the-basics request must start speaking without a solve budget",
);
assert(
  resolveTeachingContentBudget() === DEFAULT_TEACHING_MAX_TOKENS,
  "ordinary teaching must keep the 3600 default",
);
assert(
  resolveTeachingContentBudget({ env: { FIREWORKS_MAX_TOKENS: "3600" } }) ===
    DEFAULT_TEACHING_MAX_TOKENS,
  "FIREWORKS_MAX_TOKENS=3600 must not raise the ordinary ceiling",
);
assert(
  resolveTeachingContentBudget({ env: { FIREWORKS_MAX_TOKENS: "9000" } }) ===
    TEACHING_TOKEN_CEILING,
  "ordinary teaching must stay under the 6000 ceiling",
);
assert(
  resolveTeachingContentBudget({
    codeLesson: true,
    env: { FIREWORKS_MAX_TOKENS: "3600" },
  }) === CODE_LESSON_TEACHING_MAX_TOKENS,
  "a code lesson must not inherit the 3600 FIREWORKS_MAX_TOKENS cap",
);
assert(
  resolveTeachingContentBudget({ codeLesson: true }) === CODE_LESSON_TEACHING_MAX_TOKENS,
  "a code lesson must get the 12k teaching budget",
);

// Startup retry routing. Measured 6 Oct 2026: the Kimi K3 Fast router stalled
// for about a minute and the startup retry went back to the same router.
{
  const same = (actual: unknown, expected: unknown, message: string) =>
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: got ${JSON.stringify(actual)}`);
  assert(
    DEFAULT_TEACHING_RETRY_MODEL === "accounts/fireworks/models/kimi-k3",
    "the startup retry must default to the standard Kimi K3 deployment",
  );
  const first = resolveTeachingModelRoute({}, { fastMode: true });
  same(first, { model: DEFAULT_TEACHING_FAST_MODEL, alternate: DEFAULT_TEACHING_MODEL, fallbackReason: null },
    "a first Fast mode request must call the router, with standard Kimi K3 as its alternate");
  for (const reason of ["first_content_timeout", "reasoning_only"] as const) {
    same(resolveTeachingModelRoute({}, { fastMode: true, startupRetry: reason }),
      { model: DEFAULT_TEACHING_MODEL, alternate: null, fallbackReason: `startup_retry_${reason}` },
      `a Fast mode startup retry (${reason}) must leave the router for standard Kimi K3`);
  }
  same(
    resolveTeachingModelRoute({ FIREWORKS_TEACHING_RETRY_MODEL: " retry-model " }, { fastMode: true, startupRetry: "first_content_timeout" }).model,
    "retry-model",
    "FIREWORKS_TEACHING_RETRY_MODEL must override the retry deployment",
  );
  same(
    resolveTeachingModelRoute({ FIREWORKS_TEACHING_RETRY_MODEL: DEFAULT_TEACHING_FAST_MODEL }, { fastMode: true, startupRetry: "first_content_timeout" }),
    { model: DEFAULT_TEACHING_FAST_MODEL, alternate: null, fallbackReason: null },
    "a retry deployment equal to the router is no fallback",
  );
  same(
    resolveTeachingModelRoute({ FIREWORKS_TEACHING_MODEL: "standard-model" }, { fastMode: false, startupRetry: "first_content_timeout" }),
    { model: "standard-model", alternate: null, fallbackReason: null },
    "with Fast mode off the retry keeps the standard deployment the student chose",
  );
  same(resolveTeachingModelRoute({}, {}), { model: DEFAULT_TEACHING_MODEL, alternate: null, fallbackReason: null },
    "an unlabelled call stays on the standard model with no alternate");
  same(
    [0, 1, 2].map((attempt) => teachingAttemptModel(first, attempt, 3)),
    [DEFAULT_TEACHING_FAST_MODEL, DEFAULT_TEACHING_FAST_MODEL, DEFAULT_TEACHING_MODEL],
    "only the last network retry moves to the alternate deployment",
  );
  same(
    [0, 1, 2].map((attempt) => teachingAttemptModel(resolveTeachingModelRoute({}, { fastMode: true, startupRetry: "reasoning_only" }), attempt, 3)),
    [DEFAULT_TEACHING_MODEL, DEFAULT_TEACHING_MODEL, DEFAULT_TEACHING_MODEL],
    "a startup retry never goes back to the router that stalled",
  );
  same(teachingAttemptModel(first, 0, 1), DEFAULT_TEACHING_FAST_MODEL, "a single attempt is never a fallback");
  const status = (code: number) => new Response(null, { status: code });
  same(classifyTeachingFailure(null), "upstream_connect_failure", "no response is a connection failure");
  same(classifyTeachingFailure(status(503)), "upstream_5xx", "a provider 5xx is named apart");
  same(classifyTeachingFailure(status(429)), "upstream_rate_limited", "a 429 is named apart");
  same(classifyTeachingFailure(status(400)), null, "a 4xx would fail the same way anywhere");
  same(classifyTeachingFailure(status(200)), null, "a stream that started is never retried");
  const standardOnly = resolveTeachingModelRoute({}, { fastMode: true, startupRetry: "first_content_timeout" });
  same([0, 1, 2].map((attempt) => nextTeachingAttempt(first, attempt, 3, "upstream_5xx")), [1, 2, null],
    "5xx and connection failures retry in order until the last attempt");
  same([0, 1].map((attempt) => nextTeachingAttempt(first, attempt, 3, "upstream_rate_limited")), [2, 2],
    "a 429 moves straight to the alternate deployment");
  same(nextTeachingAttempt(standardOnly, 0, 3, "upstream_rate_limited"), null, "with no alternate a 429 is not retried");
  same(nextTeachingAttempt(standardOnly, 0, 3, "upstream_connect_failure"), 1, "a connection failure still retries without an alternate");
  same(nextTeachingAttempt(first, 0, 3, null), null, "a usable or 4xx response ends the loop");
  assert(!teachingAttemptMayHaveGenerated(status(503)) && !teachingAttemptMayHaveGenerated(status(429)),
    "an error status ran no generation and is free");
  assert(teachingAttemptMayHaveGenerated(null), "a thrown or aborted attempt keeps its bound");
  assert(TEACHING_STARTUP_RETRY_HEADER === CLIENT_STARTUP_RETRY_HEADER, "client and server must agree on the startup retry header");
  same(readTeachingStartupRetry(new Headers({ "x-heytutor-reasoning-retry": "1" })), null,
    "the reasoning-off header alone (a hedge) is not a startup retry");
  same(readTeachingStartupRetry(new Headers({ [TEACHING_STARTUP_RETRY_HEADER]: "1" })), null, "only a named reason counts");
  same(readTeachingStartupRetry(new Headers({ [TEACHING_STARTUP_RETRY_HEADER]: "first_content_timeout" })), "first_content_timeout",
    "the startup retry reason must be read");
}

async function verifyTimeout(): Promise<void> {
  let timeoutObserved = false;
  let timeoutRejected = false;
  try {
    await fetchTeachingCompletion({
      url: "https://teacher.test",
      timeoutMs: 5,
      init: { method: "POST" },
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          timeoutObserved = true;
          reject(init.signal?.reason);
        }, { once: true });
      }),
    });
  } catch {
    timeoutRejected = true;
  }
  assert(timeoutObserved && timeoutRejected, "a stalled teaching connection must respect its deadline");
}


// A reasoning-only response is retried once, and the retry must speak: it
// runs with thinking off whatever the classifier would pick. Two chemistry
// lessons came back empty because the retry reasoned again.
assert(
  resolveTeachingReasoningEffort({
    question: "Use molecular orbital theory to find the bond order of O2- and state whether it is paramagnetic.",
    hasAuthoritativePlan: false,
    mode: "medium",
    afterReasoningOnly: true,
  }) === "none",
  "the retry after a reasoning-only response must run with thinking off",
);
{
  const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");
  const anchors: Array<[string, string, string]> = [
    ["../../features/tutor-session/hooks/turn/useQuestionHandler.ts", "noReasoning: reasoningOnlyRetry", "the live hook must ask for no thinking on the reasoning-only retry"],
    ["../lecture-lab/lecturePipeline.ts", "noReasoning: reasoningOnlyRetry", "the lecture lab must mirror the live retry"],
    ["../../features/tutor-session/hooks/turn/useQuestionHandler.ts", "startupRetry: reasoningOnlyRetry && !resumeInkRetry ? startupRetryReason : undefined", "the live hook must name its startup retry"],
    ["../../features/tutor-session/hooks/turn/useQuestionHandler.ts", "startupRetryReason = continueCount === 0 && !resume && !resumeInkRetry ? retryReason : undefined", "only the retry of the first request is a startup retry"],
    ["../lecture-lab/lecturePipeline.ts", "startupRetry: reasoningOnlyRetry ? startupRetry : undefined", "the lecture lab must mirror the live startup retry"],
    ["../lecture-lab/lecturePipeline.ts", 'streamResult.streamStats?.firstContentTimedOut ? "first_content_timeout" : "reasoning_only"', "the lecture lab must send the real startup retry reason"],
    ["../../app/api/chat/route.ts", "readTeachingStartupRetry(request.headers)", "the chat route must route the startup retry"],
    ["../../app/api/chat/route.ts", 'afterReasoningOnly: request.headers.get("x-heytutor-reasoning-retry") === "1"', "the chat route must honour the retry header"],
    ["../../../../packages/tutor-core/src/llm/llmAPI.ts", 'headers["x-heytutor-reasoning-retry"] = "1"', "the stream client must send the retry header"],
  ];
  for (const [file, anchor, message] of anchors) {
    assert(read(file).includes(anchor), `${message}; repoint this gate at the control that replaced it`);
  }
}

void verifyTimeout().then(() => {
  console.log("teaching transport verification passed");
});
