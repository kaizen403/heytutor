/**
 * Lecture lab batch runner.
 *
 * Usage (dev server must be up):
 *   pnpm --filter @heytutor/tutor exec tsx scripts/lecture-lab/run.ts \
 *     --difficulty hard --per-unit 1 --concurrency 3 --out .lecture-lab/run-01
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseProbeFile, type ProbeQuestion } from "@/features/admin/lib/probes";
import { unitIdFromTopicId } from "@/features/admin/lib/probes";
import { gradeLecture, type LectureGrade } from "./grade";
import { printSummary, summarize } from "./summarize";
import { runLecture, type LectureRun } from "./lecturePipeline";
import type { SubjectFamiliarity } from "@heytutor/tutor-core";

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
  only: string[] | null;
  seed: number;
}

function parseOptions(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > 0) {
      flags.set(token.slice(2, eq), token.slice(eq + 1));
    } else {
      flags.set(token.slice(2), argv[index + 1] ?? "");
      index += 1;
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
    only: list("only"),
    seed: number("seed", 1) ?? 1,
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
    `tier ${run.diagram.tier ?? "none"} | family ${run.diagram.family ?? "none"} | archetype ${run.diagram.archetypeId ?? "none"} | reason ${run.diagram.reason ?? "none"}`,
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

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const repoRoot = resolve(process.cwd(), "../..");
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
  // to the browser's.
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(options.origin)) {
      const headers = new Headers(init?.headers ?? {});
      headers.set("cookie", cookie);
      return nativeFetch(input, { ...init, headers });
    }
    return nativeFetch(input, init);
  }) as typeof fetch;

  const probes = loadProbes(repoRoot, options);
  console.log(
    `lecture lab: ${probes.length} ${options.difficulty} probes, concurrency ${options.concurrency}, familiarity ${options.familiarity} -> ${options.out}`,
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
      const run = await runLecture(probe.question, {
        origin: options.origin,
        cookie,
        familiarity: options.familiarity,
        probeId: probe.id,
        topicId: probe.topicId,
        unitId: unitIdFromTopicId(probe.topicId),
        difficulty: probe.difficulty,
      });
      const grade = gradeLecture(run);
      grades.push(grade);
      runs.push(run);
      const slug = probe.id.replace(/[^a-z0-9]+/gi, "_");
      writeFileSync(`${outDir}/runs/${slug}.json`, `${JSON.stringify(run, null, 1)}\n`);
      writeFileSync(`${outDir}/transcripts/${slug}.md`, `${transcript(run, grade)}\n`);
      done += 1;
      console.log(
        `[${done}/${probes.length}] ${grade.transportFailure ? "dead" : grade.passed ? "ok  " : "FAIL"} ${grade.score.toString().padStart(3)} ${Math.round((Date.now() - startedAt) / 1000)}s ${probe.id} ${grade.findings.map((finding) => finding.code).join(",")}`,
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, () => worker()),
  );

  const summary = { options, ...summarize(grades, runs) };
  writeFileSync(`${outDir}/summary.json`, `${JSON.stringify(summary, null, 1)}\n`);
  console.log("");
  printSummary(summary);
}

if (process.argv[1]?.endsWith("run.ts")) {
  void main();
}
