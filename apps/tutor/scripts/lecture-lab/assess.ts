/**
 * Offline Jev review of a lecture-lab round.
 *
 * Dry-run is the default: it writes the assessment request and does not call
 * a provider. `--live` posts to AI Gateway. Results land in `assessments/`
 * and never replace `LectureGrade`.
 *
 *   pnpm exec tsx scripts/lecture-lab/assess.ts .lecture-lab/round-01
 *   pnpm exec tsx scripts/lecture-lab/assess.ts .lecture-lab/round-01 --live --limit 20
 *   pnpm exec tsx scripts/lecture-lab/assess.ts .lecture-lab/round-01 --live --no-zdr
 *
 * `--no-zdr` is for public corpus text when the Gateway account cannot
 * require zero data retention. Leave it off for anything student-linked.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assessTutorState } from "../../lib/llm/evaluation/gateway";
import { buildLessonReviewState, evaluationInputHash } from "../../lib/llm/evaluation/lessonReviewState";
import { questionsForJob, rubricVersionForJob } from "../../lib/llm/evaluation/rubrics";
import {
  EVALUATION_POLICY_VERSION,
  JEV_GATEWAY_MODEL,
  type LessonReviewState,
  type TutorAssessment,
} from "../../lib/llm/evaluation/types";

interface CliOptions {
  roundDir: string;
  live: boolean;
  zeroDataRetention: boolean;
  limit: number | null;
}

function readOptions(argv: string[]): CliOptions {
  let roundDir = "";
  let live = false;
  let zeroDataRetention = true;
  let limit: number | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--live") live = true;
    else if (arg === "--no-zdr") zeroDataRetention = false;
    else if (arg === "--limit") {
      const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--limit needs a positive integer");
      }
      limit = parsed;
      index += 1;
    } else if (!arg.startsWith("--") && !roundDir) {
      roundDir = arg;
    }
  }
  if (!roundDir) {
    throw new Error("Usage: assess.ts <lecture-lab-round> [--live] [--no-zdr] [--limit N]");
  }
  return { roundDir, live, zeroDataRetention, limit };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function describeQuantity(entry: unknown, requireValue: boolean): string | null {
  if (typeof entry === "string") return entry.trim() || null;
  if (!isRecord(entry)) return null;
  const symbol = typeof entry.symbol === "string" ? entry.symbol : typeof entry.id === "string" ? entry.id : "";
  if (!symbol) return null;
  const raw = "value" in entry ? entry.value : "expected" in entry ? entry.expected : undefined;
  if (raw === undefined) return requireValue ? null : symbol;
  const unit = typeof entry.unit === "string" && entry.unit ? ` ${entry.unit}` : "";
  return `${symbol} = ${String(raw)}${unit}`;
}

function factLines(value: unknown, requireValue: boolean): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => describeQuantity(entry, requireValue))
    .filter((line): line is string => Boolean(line));
}

function collectProjectionFacts(value: unknown, into: string[], depth = 0): void {
  if (depth > 4 || into.length > 40 || !isRecord(value)) return;
  const described = describeQuantity(value, true);
  if (described) into.push(described);
  for (const entry of Object.values(value)) {
    if (Array.isArray(entry)) {
      for (const item of entry) collectProjectionFacts(item, into, depth + 1);
    } else if (isRecord(entry)) {
      collectProjectionFacts(entry, into, depth + 1);
    }
  }
}

function readLecture(value: unknown): {
  probeId: string;
  question: string;
  error: string | null;
  state: LessonReviewState;
} | null {
  if (!isRecord(value) || typeof value.question !== "string" || typeof value.probeId !== "string") {
    return null;
  }
  const plan = isRecord(value.plan) ? value.plan : null;
  const solver = isRecord(value.solver) ? value.solver : null;
  const diagram = isRecord(value.diagram) ? value.diagram : null;
  const teaching = isRecord(value.teaching) ? value.teaching : null;
  const steps = teaching && Array.isArray(teaching.steps) ? teaching.steps : [];
  const spoken = steps
    .map((step) => (isRecord(step) && typeof step.speech === "string" ? step.speech : ""))
    .filter(Boolean)
    .join("\n");
  const writes = teaching && Array.isArray(teaching.writes) ? teaching.writes : [];
  const boardRows = writes
    .map((write) => (isRecord(write) && typeof write.text === "string" ? write.text : ""))
    .filter(Boolean);
  const projectionFacts: string[] = [];
  if (solver) collectProjectionFacts(solver.projection, projectionFacts);
  return {
    probeId: value.probeId,
    question: value.question,
    error: typeof value.error === "string" ? value.error : null,
    state: buildLessonReviewState({
      question: value.question,
      requestedParts: [
        ...factLines(plan?.unknowns, false),
        ...factLines(plan?.qualitativeClaims, false),
      ],
      authoritativeFacts: [
        ...new Set([
          ...factLines(plan?.givens, true),
          ...factLines(plan?.derived, true),
          ...projectionFacts,
        ]),
      ],
      spokenExplanation: spoken || (teaching && typeof teaching.rawText === "string" ? teaching.rawText : ""),
      boardRows: boardRows.length > 0 ? boardRows : strings(value.givenRows),
      figure: diagram
        ? {
            committed: diagram.committed === true,
            family: typeof diagram.family === "string" ? diagram.family : null,
            tier: typeof diagram.tier === "string" ? diagram.tier : null,
            labels: strings(diagram.labels),
            reason: typeof diagram.reason === "string" ? diagram.reason : null,
          }
        : null,
    }),
  };
}

function reviewSample(probeId: string, flagged: boolean): boolean {
  if (flagged) return true;
  let hash = 0;
  for (const char of probeId) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash % 5 === 0;
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const runsDir = path.join(options.roundDir, "runs");
  const outDir = path.join(options.roundDir, "assessments");
  await mkdir(outDir, { recursive: true });
  let names: string[];
  try {
    names = await readdir(runsDir);
  } catch {
    throw new Error(`No runs directory at ${runsDir}`);
  }
  const files = names.filter((name) => name.endsWith(".json")).sort();
  const selected = options.limit === null ? files : files.slice(0, options.limit);
  if (options.live && !options.zeroDataRetention) {
    console.warn("assess: zero data retention is off. Use this only for public or synthetic text.");
  }

  const summary: Array<Record<string, unknown>> = [];
  for (const file of selected) {
    const raw: unknown = JSON.parse(await readFile(path.join(runsDir, file), "utf8"));
    const lecture = readLecture(raw);
    if (!lecture) continue;
    const inputHash = evaluationInputHash({
      model: JEV_GATEWAY_MODEL,
      rubric: rubricVersionForJob("lesson_review"),
      policy: EVALUATION_POLICY_VERSION,
      state: lecture.state,
      questions: questionsForJob("lesson_review"),
    });

    let assessment: TutorAssessment | { status: "dry_run"; job: "lesson_review"; reason: string };
    if (lecture.error) {
      assessment = { status: "unavailable", job: "lesson_review", reason: "lecture_error" };
    } else if (!options.live) {
      assessment = { status: "dry_run", job: "lesson_review", reason: "not_sent" };
    } else {
      assessment = await assessTutorState(
        { job: "lesson_review", state: lecture.state },
        { zeroDataRetention: options.zeroDataRetention, deadlineMs: 8_000, circuit: false },
      );
    }

    const flags = assessment.status === "assessed" ? assessment.flags : [];
    const artifact = {
      probeId: lecture.probeId,
      question: lecture.question,
      rubricVersion: rubricVersionForJob("lesson_review"),
      policyVersion: EVALUATION_POLICY_VERSION,
      inputHash,
      state: lecture.state,
      assessment,
      requiresHumanReview: reviewSample(lecture.probeId, flags.length > 0),
      cannotApproveRelease: true,
    };
    await writeFile(path.join(outDir, file), `${JSON.stringify(artifact, null, 2)}\n`);
    summary.push({
      probeId: lecture.probeId,
      status: assessment.status,
      reason: assessment.status === "unavailable" || assessment.status === "dry_run" ? assessment.reason : null,
      flags,
      requiresHumanReview: artifact.requiresHumanReview,
      estimatedUsd: assessment.status === "assessed" ? assessment.usage.estimatedUsd : 0,
    });
  }

  const flagged = summary.filter((row) => Array.isArray(row.flags) && row.flags.length > 0).length;
  await writeFile(
    path.join(outDir, "summary.json"),
    `${JSON.stringify({
      live: options.live,
      zeroDataRetention: options.zeroDataRetention,
      lessons: summary.length,
      flagged,
      summary,
    }, null, 2)}\n`,
  );
  console.log(
    `assess: ${summary.length} lessons, ${flagged} flagged, ${options.live ? "live" : "dry-run"} -> ${outDir}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
