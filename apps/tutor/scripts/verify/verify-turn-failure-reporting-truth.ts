/**
 * Production 20 to 23 Oct: two lessons were reported as turn plan
 * transport errors when the student had stopped them 3 s after asking
 * (046ae5fb, f37e46bc), and 11 taught lessons whose optional figure had no
 * figure tools (missing_capability) raised a Sentry warning each. Neither is
 * a failure. In the stopped lessons the failed request was an orphan turn
 * plan retry cut off as the page tore down.
 */
import assert from "node:assert/strict";
import {
  buildFailedTurnSentryEvent,
  type FailedTurnInput,
} from "../../lib/obs/failedTurnTelemetry";
import { classifyTurnFailure } from "../../lib/obs/turnFailureClassification";

const taught = [
  { narration: "Synthetic teaching." },
  { narration: "More synthetic teaching." },
];
const clearOnly = [{ command: { type: "CLEAR" } }];
const env = {
  DIAGRAM_STRICT_SUBJECTS: "maths,physics",
  FIREWORKS_API_KEY: "test",
};

function turn(
  overrides: Partial<FailedTurnInput> & {
    need?: string;
    code?: string;
    stage?: string;
    failed?: boolean;
    reason?: string;
  },
): FailedTurnInput {
  const { need, code, stage, failed, reason, ...rest } = overrides;
  return {
    visualStatus: "text_only",
    status: "complete",
    segments: taught,
    sceneArtifacts: {
      ...(need ? { turnPlan: { visualRequirement: need } } : {}),
      ...(reason ? { degradation: { reason } } : {}),
      failureTelemetry: {
        subject: "other",
        ...(code ? { code } : {}),
        ...(stage ? { stage } : {}),
        ...(failed ? { failed: true } : {}),
      },
    },
    ...rest,
  };
}

function expect(
  name: string,
  input: FailedTurnInput,
  classification: string,
  reported: boolean,
): void {
  assert.equal(
    classifyTurnFailure(input).classification,
    classification,
    `${name}: classification`,
  );
  assert.equal(
    buildFailedTurnSentryEvent(input, env) !== null,
    reported,
    `${name}: Sentry ${reported ? "must" : "must not"} report`,
  );
}

// No figure tools, figure not needed, lesson taught: the text outcome.
expect(
  "optional figure, no tools, taught",
  turn({
    need: "optional",
    reason: "missing_capability",
    code: "missing_capability",
    stage: "scene_planner",
  }),
  "healthy",
  false,
);
expect(
  "no figure needed, no tools, taught",
  turn({ need: "none", reason: "missing_capability" }),
  "healthy",
  false,
);
// Still failures.
expect(
  "required figure, no tools, taught",
  turn({
    need: "required",
    reason: "missing_capability",
    code: "missing_capability",
    stage: "scene_planner",
  }),
  "failed",
  true,
);
expect(
  "optional figure, no tools, nothing taught",
  turn({ need: "optional", reason: "missing_capability", segments: clearOnly }),
  "failed",
  true,
);
expect(
  "optional figure, no tools, plan unknown",
  turn({ reason: "missing_capability" }),
  "failed",
  true,
);
expect(
  "optional figure, invalid candidate, taught",
  turn({ need: "optional", reason: "candidate_invalid" }),
  "failed",
  true,
);

// A stop before teaching is not a transport failure.
expect(
  "stopped at 3 s during the turn plan",
  turn({
    status: "stopped",
    segments: clearOnly,
    code: "transport_error",
    stage: "turn_plan",
  }),
  "unverified",
  false,
);
expect(
  "stopped with no rows",
  turn({
    status: "stopped",
    segments: [],
    code: "transport_error",
    stage: "scene_planner",
  }),
  "unverified",
  false,
);
// Still failures.
expect(
  "transport error, lesson completed with nothing taught",
  turn({
    status: "complete",
    segments: clearOnly,
    code: "transport_error",
    stage: "turn_plan",
  }),
  "failed",
  true,
);
expect(
  "transport error, stopped after teaching",
  turn({ status: "stopped", code: "transport_error", stage: "turn_plan" }),
  "failed",
  true,
);
expect(
  "explicit transport failure flag on a stop",
  turn({
    status: "stopped",
    segments: clearOnly,
    code: "transport_error",
    stage: "teaching",
    failed: true,
  }),
  "failed",
  true,
);
expect(
  "budget limit on a stop",
  turn({
    status: "stopped",
    segments: clearOnly,
    code: "budget_limit",
    stage: "teaching",
    failed: true,
  }),
  "failed",
  true,
);

// The stop drops only its transport error; confirmed figure failures beside it still report.
expect(
  "stop with a transport error and an invalid candidate",
  turn({ status: "stopped", segments: clearOnly, code: "transport_error", stage: "turn_plan", reason: "candidate_invalid" }),
  "failed",
  true,
);
expect(
  "stop with a transport error and a required figure that failed",
  { ...turn({ status: "stopped", segments: [], code: "transport_error", stage: "scene_planner", need: "required" }), visualStatus: "retry_required" },
  "failed",
  true,
);

console.log("turn failure reporting truth: 14 classification cases pass; no DB/network calls");
