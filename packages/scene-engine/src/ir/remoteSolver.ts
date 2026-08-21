import { validateProblemIR } from "./problemIR";
import {
  LocalDeterministicSolverProvider,
  SOLVER_RESULT_VERSION,
  validateSolverResult,
  type SolverExecutionContext,
  type SolverProvider,
  type SolverResult,
} from "./solver";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;
const INDEPENDENT_COMPARISON_TOLERANCE = 1e-8;

export interface HttpSolverProviderOptions {
  endpoint: string;
  expectedProviderId: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Safe JSON boundary for a pinned external CAS/constraint service.
 * The service receives only validated ProblemIR ASTs and its response is not
 * authoritative until the same local SolverResult validator accepts it.
 */
export class HttpSolverProvider implements SolverProvider {
  readonly id: string;
  private readonly endpoint: URL;
  private readonly expectedProviderId: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpSolverProviderOptions) {
    this.endpoint = validatedEndpoint(options.endpoint);
    this.expectedProviderId = requiredIdentifier(options.expectedProviderId, "expectedProviderId");
    this.timeoutMs = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS, "timeoutMs");
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      1_024,
      10_000_000,
      "maxResponseBytes",
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.id = `http:${this.expectedProviderId}`;
  }

  async solve(raw: unknown, context?: SolverExecutionContext): Promise<SolverResult> {
    const problemValidation = validateProblemIR(raw);
    if (!problemValidation.problem) {
      return failedResult(
        isRecord(raw) && typeof raw.id === "string" ? raw.id : "invalid_problem",
        this.id,
        "invalid_problem",
        problemValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
      );
    }
    const problem = problemValidation.problem;
    if (context?.signal.aborted || (context && context.deadlineMs <= Date.now())) {
      return failedResult(problem.id, this.id, "solver_cancelled", "solver request was cancelled before transport");
    }
    const controller = new AbortController();
    const deadlineBudget = context ? context.deadlineMs - Date.now() : this.timeoutMs;
    const effectiveTimeoutMs = Math.max(1, Math.min(this.timeoutMs, deadlineBudget));
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, effectiveTimeoutMs);
    const onExternalAbort = () => controller.abort();
    context?.signal.addEventListener("abort", onExternalAbort, { once: true });
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-heytutor-problem-schema": problem.schemaVersion,
        },
        body: JSON.stringify(problem),
        signal: controller.signal,
      });
      if (!response.ok) {
        return failedResult(problem.id, this.id, "solver_http_error", `solver returned HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("application/json")) {
        return failedResult(problem.id, this.id, "solver_content_type", "solver response must be application/json");
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > this.maxResponseBytes) {
        return failedResult(problem.id, this.id, "solver_response_too_large", "solver response exceeded the configured byte limit");
      }
      const text = await readBoundedResponseText(response, this.maxResponseBytes);
      if (text === null) {
        return failedResult(problem.id, this.id, "solver_response_too_large", "solver response exceeded the configured byte limit");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return failedResult(problem.id, this.id, "solver_invalid_json", "solver response was not valid JSON");
      }
      const validated = validateSolverResult(parsed, problem);
      if (!validated.result) {
        return failedResult(
          problem.id,
          this.id,
          "solver_invalid_result",
          validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
        );
      }
      if (validated.result.providerId !== this.expectedProviderId) {
        return failedResult(problem.id, this.id, "solver_provider_mismatch", "solver result came from an unexpected provider");
      }
      const localResult = await new LocalDeterministicSolverProvider().solve(problem, context);
      const independentIssue = independentlyVerifyResult(validated.result, localResult);
      if (independentIssue) {
        return failedResult(problem.id, this.id, "solver_independent_verification_failed", independentIssue);
      }
      return {
        ...localResult,
        providerId: this.expectedProviderId,
      };
    } catch (error) {
      const externallyCancelled = context?.signal.aborted === true;
      return failedResult(
        problem.id,
        this.id,
        externallyCancelled ? "solver_cancelled" : timedOut ? "solver_timeout" : "solver_transport_error",
        externallyCancelled
          ? "solver request was cancelled"
          : timedOut
            ? `solver exceeded ${effectiveTimeoutMs} ms`
            : error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timeout);
      context?.signal.removeEventListener("abort", onExternalAbort);
    }
  }
}

function independentlyVerifyResult(remote: SolverResult, local: SolverResult): string | null {
  if (remote.status !== "solved" || local.status !== "solved") {
    return "both the remote result and independent local verification must solve every request";
  }
  const localValues = new Map(local.values.map((value) => [value.requestId, value]));
  if (remote.values.length !== local.values.length) return "remote and independent result cardinalities differ";
  for (const remoteValue of remote.values) {
    const localValue = localValues.get(remoteValue.requestId);
    if (!localValue || remoteValue.valueType !== localValue.valueType) {
      return `remote result shape differs for ${remoteValue.requestId}`;
    }
    if (!approximatelyEqual(remoteValue.approximate, localValue.approximate)) {
      return `remote value disagrees with independent verification for ${remoteValue.requestId}`;
    }
    if (localValue.exact !== undefined && JSON.stringify(remoteValue.exact) !== JSON.stringify(localValue.exact)) {
      return `remote exact value disagrees with independent verification for ${remoteValue.requestId}`;
    }
  }
  return null;
}

function approximatelyEqual(remote: number | number[], local: number | number[]): boolean {
  const remoteValues = Array.isArray(remote) ? remote : [remote];
  const localValues = Array.isArray(local) ? local : [local];
  if (remoteValues.length !== localValues.length) return false;
  return remoteValues.every((value, index) => {
    const expected = localValues[index]!;
    const tolerance = INDEPENDENT_COMPARISON_TOLERANCE * Math.max(1, Math.abs(expected));
    return Math.abs(value - expected) <= tolerance;
  });
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function validatedEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("solver endpoint must be an absolute URL");
  }
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error("solver endpoint cannot contain credentials or a fragment");
  }
  const local = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" || endpoint.hostname === "::1";
  if (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:")) {
    throw new Error("solver endpoint must use HTTPS, except for loopback development");
  }
  return endpoint;
}

function requiredIdentifier(value: string, name: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_./-]{0,127}$/.test(value)) throw new Error(`${name} must be a bounded provider identifier`);
  return value;
}

function boundedInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

function failedResult(
  problemId: string,
  providerId: string,
  code: string,
  message: string,
): SolverResult {
  return {
    schemaVersion: SOLVER_RESULT_VERSION,
    problemId,
    providerId,
    status: "failed",
    values: [],
    proofs: [],
    issues: [{ code, path: "$", message }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
