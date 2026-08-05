import { HttpSolverProvider } from "../src/remoteSolver";
import { LocalDeterministicSolverProvider, solveWithDeadline } from "../src/solver";
import type { ProblemIR } from "../src/problemIR";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const question = "Find the value of 2 + 3.";
const problem: ProblemIR = {
  schemaVersion: "problem-ir/v1",
  id: "remote_solver_case",
  question,
  facts: [{
    id: "fact_question",
    kind: "requested",
    statement: question,
    evidence: { source: "question", start: 0, end: question.length, quote: question },
  }],
  entities: [],
  expressions: [{
    id: "sum",
    valueType: "scalar",
    root: {
      kind: "binary",
      operator: "+",
      left: { kind: "number", value: 2 },
      right: { kind: "number", value: 3 },
    },
    evidenceFactIds: ["fact_question"],
  }],
  constraints: [],
  representationIntents: [],
  solveRequests: [{ id: "evaluate_sum", kind: "evaluate", expressionId: "sum" }],
};

const local = await new LocalDeterministicSolverProvider().solve(problem);
const accepted = new HttpSolverProvider({
  endpoint: "http://127.0.0.1:8801/solve",
  expectedProviderId: "local-deterministic/v1",
  fetchImpl: async (_input, init) => {
    assert(init?.redirect === "error", "the solver transport must reject redirects");
    return new Response(JSON.stringify(local), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
const acceptedResult = await accepted.solve(problem);
assert(acceptedResult.status === "solved", "a valid pinned provider response must be accepted");
assert(acceptedResult.values[0]?.approximate === 5, "accepted remote result must retain its verified value");

const wrongProvider = new HttpSolverProvider({
  endpoint: "https://solver.example.test/solve",
  expectedProviderId: "sympy-pinned/v1",
  fetchImpl: async () => new Response(JSON.stringify(local), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
});
assert((await wrongProvider.solve(problem)).issues[0]?.code === "solver_provider_mismatch", "provider identity mismatch must fail closed");

const oversized = new HttpSolverProvider({
  endpoint: "http://localhost:8801/solve",
  expectedProviderId: "local-deterministic/v1",
  maxResponseBytes: 1_024,
  fetchImpl: async () => new Response("x".repeat(2_000), {
    status: 200,
    headers: { "content-type": "application/json", "content-length": "2000" },
  }),
});
assert((await oversized.solve(problem)).issues[0]?.code === "solver_response_too_large", "oversized solver response must fail closed");

const oversizedChunked = new HttpSolverProvider({
  endpoint: "http://localhost:8801/solve",
  expectedProviderId: "local-deterministic/v1",
  maxResponseBytes: 1_024,
  fetchImpl: async () => new Response("x".repeat(2_000), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
});
assert(
  (await oversizedChunked.solve(problem)).issues[0]?.code === "solver_response_too_large",
  "a chunked response without content-length must be stopped at the byte limit",
);

const invalidProof = structuredClone(local);
invalidProof.proofs[0]!.verified = false;
const unverified = new HttpSolverProvider({
  endpoint: "http://127.0.0.1:8801/solve",
  expectedProviderId: "local-deterministic/v1",
  fetchImpl: async () => new Response(JSON.stringify(invalidProof), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
});
assert((await unverified.solve(problem)).issues[0]?.code === "solver_invalid_result", "unverified proof must never cross the provider boundary");

const forgedValue = structuredClone(local);
forgedValue.values[0]!.approximate = 999;
forgedValue.values[0]!.exact = { kind: "integer", value: "999" };
const selfAttested = new HttpSolverProvider({
  endpoint: "http://127.0.0.1:8801/solve",
  expectedProviderId: "local-deterministic/v1",
  fetchImpl: async () => new Response(JSON.stringify(forgedValue), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
});
assert(
  (await selfAttested.solve(problem)).issues[0]?.code === "solver_independent_verification_failed",
  "a self-attested but mathematically wrong result must fail independent verification",
);

let insecureRejected = false;
try {
  new HttpSolverProvider({ endpoint: "http://solver.example.test/solve", expectedProviderId: "unsafe/v1" });
} catch {
  insecureRejected = true;
}
assert(insecureRejected, "non-loopback plaintext solver endpoint must be rejected");

let transportObservedAbort = false;
const cancellable = new HttpSolverProvider({
  endpoint: "http://127.0.0.1:8801/solve",
  expectedProviderId: "local-deterministic/v1",
  timeoutMs: 10_000,
  fetchImpl: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      transportObservedAbort = true;
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  }),
});
const cancelled = await solveWithDeadline(cancellable, problem, 10);
assert(cancelled.status === "failed", "deadline cancellation must fail the remote solve");
await new Promise((resolve) => setTimeout(resolve, 0));
assert(transportObservedAbort, "outer solver deadline must abort the underlying HTTP request");

console.log("verify-remote-solver: ok");
