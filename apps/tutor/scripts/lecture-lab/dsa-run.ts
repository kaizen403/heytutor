/**
 * DSA lecture lab batch runner over the LeetCode corpus.
 *
 * Usage (dev server must be up):
 *   cd apps/tutor
 *   # routing + figures only, no LLM calls, every frame rendered as SVG
 *   pnpm exec tsx scripts/lecture-lab/dsa-run.ts --offline --out .lecture-lab/dsa-offline
 *   # the whole lesson: code plan, frames, narration, conductor
 *   pnpm exec tsx scripts/lecture-lab/dsa-run.ts --concurrency 3 --out .lecture-lab/dsa-01
 *   pnpm exec tsx scripts/lecture-lab/dsa-run.ts --only "lc|1|two-sum|easy" --familiarity new --out .lecture-lab/one
 *   pnpm exec tsx scripts/lecture-lab/dsa-run.ts --lanes a,c --difficulty medium --out .lecture-lab/ac
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { familyById } from "@heytutor/scene-engine";
import type { SubjectFamiliarity } from "@heytutor/tutor-core";
import { gradeDsaLecture, type DsaLectureGrade } from "./dsaGrade";
import { runDsaLecture, type DsaLectureRun } from "./dsaPipeline";

interface LeetCodeProbe {
  id: string;
  number: number;
  title: string;
  difficulty: string;
  pattern: string;
  /**
   * Informational only. Whether a family exists is asked of the catalog at run
   * time, because this field is a copy of that answer and goes stale the
   * moment a family lands: 57 probes carried `false` purely because nothing
   * drew them yet, and a decline that used to be correct became a miss with
   * no edit to the file.
   */
  inCatalog?: boolean;
  /**
   * Present when declining is the right answer and this says why. A probe with
   * a note must draw nothing, whatever the catalog happens to contain.
   */
  catalogNote?: string;
  tags: string[];
  example: string;
  expectedOutput: string;
  question: string;
}

interface Options {
  difficulty: string;
  lanes: string[] | null;
  only: string[] | null;
  limit: number | null;
  concurrency: number;
  out: string;
  origin: string;
  familiarity: SubjectFamiliarity;
  offline: boolean;
  fastMode: boolean;
}

function parseOptions(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > 0) {
      flags.set(token.slice(2, eq), token.slice(eq + 1));
    } else {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        flags.set(token.slice(2), "true");
      } else {
        flags.set(token.slice(2), next);
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
  return {
    difficulty: flags.get("difficulty") ?? "all",
    lanes: list("lanes"),
    only: list("only"),
    limit: number("limit", null),
    concurrency: number("concurrency", 3) ?? 3,
    out: flags.get("out") ?? `.lecture-lab/dsa-${Date.now()}`,
    origin: flags.get("origin") ?? "http://127.0.0.1:3000",
    familiarity: (flags.get("familiarity") as SubjectFamiliarity) ?? "normal",
    offline: flags.get("offline") === "true",
    fastMode: flags.get("slow") !== "true",
  };
}

export function loadLeetCodeProbes(repoRoot: string, options: Pick<Options, "lanes" | "difficulty" | "only" | "limit">): LeetCodeProbe[] {
  const dir = resolve(repoRoot, "data/leetcode-probes");
  const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const selected: LeetCodeProbe[] = [];
  for (const file of files) {
    const lane = file.replace(/\.json$/, "");
    if (options.lanes && !options.lanes.some((prefix) => lane.startsWith(prefix))) continue;
    const parsed = JSON.parse(readFileSync(resolve(dir, file), "utf8")) as { questions: LeetCodeProbe[] };
    for (const probe of parsed.questions) {
      if (options.difficulty !== "all" && probe.difficulty !== options.difficulty) continue;
      selected.push(probe);
    }
  }
  const filtered = options.only ? selected.filter((probe) => options.only!.includes(probe.id)) : selected;
  return options.limit ? filtered.slice(0, options.limit) : filtered;
}

