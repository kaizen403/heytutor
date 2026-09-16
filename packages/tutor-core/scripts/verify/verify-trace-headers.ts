import { planTurnV3 } from "../../src/planners/turnPlannerV3";
import {
  HEYTUTOR_QUESTION_HEADER,
  HEYTUTOR_SESSION_ID_HEADER,
  HEYTUTOR_TRACE_ID_HEADER,
  readQuestionHeader,
  readTraceIdHeader,
  withTurnTraceHeaders,
} from "../../src/llm/traceHeaders";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const encoded = withTurnTraceHeaders(
  { "content-type": "application/json" },
  {
    traceId: "turn-abc-123",
    sessionId: "board-1",
    question: "A 5 kg block on a 37° incline with μ = 0.4",
  },
);
assert(encoded[HEYTUTOR_TRACE_ID_HEADER] === "turn-abc-123", "trace id header missing");
assert(encoded[HEYTUTOR_SESSION_ID_HEADER] === "board-1", "session header missing");
assert(
  readQuestionHeader(encoded[HEYTUTOR_QUESTION_HEADER]) ===
    "A 5 kg block on a 37° incline with μ = 0.4",
  "question header did not round-trip unicode",
);
assert(readTraceIdHeader("not a id!") === undefined, "whitespace/junk trace ids must be rejected");
assert(readTraceIdHeader("ok-id_1") === "ok-id_1", "plain trace ids must be accepted");
assert(
  withTurnTraceHeaders({}, {})[HEYTUTOR_TRACE_ID_HEADER] === undefined,
  "absent options must not invent headers",
);

const originalFetch = globalThis.fetch;
const captured = new Headers();
globalThis.fetch = async (_input, init) => {
  const headers = new Headers(init?.headers);
  for (const [key, value] of headers.entries()) captured.set(key, value);
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      schemaVersion: "turn-plan/v3",
      question: "Draw the circuit.",
      givens: [],
      unknowns: [],
      derived: [],
      qualitativeClaims: [],
      lawIds: [],
      assumptions: [],
      visualRequirement: "required",
    }) } }],
  }), { status: 200, headers: { "x-heytutor-trace-id": "server-ignored" } });
};

try {
  await planTurnV3("Draw the circuit.", {
    proxyUrl: "http://planner.test",
    timeoutMs: 1000,
    sessionId: "board-9",
    traceId: "client-turn-id",
  });
} finally {
  globalThis.fetch = originalFetch;
}

assert(captured.get(HEYTUTOR_TRACE_ID_HEADER) === "client-turn-id", "turn planner did not send the client turn id");
assert(captured.get(HEYTUTOR_SESSION_ID_HEADER) === "board-9", "turn planner dropped the session id");
assert(
  readQuestionHeader(captured.get(HEYTUTOR_QUESTION_HEADER)) === "Draw the circuit.",
  "turn planner did not send the student question",
);

console.log("trace headers verification passed");
