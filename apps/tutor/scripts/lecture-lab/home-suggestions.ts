/**
 * Home screen suggestion check: does every card a student can click teach,
 * and does every figure card draw a right figure?
 *
 *   # 1. the evaluation set, built from the cards that can show ($0)
 *   pnpm exec tsx scripts/lecture-lab/home-suggestions.ts eval --out .lecture-lab/home-suggestions.jsonl
 *   # 2. one paid round of full lessons (needs the orchestrator's yes and a cap)
 *   pnpm exec tsx scripts/lecture-lab/run.ts --eval .lecture-lab/home-suggestions.jsonl \
 *     --arm planner_examples_strict --production-strict-subjects maths,physics --model fast \
 *     --scene-planner-limit-ms 60000 --figure-only=false --max-usd <cap> --yes --out .lecture-lab/home-<date>
 *   # 3. the per-card table, and every drawn figure as SVG + PNG to judge ($0)
 *   pnpm exec tsx scripts/lecture-lab/home-suggestions.ts report .lecture-lab/home-<date>
 *   # 4. freeze the judged figures for the offline gate ($0)
 *   pnpm exec tsx scripts/lecture-lab/home-suggestions.ts record .lecture-lab/home-<date> --judgements judged.json
 *   # 5. replay every recording through today's engine and render it ($0)
 *   pnpm exec tsx scripts/lecture-lab/home-suggestions.ts render --out .lecture-lab/home-replay
 *
 * `judged.json` maps each question to `{ "verdict": "right" | "text_only_honest", "by": "...", "note": "..." }`,
 * written after looking at the PNGs. Questions without a verdict are not recorded.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSceneSvg } from "../../../../packages/scene-engine/scripts/lib/renderSceneSvg";
import { labArtifactSlug } from "./diagramEval";
import type { LectureRun } from "./lecturePipeline";
import {
  gradeRound,
  homeSuggestionEvalRows,
  loadOracle,
  ORACLE_PATH,
  RECORDINGS_DIR,
  readRound,
  recordingFromRun,
  replaySelection,
  shownSuggestions,
  signatureDifferences,
  type FigureSignature,
  type HomeSuggestionRecording,
} from "./homeSuggestionCheck";

const here = dirname(fileURLToPath(import.meta.url));

function flag(args: string[], name: string): string | null {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function evalRowsOrExit() {
  const { rows, problems } = homeSuggestionEvalRows(shownSuggestions(), loadOracle(ORACLE_PATH));
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  return rows;
}

function writeSvg(path: string, selection: ReturnType<typeof replaySelection>, title: string, subtitle: string): boolean {
  const scene = selection.representation?.renderScene;
  if (!scene) return false;
  writeFileSync(path, renderSceneSvg(scene, { title, subtitle, guides: false }));
  return true;
}

function rasterize(dir: string): void {
  execFileSync("node", [join(here, "svg2png.mjs"), dir], { stdio: "inherit" });
}

function labOutcome(run: LectureRun): Partial<FigureSignature> {
  return {
    drawn: run.diagram.committed,
    figureSource: run.diagram.committed ? run.diagram.figureSource : "text_only",
    tier: run.diagram.tier ?? null,
    family: run.diagram.family ?? null,
    entityIds: [...run.diagram.entityIds].sort(),
  };
}

function command(args: string[]): void {
  const [verb, ...rest] = args;
  if (verb === "eval") {
    const out = flag(rest, "out");
    if (!out) throw new Error("eval needs --out <file.jsonl>");
    const rows = evalRowsOrExit();
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    console.log(`${rows.length} shown suggestions -> ${out}`);
    return;
  }
  if (verb === "report") {
    const round = rest[0];
    if (!round) throw new Error("report needs a round folder");
    const rows = evalRowsOrExit();
    const graded = gradeRound(rows, readRound(round));
    const figures = join(round, "home-figures");
    mkdirSync(figures, { recursive: true });
    const lines = [
      "| # | subject | figure need | teaches | draws | tier | source | family | note | question |",
      "| - | - | - | - | - | - | - | - | - | - |",
    ];
    for (const [index, row] of graded.entries()) {
      lines.push(`| ${index + 1} | ${row.subject} | ${row.figureNeed} | ${row.teaches ? "yes" : "NO"} | ${row.draws ? "yes" : "no"} | ${row.tier ?? ""} | ${row.figureSource ?? ""} | ${row.family ?? ""} | ${row.teachNote}${row.emptyCause && !row.draws ? `; ${row.emptyCause}` : ""} | ${row.question} |`);
      if (!row.draws || !row.runFile) continue;
      const run = JSON.parse(readFileSync(row.runFile, "utf8"));
      const recording = recordingFromRun(run, row.runFile, { verdict: "right", by: "unjudged", note: "" }, row.question);
      const selection = replaySelection(recording);
      writeSvg(join(figures, `${String(index + 1).padStart(2, "0")}-${labArtifactSlug(rows[index]!.id)}.svg`), selection,
        rows[index]!.question.slice(0, 100), `${row.figureSource} ${row.tier} ${row.family ?? ""}`);
    }
    const table = lines.join("\n") + "\n";
    writeFileSync(join(round, "home-suggestions.md"), table);
    process.stdout.write(table);
    const teaches = graded.filter((row) => row.teaches).length;
    const needs = graded.filter((row) => row.figureNeed !== "none");
    console.log(`teaches ${teaches}/${graded.length}; figure cards drawing ${needs.filter((row) => row.draws).length}/${needs.length}`);
    if (readdirSync(figures).some((file) => file.endsWith(".svg"))) rasterize(figures);
    return;
  }
  if (verb === "record") {
    const round = rest[0];
    const judgementsPath = flag(rest, "judgements");
    if (!round || !judgementsPath) throw new Error("record needs a round folder and --judgements <file.json>");
    const judgements = JSON.parse(readFileSync(judgementsPath, "utf8")) as Record<string, HomeSuggestionRecording["judged"]>;
    const runs = readRound(round);
    mkdirSync(RECORDINGS_DIR, { recursive: true });
    let failed = false;
    for (const row of evalRowsOrExit()) {
      const judged = judgements[row.question];
      const hit = runs.get(row.id);
      if (!judged || !hit) continue;
      const recording = recordingFromRun(hit.run, `${round.replace(/^.*\.lecture-lab\//, ".lecture-lab/")}/runs/${hit.file.split("/").pop()}`, judged, row.question);
      // The replay must reproduce what the lab showed, or the gate would guard a different figure.
      const lab = labOutcome(hit.run);
      const differences = signatureDifferences({ ...recording.expected, ...lab }, recording.expected);
      if (differences.length > 0) {
        console.error(`replay differs from the lab for ${row.question}: ${differences.join("; ")}`);
        failed = true;
        continue;
      }
      if (judged.verdict === "right" && !recording.expected.drawn) {
        console.error(`judged right but nothing drew: ${row.question}`);
        failed = true;
        continue;
      }
      const path = join(RECORDINGS_DIR, `${labArtifactSlug(row.id)}.json`);
      writeFileSync(path, JSON.stringify(recording, null, 1) + "\n");
      console.log(`recorded ${judged.verdict} ${recording.expected.drawn ? recording.expected.figureSource : "text_only"} -> ${path}`);
    }
    if (failed) process.exit(1);
    return;
  }
  if (verb === "render") {
    const out = flag(rest, "out") ?? ".lecture-lab/home-replay";
    mkdirSync(out, { recursive: true });
    for (const row of evalRowsOrExit()) {
      const path = join(RECORDINGS_DIR, `${labArtifactSlug(row.id)}.json`);
      if (!existsSync(path)) {
        console.log(`no recording: ${row.question}`);
        continue;
      }
      const recording = JSON.parse(readFileSync(path, "utf8")) as HomeSuggestionRecording;
      const selection = replaySelection(recording);
      const drew = writeSvg(join(out, `${labArtifactSlug(row.id)}.svg`), selection, row.question.slice(0, 100),
        `${selection.representation?.figureSource ?? "text_only"} ${selection.representation?.tier ?? ""}`);
      console.log(`${drew ? "drew" : "text only"}: ${row.question}`);
    }
    if (readdirSync(out).some((file) => file.endsWith(".svg"))) rasterize(out);
    return;
  }
  throw new Error("usage: home-suggestions.ts eval --out <file> | report <round> | record <round> --judgements <file> | render [--out <dir>]");
}

command(process.argv.slice(2));