function fmtMs(ms: number): string {
  return `${Math.round(ms / 100) / 10}s`;
}

/** What the student sees and hears, in order. */
export function transcript(run: DsaLectureRun, grade: DsaLectureGrade): string {
  const lines: string[] = [];
  lines.push(`# ${run.probeId}`);
  lines.push("");
  lines.push(`**${run.title}** (${run.difficulty}) — expected pattern \`${run.expectedPattern}\`${run.expectedInCatalog ? " (in catalog)" : " (no simulator)"}`);
  lines.push("");
  lines.push(`**Question.** ${run.question.split("\n")[0]}`);
  lines.push("");
  lines.push(
    `score ${grade.score} | ${grade.passed ? "passed" : "FAILED"} | routed ${grade.metrics.routed} | figure ${grade.metrics.figureSource} (${grade.metrics.frames} frames, example ${run.figure.exampleSource ?? "n/a"}) | blocks ${grade.metrics.blocks} | beats ${grade.metrics.beats} (${grade.metrics.figureBeats} figure, ${grade.metrics.codeBeats} code) | est ${grade.metrics.estimatedMinutes} min | plan ${fmtMs(run.timings.planMs)} | teach ${fmtMs(run.timings.teachMs)}`,
  );
  lines.push("");
  if (grade.findings.length > 0) {
    lines.push("## Findings");
    for (const finding of grade.findings) {
      lines.push(`- **${finding.severity}** \`${finding.code}\` ${finding.detail}`);
    }
    lines.push("");
  }

  lines.push("## Routing");
  lines.push(
    `classified ${run.classification.isDsa ? "DSA" : "NOT DSA"} (${run.classification.confidence}, ${run.classification.language}) | ranking: ${run.ranking.map((entry) => `${entry.family}=${entry.score}${entry.margin ? `(+${entry.margin})` : ""}`).join(", ") || "no family scored"}`,
  );
  lines.push("");

  lines.push("## Figure");
  lines.push(`source ${run.figure.source} | algorithm ${run.figure.algorithmId ?? "none"} | structure ${run.figure.structure ?? "none"} | tier ${run.figure.tier ?? "none"} | ${run.figure.reason ?? ""}`);
  for (const [index, frame] of run.figure.frames.entries()) {
    lines.push(`${index + 1}. **${frame.id}** — "${frame.caption}"`);
    lines.push(`   drawn: ${frame.renderedLabels.join(" | ") || "(no text)"} | focus: ${frame.focusEntityIds.join(",") || "none"} | ${frame.primitiveCount} primitives${frame.svgFile ? ` | ${frame.svgFile}` : ""}`);
    if (frame.narrationIntent) lines.push(`   intent: ${frame.narrationIntent}`);
    if (frame.mismatches.length > 0) lines.push(`   MISMATCH: ${frame.mismatches.map((m) => `${m.entityId} expected ${m.expected} got ${m.actual}`).join("; ")}`);
  }
  lines.push("");

  lines.push("## Code plan");
  if (!run.codeLesson.accepted) {
    lines.push("_no accepted plan_");
    for (const rejection of run.codeLesson.rejections) {
      lines.push(`- ${rejection.phase}: ${rejection.codes.join(", ")}`);
      for (const message of rejection.messages) lines.push(`  - ${message}`);
    }
  } else {
    lines.push(`"${run.codeLesson.title}" in ${run.codeLesson.language}: ${run.codeLesson.sectionCount} sections, ${run.codeLesson.blockCount} blocks, ${run.codeLesson.totalLines} lines`);
    for (const section of run.codeLesson.sections) {
      lines.push("");
      lines.push(`### ${section.id} — ${section.title} (${section.lines} lines; type-along ${section.typeAlongRanges.map((range) => `${range.startLine}-${range.endLine}`).join(", ") || "none"})`);
      lines.push(`_${section.explanation}_`);
      lines.push("```" + run.codeLesson.language);
      for (const block of section.blocks) {
        lines.push(`# [${block.id}]`);
        lines.push(block.code);
      }
      lines.push("```");
    }
    lines.push("");
    lines.push(`diagramHint: ${JSON.stringify(run.codeLesson.diagramHint)}`);
  }
  lines.push("");

  lines.push("## Lesson as the student experiences it");
  if (run.figure.frames.length > 0) {
    lines.push(`_[board shows frame 1: "${run.figure.frames[0]!.caption}"]_`);
  }
  for (const beat of run.teaching.beats) {
    const actions = beat.actions
      .map((action) => {
        switch (action.kind) {
          case "frame":
            return `[BOARD → frame ${action.frameIndex + 1}: "${action.caption}"]`;
          case "type":
            return `[PANEL types ${action.blockId}: ${action.lines} lines, ${Math.round(action.typingMs / 1000)}s]`;
          case "focus":
            return `[spotlight ${action.targets.join(",")}]`;
          case "point":
            return `[marker moves to ${action.targets.join(",")}]`;
          case "pause":
            return "[pause]";
          case "blocked":
            return `[blocked ${action.tag}]`;
        }
      })
      .join(" ");
    lines.push(`${beat.index}. ${beat.speech}`);
    if (actions) lines.push(`   ${actions}`);
  }
  if (run.teaching.missingBlockIds.length > 0) {
    lines.push(`_never typed: ${run.teaching.missingBlockIds.join(", ")}_`);
  }
  if (run.teaching.unshownFrameCount > 0) {
    lines.push(`_never shown: ${run.teaching.unshownFrameCount} frames_`);
  }
  if (run.error) {
    lines.push("");
    lines.push(`**Error.** ${run.error}`);
  }
  return lines.join("\n");
}

