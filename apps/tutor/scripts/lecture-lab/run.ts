/**
 * Lecture lab batch runner.
 *
 * Usage (dev server must be up, AUTH_DISABLED=1, LECTURE_LAB_TOKEN set on
 * both the server and this process):
 *   pnpm --filter @heytutor/tutor exec tsx scripts/lecture-lab/run.ts \
 *     --difficulty hard --per-unit 1 --concurrency 3 --out .lecture-lab/run-01
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { parseProbeFile, type ProbeQuestion } from "@/features/admin/lib/probes";
import { unitIdFromTopicId } from "@/features/admin/lib/probes";
import { gradeLecture, type LectureGrade } from "./grade";
import { printSummary, summarize } from "./summarize";
import { runLecture, type LectureRun } from "./lecturePipeline";
import { applyLectureLabHeaders } from "./labAuth";
import {
  LECTURE_LAB_STANDARD_MODEL_HEADER,
  LECTURE_LAB_ZERO_RETENTION_HEADER,
} from "../../lib/billing/flags";
import type { SubjectFamiliarity } from "@heytutor/tutor-core";
import {
  assertEvaluationCostAllowed,
  combineDiagramEvalRows,
  evaluationRunFastMode,
  estimateEvaluationCostUsd,
  parseDiagramEvalJsonl,
  PlannerUsageTracker,
  sampleDiagramEvalRows,
  summarizeDiagramFailures,
  type DiagramEvalArm,
  type DiagramEvalRow,
} from "./diagramEval";
import { writeRoundGallery } from "./gallery";

interface Options {
  difficulty: string;
  units: number[] | null;
  subjects: string[];
  perUnit: number | null;
  limit: number | null;
  concurrency: number;
  out: string;
  origin: string;
  familiarity: SubjectFamiliarity;
  narrationLanguage: "english" | "hinglish";
  only: string[] | null;
  seed: number;
  /**
   * A file of ad-hoc questions, one per line, replayed instead of the probe
   * bank. The bank is written by us; the lessons that go wrong are the ones a
   * student typed, and until this existed there was no way to put one of those
   * through the lab.
   */
  ask: string | null;
  evalFiles: string[];
  sample: number | null;
  topics: string[] | null;
  arm: DiagramEvalArm;
  figureOnly: boolean;
  yes: boolean;
}

function parseOptions(argv: string[]): Options {
  const flags = new Map<string, string>();
  const evalFiles: string[] = [];
  const booleans = new Set(["figure-only", "yes"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > 0) {
      const name = token.slice(2, eq);
      const value = token.slice(eq + 1);
      if (name === "eval") evalFiles.push(value);
      else flags.set(name, value);
    } else {
      const name = token.slice(2);
      const next = argv[index + 1];
      if (name === "eval") {
        if (!next || next.startsWith("--")) throw new Error("--eval needs a JSONL file");
        evalFiles.push(next);
        index += 1;
        continue;
      }
      if (booleans.has(name) || !next || next.startsWith("--")) {
        flags.set(name, "true");
      } else {
        flags.set(name, next);
        index += 1;
      }
    }
  }
  const list = (name: string): string[] | null => {
    const raw = flags.get(name);
    return raw ? raw.split(",").map((entry) => entry.trim()).filter(Boolean) : null;
  };
  const number = (name: string, fallback: number | null): number | null => {
    const raw = flags.get(name);
    if (raw === undefined || raw === "") return fallback;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : fallback;
  };
  const arm = flags.get("arm") ?? "current";
  if (arm !== "current" && arm !== "planner_first") {
    throw new Error(`--arm must be current or planner_first, received ${arm}`);
  }
  return {
    difficulty: flags.get("difficulty") ?? "hard",
    units: list("units")?.map((entry) => Number.parseInt(entry, 10)) ?? null,
    subjects: list("subjects") ?? ["physics"],
    perUnit: number("per-unit", null),
    limit: number("limit", null),
    concurrency: number("concurrency", 3) ?? 3,
    out: flags.get("out") ?? `.lecture-lab/run-${Date.now()}`,
    origin: flags.get("origin") ?? "http://127.0.0.1:3000",
    familiarity: (flags.get("familiarity") as SubjectFamiliarity) ?? "normal",
    narrationLanguage: flags.get("narration") === "hinglish" ? "hinglish" : "english",
    only: list("only"),
    seed: number("seed", 1) ?? 1,
    ask: flags.get("ask") ?? null,
    evalFiles,
    sample: number("sample", null),
    topics: list("topics"),
    arm,
    figureOnly: flags.has("figure-only") ? flags.get("figure-only") !== "false" : evalFiles.length > 0,
    yes: flags.get("yes") === "true",
  };
}

