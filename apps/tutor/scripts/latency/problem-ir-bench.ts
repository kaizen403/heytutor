/**
 * ProblemIR latency and outcome bench.
 *
 * For each question it plans the turn once (cached on disk so later rounds
 * reuse the same plans), then runs `planAndSolveProblemV1` N times exactly as
 * the client does. A fetch hook records what the client cannot see: wall time,
 * finish_reason, token usage and the raw JSON. The raw JSON is then replayed
 * through parse, normalize, validate, solve and audit so a null authority can
 * be traced to the stage that dropped it.
 *
 *   tsx scripts/latency/problem-ir-bench.ts --origin http://localhost:3101 \
 *     --questions ../../tmp/latency-set.txt --runs 2 --label before
 *
 * `--direct` sends the same request straight to Fireworks with the body the
 * server would build (thinking off, json_object, server max_tokens), so models
 * and temperatures can be compared without touching the server. It needs
 * FIREWORKS_API_KEY in the environment (use node --env-file).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LocalDeterministicSolverProvider,
  reconcileTurnPlanWithSolver,
  solveWithDeadline,
  validateProblemIR,
  validateSolverResult,
  verifyTurnPlanAgainstSolver,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  bindProblemIRToTurnPlan,
  normalizeProblemIRModelOutput,
  planAndSolveProblemV1,
  withdrawDisagreeingBindings,
} from "../../../../packages/tutor-core/src/planners/problemPlannerV1";
import { planTurnV3 } from "../../../../packages/tutor-core/src/planners/turnPlannerV3";
import { applyLectureLabHeaders } from "../lecture-lab/labAuth";

const CLIENT_DEADLINE_MS = 18_000;
const FIREWORKS_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

interface Options {
  origin: string;
  questions: string;
  runs: number;
  label: string;
  plans: string;
  direct: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
  noPlan: boolean;
  timeoutMs: number;
  only: number[] | null;
}

function parseOptions(argv: string[]): Options {
  const value = (flag: string, fallback: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1]! : fallback;
  };
  const only = value("--only", "");
  return {
    origin: value("--origin", "http://localhost:3101"),
    questions: value("--questions", "../../tmp/latency-set.txt"),
    runs: Number.parseInt(value("--runs", "2"), 10),
    label: value("--label", "bench"),
    plans: value("--plans", "../../tmp/pir-bench/turn-plans.json"),
    direct: argv.includes("--direct"),
    model: value("--model", "accounts/fireworks/models/deepseek-v4p1-flash"),
    temperature: Number.parseFloat(value("--temperature", "0.3")),
    maxTokens: Number.parseInt(value("--max-tokens", "3600"), 10),
    noPlan: argv.includes("--no-plan"),
    timeoutMs: Number.parseInt(value("--timeout-ms", "45000"), 10),
    only: only ? only.split(",").map((entry) => Number.parseInt(entry, 10)) : null,
  };
}

interface RawCapture {
  status: number;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  content: string;
  model: string | null;
  upstreamMs: number;
}

interface RunRecord {
  questionIndex: number;
  run: number;
  wallMs: number;
  clientTimeout: boolean;
  aborted: boolean;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  tokensPerSecond: number | null;
  outputChars: number;
  model: string | null;
  stage: string;
  issueCodes: string[];
  solveRequests: number;
  boundRequests: number;
  clientResult: "null" | "verified" | "not_applicable" | "incomplete" | "contradiction";
  clientResultAt18s: string;
  auditIssueCodes: string[];
}

function loadQuestions(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function installServerFetch(origin: string, cookie: string): void {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(origin)) {
      const headers = new Headers(init?.headers ?? {});
      headers.set("cookie", cookie);
      applyLectureLabHeaders(headers);
      return nativeFetch(input, { ...init, headers });
    }
    return nativeFetch(input, init);
  }) as typeof fetch;
}

/** Wrap the fetch the planner uses so the raw provider payload is visible. */
function capturingFetch(options: Options, sink: { capture: RawCapture | null }): typeof fetch {
  return async (input, init) => {
    const startedAt = Date.now();
    let response: Response;
    if (options.direct) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      // Mirror handlePlannerRequest + plannerTransport for the ProblemIR lane.
      const upstream = {
        messages: body.messages,
        n: 1,
        temperature: options.temperature,
        thinking: { type: "disabled" },
        max_tokens: options.maxTokens,
        stream: false,
        response_format: { type: "json_object" },
        model: options.model,
      };
      response = await fetch(FIREWORKS_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.FIREWORKS_API_KEY ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(upstream),
        signal: init?.signal,
      });
    } else {
      response = await fetch(input, init);
    }
    const text = await response.text();
    let payload: {
      model?: string;
      choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } = {};
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
    const content = payload.choices?.[0]?.message?.content;
    sink.capture = {
      status: response.status,
      finishReason: payload.choices?.[0]?.finish_reason ?? null,
      promptTokens: payload.usage?.prompt_tokens ?? null,
      completionTokens: payload.usage?.completion_tokens ?? null,
      content: typeof content === "string" ? content : "",
      model: response.headers.get("x-heytutor-planner-model") ?? payload.model ?? null,
      upstreamMs: Date.now() - startedAt,
    };
    return new Response(text, { status: response.status, headers: response.headers });
  };
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Replay the planner's post-processing to name the stage that dropped a result. */
async function diagnose(
  content: string,
  question: string,
  turnPlan: TurnPlanV3 | null,
): Promise<{ stage: string; issueCodes: string[]; solveRequests: number; boundRequests: number }> {
  if (!content) return { stage: "no_content", issueCodes: [], solveRequests: 0, boundRequests: 0 };
  const parsed = parseJsonObject(content);
  if (!parsed) return { stage: "invalid_json", issueCodes: [], solveRequests: 0, boundRequests: 0 };
  const rawRequests = Array.isArray((parsed as { solveRequests?: unknown[] }).solveRequests)
    ? (parsed as { solveRequests: unknown[] }).solveRequests.length
    : 0;
  const normalized = normalizeProblemIRModelOutput(parsed, question, turnPlan) as {
    solveRequests?: Array<{ resultBinding?: unknown }>;
  };
  const kept = normalized.solveRequests?.length ?? 0;
  const bound = normalized.solveRequests?.filter((request) => request.resultBinding).length ?? 0;
  const issueCodes: string[] = [];
  if (kept < rawRequests) issueCodes.push(`normalize_dropped_requests:${rawRequests - kept}`);
  const validation = validateProblemIR(normalized, question);
  if (!validation.problem) {
    return {
      stage: "validation_rejected",
      issueCodes: [...issueCodes, ...validation.issues.map((issue) => `${issue.code}@${issue.path}`)],
      solveRequests: kept,
      boundRequests: bound,
    };
  }
  const solved = await solveWithDeadline(new LocalDeterministicSolverProvider(), validation.problem, 5_000);
  const solverValidation = validateSolverResult(solved, validation.problem);
  if (!solverValidation.result || solverValidation.result.status !== "solved") {
    return {
      stage: `solver_${solved.status}`,
      issueCodes: [...issueCodes, ...solved.issues.map((issue) => `${issue.code}:${issue.message.slice(0, 60)}`)],
      solveRequests: kept,
      boundRequests: bound,
    };
  }
  if (!turnPlan) return { stage: "solved", issueCodes, solveRequests: kept, boundRequests: bound };
  const audit = verifyTurnPlanAgainstSolver(validation.problem, solverValidation.result, turnPlan, question);
  return {
    stage: `audit_${audit.status}`,
    issueCodes: [...issueCodes, ...audit.issues.map((issue) => `${issue.code}:${issue.quantityId ?? ""}`)],
    solveRequests: kept,
    boundRequests: bound,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const questions = loadQuestions(resolve(options.questions));
  const outDir = resolve("../../tmp/pir-bench");
  mkdirSync(outDir, { recursive: true });

  const landing = await fetch(`${options.origin}/`, { redirect: "manual" });
  const cookie = (landing.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
  installServerFetch(options.origin, cookie);
  const plannerUrl = `${options.origin}/api/chat`;

  const plansPath = resolve(options.plans);
  const plans: Record<string, { turnPlan: TurnPlanV3 | null; elapsedMs: number }> = existsSync(plansPath)
    ? JSON.parse(readFileSync(plansPath, "utf8"))
    : {};
  for (const question of questions) {
    if (plans[question]) continue;
    const startedAt = Date.now();
    const planned = await planTurnV3(question, { proxyUrl: plannerUrl, timeoutMs: 20_000, fastMode: true });
    plans[question] = { turnPlan: planned?.turnPlan ?? null, elapsedMs: Date.now() - startedAt };
    console.log(`turn plan ${plans[question]!.elapsedMs}ms ${planned ? "ok" : "null"}: ${question.slice(0, 60)}`);
    writeFileSync(plansPath, JSON.stringify(plans, null, 2));
  }

  const records: RunRecord[] = [];
  const raws: Array<{ questionIndex: number; run: number; content: string }> = [];
  for (let run = 0; run < options.runs; run += 1) {
    for (const [questionIndex, question] of questions.entries()) {
      if (options.only && !options.only.includes(questionIndex)) continue;
      const turnPlan = plans[question]?.turnPlan ?? null;
      if (!turnPlan && !options.noPlan) {
        console.log(`skip q${questionIndex}: no turn plan`);
        continue;
      }
      const sink: { capture: RawCapture | null } = { capture: null };
      const startedAt = Date.now();
      const result = await planAndSolveProblemV1(
        question,
        options.noPlan ? null : turnPlan,
        {
          proxyUrl: plannerUrl,
          timeoutMs: options.timeoutMs,
          fastMode: true,
          fetchImpl: capturingFetch(options, sink),
        },
      );
      const wallMs = Date.now() - startedAt;
      const capture = sink.capture as RawCapture | null;
      const content = capture?.content ?? "";
      const diagnosis = await diagnose(content, question, options.noPlan ? null : turnPlan);
      // A question-alone ProblemIR is audited against the plan afterwards, the
      // same way an integration step would once both have landed.
      // Mirror useQuestionHandler: reconcile rounding in the plan's bound
      // scalars, then audit. Question-alone results are bound to the plan first.
      let clientResult: RunRecord["clientResult"] = "null";
      let auditIssueCodes: string[] = [];
      if (result && turnPlan) {
        const problem = options.noPlan
          ? withdrawDisagreeingBindings(bindProblemIRToTurnPlan(result.problemIR, turnPlan), result.solverResult, turnPlan)
          : result.problemIR;
        const reconciled = reconcileTurnPlanWithSolver(turnPlan, problem, result.solverResult);
        const audit = verifyTurnPlanAgainstSolver(problem, result.solverResult, reconciled, question);
        clientResult = audit.status;
        auditIssueCodes = audit.issues.map((issue) => `${issue.code}:${issue.quantityId ?? ""}`);
      }
      const clientTimeout = wallMs >= CLIENT_DEADLINE_MS;
      const record: RunRecord = {
        questionIndex,
        run,
        wallMs,
        clientTimeout,
        aborted: !capture,
        finishReason: capture?.finishReason ?? null,
        promptTokens: capture?.promptTokens ?? null,
        completionTokens: capture?.completionTokens ?? null,
        tokensPerSecond: capture?.completionTokens && capture.upstreamMs
          ? Math.round((capture.completionTokens / capture.upstreamMs) * 1000)
          : null,
        outputChars: content.length,
        model: capture?.model ?? null,
        stage: diagnosis.stage,
        issueCodes: diagnosis.issueCodes.slice(0, 12),
        solveRequests: diagnosis.solveRequests,
        boundRequests: diagnosis.boundRequests,
        clientResult,
        clientResultAt18s: clientTimeout ? "timeout" : clientResult,
        auditIssueCodes: auditIssueCodes.slice(0, 8),
      };
      records.push(record);
      raws.push({ questionIndex, run, content });
      console.log(
        `q${questionIndex} r${run} ${wallMs}ms ${clientTimeout ? "TIMEOUT@18s " : ""}` +
        `finish=${record.finishReason} in=${record.promptTokens} out=${record.completionTokens} ` +
        `${record.tokensPerSecond}tok/s chars=${record.outputChars} stage=${record.stage} ` +
        `req=${record.solveRequests}/${record.boundRequests} result=${clientResult} ` +
        `${[...record.issueCodes, ...record.auditIssueCodes].slice(0, 5).join(" ")}`,
      );
    }
  }

  const walls = records.map((record) => record.wallMs);
  const outcomes: Record<string, number> = {};
  for (const record of records) outcomes[record.clientResultAt18s] = (outcomes[record.clientResultAt18s] ?? 0) + 1;
  const summary = {
    label: options.label,
    direct: options.direct,
    model: options.direct ? options.model : records[0]?.model,
    temperature: options.direct ? options.temperature : "server",
    noPlan: options.noPlan,
    calls: records.length,
    p50WallMs: percentile(walls, 50),
    p90WallMs: percentile(walls, 90),
    timeoutsAt18s: records.filter((record) => record.clientTimeout).length,
    p50CompletionTokens: percentile(records.flatMap((record) => record.completionTokens ?? []), 50),
    p50TokensPerSecond: percentile(records.flatMap((record) => record.tokensPerSecond ?? []), 50),
    truncated: records.filter((record) => record.finishReason === "length").length,
    outcomesAt18s: outcomes,
  };
  console.log(JSON.stringify(summary, null, 2));
  writeFileSync(`${outDir}/${options.label}.json`, JSON.stringify({ summary, records, raws }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