export interface DsaRoundSummary {
  total: number;
  graded: number;
  transportFailures: number;
  passed: number;
  meanScore: number;
  findingCounts: Record<string, number>;
  bySource: Record<string, number>;
  byDifficulty: Record<string, { total: number; passed: number; meanScore: number }>;
  routing: { probeId: string; expected: string; inCatalog: boolean; routed: string; traceId: string | null; source: string; exampleSource: string | null }[];
  grades: DsaLectureGrade[];
}

export function summarize(grades: readonly DsaLectureGrade[], runs: readonly DsaLectureRun[]): DsaRoundSummary {
  const graded = grades.filter((grade) => !grade.transportFailure);
  const byCode = new Map<string, number>();
  for (const grade of grades) {
    for (const finding of grade.findings) byCode.set(finding.code, (byCode.get(finding.code) ?? 0) + 1);
  }
  const bySource: Record<string, number> = {};
  for (const run of runs) bySource[run.figure.source] = (bySource[run.figure.source] ?? 0) + 1;
  const byDifficulty: DsaRoundSummary["byDifficulty"] = {};
  for (const grade of graded) {
    const bucket = byDifficulty[grade.difficulty] ?? { total: 0, passed: 0, meanScore: 0 };
    bucket.total += 1;
    bucket.passed += grade.passed ? 1 : 0;
    bucket.meanScore += grade.score;
    byDifficulty[grade.difficulty] = bucket;
  }
  for (const bucket of Object.values(byDifficulty)) bucket.meanScore = Math.round(bucket.meanScore / Math.max(1, bucket.total));
  return {
    total: grades.length,
    graded: graded.length,
    transportFailures: grades.length - graded.length,
    passed: graded.filter((grade) => grade.passed).length,
    meanScore: graded.length > 0 ? Math.round(graded.reduce((sum, grade) => sum + grade.score, 0) / graded.length) : 0,
    findingCounts: Object.fromEntries([...byCode.entries()].sort((a, b) => b[1] - a[1])),
    bySource,
    byDifficulty,
    routing: runs.map((run) => ({
      probeId: run.probeId,
      expected: run.expectedPattern,
      inCatalog: run.expectedInCatalog,
      routed: run.routedFamily ?? "none",
      traceId: run.figure.algorithmId,
      source: run.figure.source,
      exampleSource: run.figure.exampleSource,
    })),
    grades: [...grades].sort((a, b) => a.score - b.score),
  };
}

