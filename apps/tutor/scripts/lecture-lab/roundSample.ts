import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDiagramEvalJsonl, type DiagramEvalRow } from "./diagramEval";

const EVAL_SOURCES = [
  { subject: "physics", ref: "origin/eval/diagram-eval-v1-physics-maths", file: "data/diagram-eval/v1/physics.jsonl" },
  { subject: "maths", ref: "origin/eval/diagram-eval-v1-maths", file: "data/diagram-eval/v1/maths.jsonl" },
  { subject: "chemistry", ref: "origin/eval/diagram-eval-v1-chemistry", file: "data/diagram-eval/v1/chemistry.jsonl" },
] as const;

export interface DiagramRoundSampleOptions {
  publicCount: number;
  seed: number;
}

export interface DiagramRoundSampleManifest {
  schemaVersion: "diagram-round-sample/v1";
  seed: number;
  publicCount: number;
  privateCount: number;
  totalCount: number;
  ids: string[];
  publicIds: string[];
  privateIds: string[];
  chapters: Array<{
    chapter: string;
    rows: number;
    examStem: number;
    studentStyle: number;
    traps: number;
    ids: string[];
  }>;
  publicAskStyles: Record<string, number>;
  publicTraps: Record<string, number>;
}

function stableRank(seed: number, key: string): string {
  return createHash("sha256").update(`${seed}:${key}`).digest("hex");
}

function chapterKey(row: DiagramEvalRow): string {
  return `${row.subject}|${row.topic_id.split("|")[1] ?? "unknown"}`;
}

function styleKey(row: DiagramEvalRow): "exam_stem" | "student_style" {
  return row.ask_style === "exam_stem" ? "exam_stem" : "student_style";
}

