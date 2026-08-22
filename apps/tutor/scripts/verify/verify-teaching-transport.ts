import {
  DEFAULT_TEACHING_MODEL,
  fetchTeachingCompletion,
  resolveTeachingModel,
  resolveTeachingReasoningEffort,
} from "../../lib/llm/teachingTransport";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  resolveTeachingModel({}) === DEFAULT_TEACHING_MODEL,
  "teaching should default to standard DeepSeek V4 Flash",
);
assert(
  resolveTeachingModel({ FIREWORKS_MODEL: "only-this-model" }) === "only-this-model",
  "FIREWORKS_MODEL must be the only teaching model",
);
assert(
  resolveTeachingModel(
    { FIREWORKS_MODEL: "standard-model", FIREWORKS_FAST_MODEL: "fast-model" },
    { fastMode: true },
  ) === "fast-model",
  "fast mode teaching must use FIREWORKS_FAST_MODEL when set",
);
assert(
  resolveTeachingModel(
    { FIREWORKS_MODEL: "standard-model", FIREWORKS_FAST_MODEL: "fast-model" },
    { fastMode: false },
  ) === "standard-model",
  "turning fast mode off must keep teaching on FIREWORKS_MODEL",
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

void verifyTimeout().then(() => {
  console.log("teaching transport verification passed");
});
