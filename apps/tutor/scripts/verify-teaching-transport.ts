import {
  DEFAULT_TEACHING_MODEL,
  fetchTeachingCompletion,
  resolveTeachingModel,
  resolveTeachingReasoningEffort,
} from "../lib/teachingTransport";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  resolveTeachingModel({}) === DEFAULT_TEACHING_MODEL,
  "teaching should default to the low-latency router",
);
assert(
  resolveTeachingModel({ FIREWORKS_TEACHING_MODEL: "teacher-model" }) === "teacher-model",
  "the dedicated teaching-model override was ignored",
);
assert(
  resolveTeachingModel({
    FIREWORKS_MODEL: "legacy-override",
  }) === "legacy-override",
  "the existing global model override must remain compatible",
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