function counts(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function proportionalTargets(source: ReadonlyMap<string, number>, total: number): Map<string, number> {
  const sourceTotal = [...source.values()].reduce((sum, count) => sum + count, 0);
  if (sourceTotal === 0 || total === 0) return new Map([...source.keys()].map((key) => [key, 0]));
  const allocations = [...source.entries()].map(([key, count]) => {
    const exact = total * count / sourceTotal;
    return { key, target: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = total - allocations.reduce((sum, entry) => sum + entry.target, 0);
  for (const allocation of allocations.sort((left, right) =>
    right.remainder - left.remainder || left.key.localeCompare(right.key))) {
    if (remaining <= 0) break;
    allocation.target += 1;
    remaining -= 1;
  }
  return new Map(allocations.map(({ key, target }) => [key, target]));
}

/** Fixed, chapter-balanced public sample plus every private real-student row. */
export function sampleDiagramRoundRows(
  publicSource: readonly DiagramEvalRow[],
  privateRows: readonly DiagramEvalRow[],
  options: DiagramRoundSampleOptions,
): { rows: DiagramEvalRow[]; publicRows: DiagramEvalRow[]; manifest: DiagramRoundSampleManifest } {
  const ids = new Set<string>();
  for (const row of [...publicSource, ...privateRows]) {
    if (ids.has(row.id)) throw new Error(`diagram round source contains duplicate id ${row.id}`);
    ids.add(row.id);
  }
  const groups = new Map<string, DiagramEvalRow[]>();
  for (const row of publicSource) {
    const key = chapterKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const chapterKeys = [...groups.keys()].sort();
  if (options.publicCount < chapterKeys.length * 2) {
    throw new Error("public sample must leave room for exam and student-style rows in every chapter");
  }
  const base = Math.floor(options.publicCount / chapterKeys.length);
  const extras = options.publicCount % chapterKeys.length;
  const extraChapters = new Set([...chapterKeys]
    .sort((left, right) => stableRank(options.seed, `extra:${left}`).localeCompare(stableRank(options.seed, `extra:${right}`)))
    .slice(0, extras));
  const chapterQuotas = new Map(chapterKeys.map((key) => [key, base + Number(extraChapters.has(key))]));
  for (const key of chapterKeys) {
    if ((groups.get(key)?.length ?? 0) < chapterQuotas.get(key)!) {
      throw new Error(`${key} has too few rows for its sample quota`);
    }
  }

  const examRate = publicSource.filter((row) => styleKey(row) === "exam_stem").length / publicSource.length;
  const targetExam = Math.round(options.publicCount * examRate);
  const styleAllocations = chapterKeys.map((key) => {
    const quota = chapterQuotas.get(key)!;
    const exact = quota * examRate;
    const exam = Math.max(1, Math.min(quota - 1, Math.floor(exact)));
    return { key, quota, exam, remainder: exact - Math.floor(exact) };
  });
  let examDelta = targetExam - styleAllocations.reduce((sum, entry) => sum + entry.exam, 0);
  const increaseOrder = [...styleAllocations].sort((left, right) =>
    right.remainder - left.remainder ||
    stableRank(options.seed, `style:${left.key}`).localeCompare(stableRank(options.seed, `style:${right.key}`)));
  const decreaseOrder = [...increaseOrder].reverse();
  while (examDelta !== 0) {
    let changed = false;
    for (const allocation of examDelta > 0 ? increaseOrder : decreaseOrder) {
      if (examDelta > 0 && allocation.exam < allocation.quota - 1) {
        allocation.exam += 1;
        examDelta -= 1;
        changed = true;
      } else if (examDelta < 0 && allocation.exam > 1) {
        allocation.exam -= 1;
        examDelta += 1;
        changed = true;
      }
      if (examDelta === 0) break;
    }
    if (!changed) throw new Error("could not allocate the requested exam/student-style mix");
  }
  const styleQuota = new Map<string, number>(styleAllocations.flatMap(({ key, quota, exam }) => [
    [`${key}|exam_stem`, exam] as const,
    [`${key}|student_style`, quota - exam] as const,
  ]));

  const trapSource = new Map<string, number>();
  for (const row of publicSource) {
    if (row.trap) trapSource.set(row.trap, (trapSource.get(row.trap) ?? 0) + 1);
  }
  const targetTrapTotal = Math.round(
    options.publicCount * [...trapSource.values()].reduce((sum, value) => sum + value, 0) / publicSource.length,
  );
  const trapTargets = proportionalTargets(trapSource, targetTrapTotal);
  const selected = new Map<string, DiagramEvalRow>();
  const usedByStyle = new Map<string, number>();
  const canTake = (row: DiagramEvalRow) => {
    const key = `${chapterKey(row)}|${styleKey(row)}`;
    return (usedByStyle.get(key) ?? 0) < (styleQuota.get(key) ?? 0);
  };
  const take = (row: DiagramEvalRow) => {
    selected.set(row.id, row);
    const key = `${chapterKey(row)}|${styleKey(row)}`;
    usedByStyle.set(key, (usedByStyle.get(key) ?? 0) + 1);
  };
  for (const [trap, target] of [...trapTargets.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const candidates = publicSource
      .filter((row) => row.trap === trap)
      .sort((left, right) => stableRank(options.seed, `trap:${left.id}`).localeCompare(stableRank(options.seed, `trap:${right.id}`)));
    let added = 0;
    for (const row of candidates) {
      if (added >= target) break;
      if (!canTake(row)) continue;
      take(row);
      added += 1;
    }
    if (added !== target) throw new Error(`could not preserve the ${trap} trap quota`);
  }
  for (const allocation of styleAllocations) {
    for (const style of ["exam_stem", "student_style"] as const) {
      const key = `${allocation.key}|${style}`;
      const needed = (styleQuota.get(key) ?? 0) - (usedByStyle.get(key) ?? 0);
      const candidates = (groups.get(allocation.key) ?? [])
        .filter((row) => styleKey(row) === style && !selected.has(row.id))
        .sort((left, right) =>
          Number(Boolean(left.trap)) - Number(Boolean(right.trap)) ||
          stableRank(options.seed, `fill:${left.id}`).localeCompare(stableRank(options.seed, `fill:${right.id}`)));
      if (candidates.length < needed) throw new Error(`${key} has too few rows for its style quota`);
      for (const row of candidates.slice(0, needed)) take(row);
    }
  }
  const publicRows = [...selected.values()].sort((left, right) =>
    chapterKey(left).localeCompare(chapterKey(right)) ||
    stableRank(options.seed, left.id).localeCompare(stableRank(options.seed, right.id)));
  if (publicRows.length !== options.publicCount) throw new Error("public sample size drifted from its requested count");
  const orderedPrivate = [...privateRows].sort((left, right) => left.id.localeCompare(right.id));
  const rows = [...publicRows, ...orderedPrivate];
  const manifest: DiagramRoundSampleManifest = {
    schemaVersion: "diagram-round-sample/v1",
    seed: options.seed,
    publicCount: publicRows.length,
    privateCount: orderedPrivate.length,
    totalCount: rows.length,
    ids: rows.map((row) => row.id),
    publicIds: publicRows.map((row) => row.id),
    privateIds: orderedPrivate.map((row) => row.id),
    chapters: chapterKeys.map((chapter) => {
      const chapterRows = publicRows.filter((row) => chapterKey(row) === chapter);
      return {
        chapter,
        rows: chapterRows.length,
        examStem: chapterRows.filter((row) => styleKey(row) === "exam_stem").length,
        studentStyle: chapterRows.filter((row) => styleKey(row) === "student_style").length,
        traps: chapterRows.filter((row) => row.trap !== null).length,
        ids: chapterRows.map((row) => row.id),
      };
    }),
    publicAskStyles: counts(publicRows.map((row) => row.ask_style ?? "unknown")),
    publicTraps: counts(publicRows.map((row) => row.trap ?? "none")),
  };
  return { rows, publicRows, manifest };
}

function gitFile(repoRoot: string, ref: string, file: string): string {
  return execFileSync("git", ["show", `${ref}:${file}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function cliValue(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

if (process.argv[1]?.endsWith("roundSample.ts")) {
  const argv = process.argv.slice(2);
  const privatePath = cliValue(argv, "--private");
  const outputPath = cliValue(argv, "--out");
  if (!privatePath || !outputPath) {
    throw new Error("usage: roundSample.ts --private <real-student.jsonl> --out <round-dir> [--seed 20261009] [--public 285]");
  }
  const repoRoot = resolve(process.cwd(), "../..");
  const publicRows = EVAL_SOURCES.flatMap(({ ref, file }) =>
    parseDiagramEvalJsonl(gitFile(repoRoot, ref, file)));
  const privateRows = parseDiagramEvalJsonl(readFileSync(resolve(privatePath), "utf8"));
  const sample = sampleDiagramRoundRows(publicRows, privateRows, {
    publicCount: Number(cliValue(argv, "--public") ?? 285),
    seed: Number(cliValue(argv, "--seed") ?? 20261009),
  });
  const out = resolve(outputPath);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "sample.jsonl"), `${sample.rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  writeFileSync(resolve(out, "sample-ids.txt"), `${sample.manifest.ids.join("\n")}\n`);
  const sourceRefs = Object.fromEntries(EVAL_SOURCES.map(({ subject, ref }) => [
    subject,
    execFileSync("git", ["rev-parse", ref], { cwd: repoRoot, encoding: "utf8" }).trim(),
  ]));
  writeFileSync(resolve(out, "sample-manifest.json"), `${JSON.stringify({
    ...sample.manifest,
    sourceRefs,
  }, null, 2)}\n`);
  console.log(JSON.stringify({
    output: out,
    publicRows: sample.publicRows.length,
    privateRows: privateRows.length,
    totalRows: sample.rows.length,
    chapters: sample.manifest.chapters.length,
    askStyles: sample.manifest.publicAskStyles,
    traps: sample.manifest.publicTraps,
    sourceRefs,
  }, null, 2));
}
