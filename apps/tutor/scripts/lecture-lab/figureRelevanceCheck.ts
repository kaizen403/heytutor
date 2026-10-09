/** Offline image-only relevance check for judged lecture-lab figures. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parseDiagramAnchors } from "./anchors";
import { readRoundJudgments, type DiagramVerdict } from "./judging";
import { resolveFireworksVisionModels } from "../../lib/llm/fireworksModels";
import { completionTokenCap, providerChatBody, resolveLlmEndpoint, type LlmEndpoint } from "../../lib/llm/llmProvider";
import { parseProviderUsage, usageDetailsFromParsed } from "../../lib/obs/providerUsage";
import { calculateLlmCostDetails, roundUsd, type UsageCounts } from "../../lib/obs/usageCost";

const MAX_OUTPUT_TOKENS = 80;
const MAX_IMAGE_INPUT_TOKENS = 64_000;

type ReferenceVerdict = Extract<DiagramVerdict, "right" | "partial" | "wrong">;
type FigureAnswer = "yes" | "no";

export interface FigureCheckCase {
  id: string;
  source: string;
  subject: string;
  question: string;
  imagePath: string;
  referenceVerdict: ReferenceVerdict;
}

/** Deterministic budget order: reference anchors, then balanced source/subject groups. */
export function scheduleFigureCheckCases<T extends { source: string; subject: string }>(cases: readonly T[]): T[] {
  const anchors = cases.filter((row) => row.source === "codex-reference-anchors");
  const groups = new Map<string, T[]>();
  for (const row of cases) {
    if (row.source === "codex-reference-anchors") continue;
    const key = `${row.source}|${row.subject}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const rest: T[] = [];
  const queues = [...groups.values()];
  for (let index = 0; queues.some((group) => index < group.length); index += 1) {
    for (const group of queues) {
      const row = group[index];
      if (row) rest.push(row);
    }
  }
  return [...anchors, ...rest];
}

export interface FigureCheckResult extends FigureCheckCase {
  answer: FigureAnswer;
  reason: string;
  model: string;
  latencyMs: number;
  usage: UsageCounts | null;
  costUsd: number;
}

interface FigureCheckFailure extends FigureCheckCase {
  error: string;
  chargedUsd: number;
}

interface CliOptions {
  rounds: Array<{ source: string; path: string }>;
  anchors: string | null;
  outDir: string;
  maxUsd: number;
  concurrency: number;
  yes: boolean;
}

interface SubjectScore {
  wrong: { total: number; blocked: number; share: number | null };
  good: { total: number; wronglyBlocked: number; share: number | null };
}

export interface FigureCheckSummary {
  model: string[];
  inputs: number;
  completed: number;
  failures: number;
  reference: string;
  overall: SubjectScore;
  bySubject: Record<string, SubjectScore>;
  bySource: Record<string, SubjectScore>;
  latencyMs: { p50: number | null; p90: number | null };
  cost: {
    maxUsd: number;
    totalUsd: number;
    perFigureUsd: number | null;
    stoppedForBudget: boolean;
  };
  misses: {
    wrongNotBlocked: FigureCheckResult[];
    goodWronglyBlocked: FigureCheckResult[];
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).map((line) => line.trim())
    .filter(Boolean).map((line) => JSON.parse(line) as T);
}

function writeJsonl(path: string, rows: readonly unknown[]): void {
  writeFileSync(path, rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "");
}

function words(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function parseFigureCheckAnswer(content: string): {
  answer: FigureAnswer;
  reason: string;
} {
  const unwrapped = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = unwrapped.indexOf("{");
  const end = unwrapped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("vision response is not JSON");
  const value = record(JSON.parse(unwrapped.slice(start, end + 1)));
  const answer = typeof value.answer === "string" ? value.answer.trim().toLowerCase() : "";
  if (answer !== "yes" && answer !== "no") throw new Error("vision answer must be yes or no");
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (!reason) throw new Error("vision reason is missing");
  if (words(reason) > 12) throw new Error("vision reason must be at most 12 words");
  return { answer, reason };
}

/** Admission accounting includes outstanding requests so concurrency cannot cross the cap. */
export class VisionSpendCap {
  private chargedUsd = 0;
  private reservedUsd = 0;
  private stoppedForBudget = false;
  private unknownUsageCalls = 0;

  constructor(readonly maxUsd: number) {
    if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("--max-usd must be a positive number");
  }

  tryReserve(usd: number): boolean {
    if (!Number.isFinite(usd) || usd <= 0) throw new Error("reservation must be positive");
    if (this.chargedUsd + this.reservedUsd + usd > this.maxUsd) return false;
    this.reservedUsd += usd;
    return true;
  }

  settle(reservedUsd: number, actualUsd: number | null): void {
    this.reservedUsd = Math.max(0, this.reservedUsd - reservedUsd);
    if (actualUsd === null) this.unknownUsageCalls += 1;
    this.chargedUsd += actualUsd ?? reservedUsd;
  }

  restoreCharge(usd: number): void {
    if (!Number.isFinite(usd) || usd < 0) throw new Error("restored charge must be non-negative");
    this.chargedUsd += usd;
  }

  hasInflight(): boolean {
    return this.reservedUsd > 0;
  }

  markStoppedForBudget(): void {
    this.stoppedForBudget = true;
  }

  snapshot(): {
    maxUsd: number;
    chargedUsd: number;
    reservedUsd: number;
    stoppedForBudget: boolean;
    unknownUsageCalls: number;
  } {
    return {
      maxUsd: this.maxUsd,
      chargedUsd: roundUsd(this.chargedUsd),
      reservedUsd: roundUsd(this.reservedUsd),
      stoppedForBudget: this.stoppedForBudget,
      unknownUsageCalls: this.unknownUsageCalls,
    };
  }
}

function emptyScore(): SubjectScore {
  return {
    wrong: { total: 0, blocked: 0, share: null },
    good: { total: 0, wronglyBlocked: 0, share: null },
  };
}

function finishScore(score: SubjectScore): SubjectScore {
  score.wrong.share = score.wrong.total > 0 ? score.wrong.blocked / score.wrong.total : null;
  score.good.share = score.good.total > 0 ? score.good.wronglyBlocked / score.good.total : null;
  return score;
}

function addScore(score: SubjectScore, result: FigureCheckResult): void {
  if (result.referenceVerdict === "wrong") {
    score.wrong.total += 1;
    if (result.answer === "no") score.wrong.blocked += 1;
  } else {
    score.good.total += 1;
    if (result.answer === "no") score.good.wronglyBlocked += 1;
  }
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

export function buildFigureCheckSummary(
  results: readonly FigureCheckResult[],
  maxUsd: number,
  stoppedForBudget: boolean,
  failures = 0,
): FigureCheckSummary {
  const overall = emptyScore();
  const bySubject: Record<string, SubjectScore> = {};
  const bySource: Record<string, SubjectScore> = {};
  for (const result of results) {
    addScore(overall, result);
    const score = bySubject[result.subject] ??= emptyScore();
    addScore(score, result);
    addScore(bySource[result.source] ??= emptyScore(), result);
  }
  const totalUsd = roundUsd(results.reduce((sum, result) => sum + result.costUsd, 0));
  return {
    model: [...new Set(results.map((result) => result.model))].sort(),
    inputs: results.length + failures,
    completed: results.length,
    failures,
    reference: "Codex judgments plus Codex reference anchors; consistency measure, not human accuracy",
    overall: finishScore(overall),
    bySubject: Object.fromEntries(
      Object.entries(bySubject).sort(([left], [right]) => left.localeCompare(right))
        .map(([subject, score]) => [subject, finishScore(score)]),
    ),
    bySource: Object.fromEntries(Object.entries(bySource).map(([source, score]) => [source, finishScore(score)])),
    latencyMs: {
      p50: percentile(results.map((result) => result.latencyMs), 0.5),
      p90: percentile(results.map((result) => result.latencyMs), 0.9),
    },
    cost: {
      maxUsd,
      totalUsd,
      perFigureUsd: results.length > 0 ? roundUsd(totalUsd / results.length) : null,
      stoppedForBudget,
    },
    misses: {
      wrongNotBlocked: results.filter((result) => result.referenceVerdict === "wrong" && result.answer === "yes").slice(0, 10),
      goodWronglyBlocked: results.filter((result) => result.referenceVerdict !== "wrong" && result.answer === "no").slice(0, 10),
    },
  };
}

export function collectRoundFigureCases(
  roundDir: string,
  source: string,
): FigureCheckCase[] {
  const judgments = new Map(
    readRoundJudgments(roundDir)
      .filter((row): row is typeof row & { verdict: ReferenceVerdict } =>
        row.verdict === "right" || row.verdict === "partial" || row.verdict === "wrong")
      .map((row) => [row.id, row.verdict]),
  );
  const output: FigureCheckCase[] = [];
  for (const file of readdirSync(join(roundDir, "runs")).filter((name) => name.endsWith(".json")).sort()) {
    const run = record(JSON.parse(readFileSync(join(roundDir, "runs", file), "utf8")));
    const evaluation = record(run.evaluation);
    const diagram = record(run.diagram);
    const rowId = typeof evaluation.id === "string" ? evaluation.id : "";
    const referenceVerdict = judgments.get(rowId);
    if (!referenceVerdict || typeof diagram.png !== "string") continue;
    output.push({
      id: `${source}::${rowId}`,
      source,
      subject: typeof evaluation.subject === "string" ? evaluation.subject : rowId.split("|")[0] ?? "unknown",
      question: typeof evaluation.question === "string" ? evaluation.question : "",
      imagePath: resolve(roundDir, diagram.png),
      referenceVerdict,
    });
  }
  return output;
}

/** Anchor paths were authored relative to the repository's .context gallery. */
export function resolveAnchorFigurePath(figurePath: string, repoRoot: string): string {
  return resolve(repoRoot, ".context", figurePath);
}

export function collectAnchorFigureCases(anchorPath: string, repoRoot: string): FigureCheckCase[] {
  return parseDiagramAnchors(readFileSync(anchorPath, "utf8")).map((anchor) => ({
    id: `codex-reference-anchors::${anchor.id}`,
    source: "codex-reference-anchors",
    subject: anchor.subject,
    question: anchor.question,
    imagePath: resolveAnchorFigurePath(anchor.figurePath, repoRoot),
    referenceVerdict: anchor.verdict,
  }));
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    const item = record(part);
    return typeof item.text === "string" ? item.text : "";
  }).join("");
}

function imageMime(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function messagesFor(input: FigureCheckCase): unknown[] {
  return [
    {
      role: "system",
      content: "Judge only whether the educational figure correctly shows what the question is about. Return strict JSON: {\"answer\":\"yes|no\",\"reason\":\"at most 12 words\"}.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: input.question },
        {
          type: "image_url",
          image_url: {
            url: `data:${imageMime(input.imagePath)};base64,${readFileSync(input.imagePath).toString("base64")}`,
          },
        },
      ],
    },
  ];
}

function reservationUsd(question: string, models: readonly string[], endpoint: LlmEndpoint): number {
  const textTokensCeiling = new TextEncoder().encode(question).length + 2_048;
  const outputCap = completionTokenCap(providerChatBody({ max_tokens: MAX_OUTPUT_TOKENS, reasoning_effort: "none" }, endpoint));
  return Math.max(...models.map((model) =>
    calculateLlmCostDetails(
      { input: MAX_IMAGE_INPUT_TOKENS + textTokensCeiling, output: outputCap },
      { model },
    ).total ?? 0.01));
}

async function checkFigure(
  input: FigureCheckCase,
  endpoint: LlmEndpoint,
  models: readonly string[],
): Promise<Omit<FigureCheckResult, keyof FigureCheckCase> & { billedUsd: number | null }> {
  const messages = messagesFor(input);
  const startedAt = Date.now();
  let response: Response | null = null;
  let model = models[0]!;
  for (const [index, candidate] of models.entries()) {
    model = candidate;
    response = await fetch(endpoint.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${endpoint.apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify(providerChatBody({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        n: 1,
        temperature: 0,
        reasoning_effort: "none",
        stream: false,
        messages,
        response_format: { type: "json_object" },
      }, endpoint)),
    });
    if (response.status !== 404 || index === models.length - 1) break;
    await response.body?.cancel();
  }
  if (!response?.ok) {
    const status = response?.status ?? "no-response";
    await response?.body?.cancel();
    throw new Error(`vision upstream ${status} from ${model}`);
  }
  const raw = record(await response.json());
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const message = record(record(choices[0]).message);
  const parsed = parseFigureCheckAnswer(contentText(message.content));
  const providerUsage = parseProviderUsage(raw.usage);
  const usage = usageDetailsFromParsed(providerUsage) ?? null;
  const billedUsd = usage
    ? calculateLlmCostDetails(usage, { model }).total ?? null
    : null;
  return {
    ...parsed,
    model,
    latencyMs: Date.now() - startedAt,
    usage,
    costUsd: billedUsd ?? 0,
    billedUsd,
  };
}

function parseOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    rounds: [], anchors: null, outDir: "", maxUsd: Number.NaN, concurrency: 3, yes: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--round") {
      const value = argv[++index] ?? "";
      const separator = value.indexOf("=");
      if (separator <= 0) throw new Error("--round must be source=path");
      options.rounds.push({ source: value.slice(0, separator), path: value.slice(separator + 1) });
    } else if (arg === "--anchors") options.anchors = argv[++index] ?? null;
    else if (arg === "--out") options.outDir = argv[++index] ?? "";
    else if (arg === "--max-usd") options.maxUsd = Number.parseFloat(argv[++index] ?? "");
    else if (arg === "--concurrency") options.concurrency = Number.parseInt(argv[++index] ?? "", 10);
    else if (arg === "--yes") options.yes = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.rounds.length === 0) throw new Error("at least one --round source=path is required");
  if (!options.outDir) throw new Error("--out is required");
  if (!Number.isFinite(options.maxUsd) || options.maxUsd <= 0) throw new Error("--max-usd must be a positive number");
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("--concurrency must be positive");
  if (!options.yes) throw new Error("paid figure checks require --yes");
  return options;
}

async function main(): Promise<void> {
  process.loadEnvFile?.(resolve(process.cwd(), ".env.local"));
  const options = parseOptions(process.argv.slice(2));
  const endpoint = resolveLlmEndpoint();
  if (endpoint.provider !== "azure" || endpoint.fallbackReason || !endpoint.apiKey) {
    throw new Error("figure checks require a fully configured Azure provider; Fireworks calls are disabled");
  }
  const models = resolveFireworksVisionModels();
  const inputs = scheduleFigureCheckCases([
    ...options.rounds.flatMap((round) => collectRoundFigureCases(resolve(round.path), round.source)),
    ...(options.anchors ? collectAnchorFigureCases(resolve(options.anchors), resolve(process.cwd(), "../..")) : []),
  ]);
  for (const input of inputs) {
    if (!existsSync(input.imagePath)) throw new Error(`missing image: ${input.imagePath}`);
  }
  mkdirSync(resolve(options.outDir), { recursive: true });
  const cropDir = resolve(options.outDir, "check-crops");
  mkdirSync(cropDir, { recursive: true });
  for (const input of inputs) {
    const crop = join(cropDir, `${input.id.replace(/[^a-z0-9]+/gi, "_")}.png`);
    // Exclude the frame title, diagnostics, work area, and all rubric metadata.
    execFileSync("/usr/bin/sips", [
      "--cropToHeightWidth", "620", "760", "--cropOffset", "80", "400",
      input.imagePath, "--out", crop,
    ], { stdio: "ignore" });
    input.imagePath = crop;
  }
  const resultsPath = resolve(options.outDir, "results.jsonl");
  const failuresPath = resolve(options.outDir, "failures.jsonl");
  const prior = readJsonl<FigureCheckResult>(resultsPath);
  const priorFailures = readJsonl<FigureCheckFailure>(failuresPath);
  const done = new Set([...prior, ...priorFailures].map((row) => row.id));
  const pending = inputs.filter((row) => !done.has(row.id));
  const results = [...prior];
  const failures: FigureCheckFailure[] = [...priorFailures];
  const spend = new VisionSpendCap(options.maxUsd);
  spend.restoreCharge(prior.reduce((sum, result) => sum + result.costUsd, 0));
  spend.restoreCharge(priorFailures.reduce((sum, failure) => sum + failure.chargedUsd, 0));
  const ceiling = Math.max(...inputs.map((input) => reservationUsd(input.question, models, endpoint)));
  console.log(JSON.stringify({
    model: models,
    provider: endpoint.provider,
    deployment: endpoint.deployment,
    inputs: inputs.length,
    alreadyComplete: prior.length,
    pending: pending.length,
    maxUsd: options.maxUsd,
    perCallAdmissionCeilingUsd: ceiling,
  }, null, 2));

  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const input = pending[cursor];
      if (!input) return;
      const reservedUsd = reservationUsd(input.question, models, endpoint);
      if (!spend.tryReserve(reservedUsd)) {
        if (!spend.hasInflight()) spend.markStoppedForBudget();
        return;
      }
      cursor += 1;
      try {
        const checked = await checkFigure(input, endpoint, models);
        spend.settle(reservedUsd, checked.billedUsd);
        const result: FigureCheckResult = {
          ...input,
          ...checked,
          costUsd: checked.billedUsd ?? reservedUsd,
        };
        results.push(result);
        writeJsonl(resultsPath, results);
      } catch (error) {
        spend.settle(reservedUsd, null);
        failures.push({
          ...input,
          error: error instanceof Error ? error.message : String(error),
          chargedUsd: reservedUsd,
        });
        writeJsonl(failuresPath, failures);
      }
      const snapshot = spend.snapshot();
      if ((results.length + failures.length) % 25 === 0) {
        console.log(`figure-check ${results.length + failures.length}/${inputs.length}; $${snapshot.chargedUsd.toFixed(6)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: options.concurrency }, () => worker()));
  const snapshot = spend.snapshot();
  const summary = buildFigureCheckSummary(
    results,
    options.maxUsd,
    snapshot.stoppedForBudget,
    failures.length,
  );
  summary.cost.totalUsd = snapshot.chargedUsd;
  const paidCalls = results.length + failures.length;
  summary.cost.perFigureUsd = paidCalls > 0 ? roundUsd(snapshot.chargedUsd / paidCalls) : null;
  writeFileSync(resolve(options.outDir, "summary.json"), `${JSON.stringify({
    ...summary,
    provider: endpoint.provider,
    deployment: endpoint.deployment,
    plannedInputs: inputs.length,
    inputSources: [...new Set(inputs.map((input) => input.source))],
    admission: snapshot,
    cwd: process.cwd(),
    output: basename(dirname(resultsPath)),
  }, null, 2)}\n`);
  console.log(JSON.stringify({ completed: results.length, failures: failures.length, ...snapshot }, null, 2));
}

if (process.argv[1]?.endsWith("figureRelevanceCheck.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