export function printSummary(summary: DsaRoundSummary): void {
  console.log(
    `passed ${summary.passed}/${summary.graded}  mean score ${summary.meanScore}` +
      (summary.transportFailures > 0 ? `  (${summary.transportFailures} died in transport)` : ""),
  );
  console.log(`figure sources: ${Object.entries(summary.bySource).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  for (const [difficulty, bucket] of Object.entries(summary.byDifficulty)) {
    console.log(`  ${difficulty.padEnd(7)} ${bucket.passed}/${bucket.total} passed, mean ${bucket.meanScore}`);
  }
  for (const [code, count] of Object.entries(summary.findingCounts)) {
    console.log(`  ${String(count).padStart(4)}  ${code}`);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const repoRoot = resolve(process.cwd(), "../..");
  const outDir = resolve(process.cwd(), options.out);
  mkdirSync(`${outDir}/runs`, { recursive: true });
  mkdirSync(`${outDir}/transcripts`, { recursive: true });
  mkdirSync(`${outDir}/frames`, { recursive: true });

  if (!options.offline) {
    const landing = await fetch(`${options.origin}/`, { redirect: "manual" });
    const cookie = (landing.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
    if (!cookie) throw new Error("dev server issued no anonymous session cookie");
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
  }

  const probes = loadLeetCodeProbes(repoRoot, options);
  console.log(
    `dsa lab: ${probes.length} probes, ${options.offline ? "OFFLINE (no LLM)" : `concurrency ${options.concurrency}, familiarity ${options.familiarity}`} -> ${options.out}`,
  );

  const grades: DsaLectureGrade[] = [];
  const runs: DsaLectureRun[] = [];
  let cursor = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= probes.length) return;
      const probe = probes[index]!;
      const startedAt = Date.now();
      const run = await runDsaLecture(probe.question, {
        origin: options.origin,
        familiarity: options.familiarity,
        fastMode: options.fastMode,
        probeId: probe.id,
        title: probe.title,
        difficulty: probe.difficulty,
        expectedPattern: probe.pattern,
        // Asked of the catalog, not of the probe file. A probe with a note
        // saying declining is right is never "in catalog", even if some
        // family's cues would happen to claim it.
        expectedInCatalog: probe.catalogNote === undefined && familyById(probe.pattern) !== null,
        framesDir: `${outDir}/frames`,
        offline: options.offline,
      });
      const grade = gradeDsaLecture(run);
      grades.push(grade);
      runs.push(run);
      const slug = probe.id.replace(/[^a-z0-9]+/gi, "_");
      writeFileSync(`${outDir}/runs/${slug}.json`, `${JSON.stringify(run, null, 1)}\n`);
      writeFileSync(`${outDir}/transcripts/${slug}.md`, `${transcript(run, grade)}\n`);
      done += 1;
      console.log(
        `[${done}/${probes.length}] ${grade.transportFailure ? "dead" : grade.passed ? "ok  " : "FAIL"} ${grade.score.toString().padStart(3)} ${Math.round((Date.now() - startedAt) / 1000)}s ${probe.id} ${run.figure.source}:${run.figure.algorithmId ?? "-"}×${run.figure.frameCount} ${grade.findings.map((finding) => finding.code).join(",")}`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.offline ? 1 : options.concurrency) }, () => worker()));

  const summary = { options, ...summarize(grades, runs) };
  writeFileSync(`${outDir}/summary.json`, `${JSON.stringify(summary, null, 1)}\n`);
  console.log("");
  printSummary(summary);
}

if (process.argv[1]?.endsWith("dsa-run.ts")) {
  void main();
}