/** Deterministic shuffle so a "sample one per unit" run is reproducible. */
function pick<T>(items: T[], count: number, seed: number): T[] {
  if (items.length <= count) return items;
  const ordered = [...items];
  let state = seed * 2654435761;
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const swap = state % (index + 1);
    [ordered[index], ordered[swap]] = [ordered[swap], ordered[index]];
  }
  return ordered.slice(0, count);
}

/** Ad-hoc questions from `--ask`: one per line, `#` comments and blanks skipped. */
function loadAskFile(path: string): ProbeQuestion[] {
  if (!existsSync(path)) throw new Error(`--ask file not found: ${path}`);
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((question, index) => ({
      id: `ask|${index + 1}|${question.slice(0, 40).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      topicId: "ask|0|ad-hoc",
      difficulty: "medium" as const,
      question,
    }));
}

function loadProbes(repoRoot: string, options: Options): ProbeQuestion[] {
  const probesDir = resolve(repoRoot, "data/syllabus-probes");
  const files = readdirSync(probesDir).filter((name) => name.endsWith(".json"));
  const selected: ProbeQuestion[] = [];
  for (const file of files.sort()) {
    const match = /^([a-z]+)-unit-(\d+)\.json$/.exec(file);
    if (!match) continue;
    const [, subject, unitNumber] = match;
    if (!options.subjects.includes(subject)) continue;
    if (options.units && !options.units.includes(Number.parseInt(unitNumber, 10))) continue;
    const questions = parseProbeFile(
      JSON.parse(readFileSync(resolve(probesDir, file), "utf8")),
    ).filter((probe) => options.difficulty === "all" || probe.difficulty === options.difficulty);
    selected.push(
      ...(options.perUnit ? pick(questions, options.perUnit, options.seed) : questions),
    );
  }
  const filtered = options.only
    ? selected.filter((probe) => options.only?.includes(probe.id))
    : selected;
  return options.limit ? filtered.slice(0, options.limit) : filtered;
}

function loadEvaluationRows(paths: readonly string[], options: Options): DiagramEvalRow[] {
  const groups = paths.map((path) => {
    if (!existsSync(path)) throw new Error(`--eval file not found: ${path}`);
    return parseDiagramEvalJsonl(readFileSync(path, "utf8"));
  });
  let rows = combineDiagramEvalRows(groups);
  if (options.topics) {
    const topics = new Set(options.topics);
    rows = rows.filter((row) => topics.has(row.topic_id));
  }
  return options.sample === null
    ? rows
    : sampleDiagramEvalRows(rows, options.sample, options.seed);
}

export function transcript(run: LectureRun, grade: LectureGrade): string {
  const lines: string[] = [];
  lines.push(`# ${run.probeId}`);
  lines.push("");
  lines.push(`**Question.** ${run.question}`);
  lines.push("");
  lines.push(
    `score ${grade.score} | ${grade.passed ? "passed" : "FAILED"} | steps ${grade.metrics.steps} (budget ${run.lessonBudget.minSteps}-${run.lessonBudget.maxSteps}, ${run.lessonBudget.scope}) | rows ${grade.metrics.writes} | figure ${grade.metrics.diagramTier} (${grade.metrics.diagramPrimitives} primitives) | plan ${Math.round(run.timings.planMs / 100) / 10}s | teach ${Math.round(run.timings.teachMs / 100) / 10}s`,
  );
  lines.push("");
  if (grade.findings.length > 0) {
    lines.push("## Findings");
    for (const finding of grade.findings) {
      lines.push(`- **${finding.severity}** \`${finding.code}\` ${finding.detail}`);
    }
    lines.push("");
  }
  lines.push("## Turn plan");
  const quantity = (item: { symbol?: string; id: string; value: unknown; unit?: string }) =>
    `${item.symbol ?? item.id} = ${String(item.value)}${item.unit ? " " + item.unit : ""}`;
  lines.push(
    `visualRequirement ${run.plan?.visualRequirement ?? "?"} | laws ${run.plan?.lawIds.join(", ") || "none"}`,
  );
  lines.push(
    `givens: ${(run.plan?.givens ?? []).map((given) => quantity(given as never)).join("; ") || "none"}`,
  );
  lines.push(
    `unknowns: ${(run.plan?.unknowns ?? []).map((unknown) => (unknown as { symbol?: string; id: string }).symbol ?? (unknown as { id: string }).id).join(", ") || "none"}`,
  );
  lines.push(`derived: ${run.plan?.derived.map(quantity).join("; ") || "none"}`);
  lines.push(
    `solver: ${run.solver ? `${run.solver.status}${run.solver.issueCodes.length ? " (" + run.solver.issueCodes.join(", ") + ")" : ""}` : "unavailable"}`,
  );
  lines.push("");
  lines.push("## Figure");
  lines.push(
    `source ${run.diagram.figureSource ?? "unrecorded"} | tier ${run.diagram.tier ?? "none"} | family ${run.diagram.family ?? "none"} | archetype ${run.diagram.archetypeId ?? "none"} | reason ${run.diagram.reason ?? "none"}`,
  );
  lines.push(`entities: ${run.diagram.entityIds.join(", ") || "none"}`);
  if (run.diagram.renderedLabels.length > 0) {
    lines.push(`text drawn on the figure: ${run.diagram.renderedLabels.join(" | ")}`);
  } else if (run.diagram.committed) {
    lines.push("text drawn on the figure: none");
  }
  if (run.diagram.focusableIds.length > 0) {
    lines.push(`focusable: ${run.diagram.focusableIds.join(", ")}`);
  }
  if (run.diagram.candidateErrorCodes.length > 0) {
    lines.push(`rejected candidates: ${run.diagram.candidateErrorCodes.join(", ")}`);
  }
  lines.push("");
  lines.push("## Lesson");
  if (run.givenRows.length > 0) {
    lines.push(`_runtime wrote:_ ${run.givenRows.join(" / ")}`);
    lines.push("");
  }
  for (const step of run.teaching.steps) {
    const tags = step.tags
      .map((tag) =>
        tag.text !== undefined
          ? `[${tag.type}:${tag.text}${tag.params.length ? "," + tag.params.join(",") : ""}]`
          : `[${tag.type}${tag.params.length ? ":" + tag.params.join(",") : ""}]`,
      )
      .join(" ");
    lines.push(`${step.index}. ${step.speech}`);
    if (tags) lines.push(`   ${tags}`);
  }
  if (run.error) {
    lines.push("");
    lines.push(`**Error.** ${run.error}`);
  }
  return lines.join("\n");
}

function summarizeEvaluation(runs: readonly LectureRun[]) {
  const sourceCounts: Record<string, number> = {};
  const tierCounts: Record<string, number> = {};
  const familyCounts: Record<string, number> = {};
  let figureCommitMs = 0;
  let timedFigures = 0;
  let plannerCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let estimatedCostUsd = 0;
  const modelCounts: Record<string, number> = {};
  const diagramFailures = summarizeDiagramFailures(runs.map((run) => run.diagram));
  for (const run of runs) {
    const source = run.diagram.figureSource ?? "unrecorded";
    const tier = run.diagram.tier ?? "none";
    const family = run.diagram.family ?? "none";
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
    familyCounts[family] = (familyCounts[family] ?? 0) + 1;
    if (run.timings.figureCommitMs !== null && run.timings.figureCommitMs !== undefined) {
      figureCommitMs += run.timings.figureCommitMs;
      timedFigures += 1;
    }
    plannerCalls += run.planner?.calls ?? 0;
    inputTokens += run.planner?.inputTokens ?? 0;
    outputTokens += run.planner?.outputTokens ?? 0;
    totalTokens += run.planner?.totalTokens ?? 0;
    estimatedCostUsd += run.planner?.estimatedCostUsd ?? 0;
    for (const call of run.planner?.modelCalls ?? []) {
      modelCounts[call.model] = (modelCounts[call.model] ?? 0) + 1;
    }
  }
  return {
    rows: runs.length,
    figuresCommitted: runs.filter((run) => run.diagram.committed).length,
    noFigure: runs.filter((run) => !run.diagram.committed).length,
    errors: runs.filter((run) => run.error !== null).length,
    sourceCounts,
    tierCounts,
    familyCounts,
    ...diagramFailures,
    meanFigureCommitMs: timedFigures > 0 ? Math.round(figureCommitMs / timedFigures) : null,
    planner: {
      calls: plannerCalls,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
      modelCounts,
    },
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const repoRoot = resolve(process.cwd(), "../..");
  if (options.evalFiles.length > 0 && options.ask) throw new Error("--eval and --ask cannot be combined");
  const evaluationRows = options.evalFiles.length > 0
    ? loadEvaluationRows(options.evalFiles.map((path) => resolve(path)), options)
    : null;
  const evaluationById = new Map(evaluationRows?.map((row) => [row.id, row]) ?? []);
  const probes = evaluationRows
    ? evaluationRows.map((row): ProbeQuestion => ({
        id: row.id,
        topicId: row.topic_id,
        difficulty: row.difficulty,
        question: row.question,
      }))
    : options.ask
      ? loadAskFile(resolve(options.ask))
      : loadProbes(repoRoot, options);
  const preflightEstimateUsd = evaluationRows
    ? estimateEvaluationCostUsd(probes.length, options.arm)
    : null;
  if (preflightEstimateUsd !== null) {
    console.log(
      `diagram eval: ${probes.length} rows, arm ${options.arm}, figure-only ${options.figureOnly}, estimated cost $${preflightEstimateUsd.toFixed(2)}`,
    );
    assertEvaluationCostAllowed(preflightEstimateUsd, options.yes);
  }

  const outDir = resolve(process.cwd(), options.out);
  mkdirSync(`${outDir}/runs`, { recursive: true });
  mkdirSync(`${outDir}/transcripts`, { recursive: true });

  const landing = await fetch(`${options.origin}/`, { redirect: "manual" });
  const cookie = (landing.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("dev server issued no anonymous session cookie");

  // Every planner in tutor-core builds its own request; the cookie is the one
  // thing they cannot know about. Adding it here keeps the call sites identical
  // to the browser's. Eval rounds also account every non-streaming planner
  // response by the trace id already carried on the request.
  const nativeFetch = globalThis.fetch;
  const usageTracker = new PlannerUsageTracker();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (url.startsWith(options.origin)) {
      headers.set("cookie", cookie);
      applyLectureLabHeaders(headers);
      if (evaluationRows) {
        headers.set(LECTURE_LAB_ZERO_RETENTION_HEADER, "1");
        headers.set(LECTURE_LAB_STANDARD_MODEL_HEADER, "1");
      }
    }
    const traceId = headers.get("x-heytutor-trace-id");
    const plannerRequest = url.startsWith(options.origin) && headers.get("x-planner") === "1" && traceId;
    if (plannerRequest) usageTracker.recordRequest(traceId);
    const response = await nativeFetch(input, { ...init, headers });
    if (plannerRequest) await usageTracker.recordResponse(traceId, response);
    return response;
  }) as typeof fetch;

  console.log(
    `lecture lab: ${probes.length} ${evaluationRows ? "evaluation rows" : `${options.difficulty} probes`}, concurrency ${options.concurrency}, familiarity ${options.familiarity} -> ${options.out}`,
  );

  const grades: LectureGrade[] = [];
  const runs: LectureRun[] = [];
  let cursor = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= probes.length) return;
      const probe = probes[index];
      const startedAt = Date.now();
      const traceId = crypto.randomUUID();
      const run = await runLecture(probe.question, {
        origin: options.origin,
        cookie,
        familiarity: options.familiarity,
        narrationLanguage: options.narrationLanguage,
        probeId: probe.id,
        topicId: probe.topicId,
        unitId: unitIdFromTopicId(probe.topicId),
        difficulty: probe.difficulty,
        arm: options.arm,
        figureOnly: options.figureOnly,
        fastMode: evaluationRunFastMode(Boolean(evaluationRows)),
        traceId,
      });
      run.planner = usageTracker.finish(traceId);
      const grade = gradeLecture(run);
      grades.push(grade);
      runs.push(run);
      const slug = probe.id.replace(/[^a-z0-9]+/gi, "_");
      const svgPath = run.diagram.svg ? `frames/${slug}.svg` : null;
      const pngPath = run.diagram.svg ? `frames/${slug}.png` : null;
      if (run.diagram.svg) {
        mkdirSync(`${outDir}/frames`, { recursive: true });
        writeFileSync(`${outDir}/frames/${slug}.svg`, run.diagram.svg);
      }
      run.diagram.png = pngPath;
      writeFileSync(`${outDir}/runs/${slug}.json`, `${JSON.stringify({
        ...run,
        evaluation: evaluationById.get(probe.id) ?? null,
        diagram: { ...run.diagram, svg: svgPath, png: pngPath },
      }, null, 1)}\n`);
      writeFileSync(`${outDir}/transcripts/${slug}.md`, `${transcript(run, grade)}\n`);
      done += 1;
      const state = evaluationRows
        ? run.error ? "dead" : run.diagram.committed ? "fig " : "none"
        : grade.transportFailure ? "dead" : grade.passed ? "ok  " : "FAIL";
      console.log(`[${done}/${probes.length}] ${state} ${Math.round((Date.now() - startedAt) / 1000)}s ${probe.id}`);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, () => worker()),
  );

  if (existsSync(`${outDir}/frames`)) {
    execFileSync(process.execPath, [resolve(process.cwd(), "scripts/lecture-lab/svg2png.mjs"), `${outDir}/frames`], {
      stdio: "inherit",
    });
  }

  const galleryPath = evaluationRows ? writeRoundGallery(outDir) : null;

  const summary = {
    options,
    preflightEstimateUsd,
    evaluation: evaluationRows ? summarizeEvaluation(runs) : null,
    ...summarize(grades, runs),
  };
  writeFileSync(`${outDir}/summary.json`, `${JSON.stringify(summary, null, 1)}\n`);
  console.log("");
  if (evaluationRows) console.log(JSON.stringify(summary.evaluation, null, 2));
  else printSummary(summary);
  if (galleryPath) console.log(`gallery: ${galleryPath}`);
}

if (process.argv[1]?.endsWith("run.ts")) {
  void main();
}
