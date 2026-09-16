import { readFileSync } from "node:fs";
import {
  CODE_LESSON_TEACHING_MAX_TOKENS,
  DEFAULT_TEACHING_FAST_MODEL,
  DEFAULT_TEACHING_MAX_TOKENS,
  DEFAULT_TEACHING_MODEL,
  TEACHING_TOKEN_CEILING,
  fetchTeachingCompletion,
  resolveTeachingContentBudget,
  resolveTeachingModel,
  resolveTeachingReasoningEffort,
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
