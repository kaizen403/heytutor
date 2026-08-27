/**
 * Offline live-compile harness for the question bank.
 *
 * Name-check coverage (`verify-syllabus-corpus.ts`) only proves a unit's demand
 * list is a subset of the capability manifest. This script runs the same
 * family-synthesis path lectures use after a scene-planner timeout:
 *   inferSceneCapabilities → synthesizeFamilyScene → synthesizeLastResortScene
 *
 * The bank is an oracle. Runtime never looks up question id or topic id.
 * No LLM. Corpus files are local/gitignored; a missing corpus skips the gate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inferSceneCapabilities,
  isQualitativeConceptQuestion,
  qualitativeQuestionAllowsScene,
} from "../../../tutor-core/src/planners/sceneCapabilities.ts";
import {
  synthesizeFamilyScene,
  synthesizeLastResortScene,
} from "../../src/synthesize/familyScene.ts";

interface BankQuestion {
  question_id: string;
  text?: string;
}

interface SyllabusAssignment {
  question_id: string;
  status: string;
  subject?: string | null;
  primary_unit_id?: string | null;
  primary_topic_id?: string | null;
  confidence?: string | null;
}

/** Same diagram-led units as verify-syllabus-corpus UNIT_DEMAND, plus remaining Physics units we discover here. */
const DIAGRAM_LED_UNITS = new Set([
  "maths|7", "maths|8", "maths|9", "maths|10", "maths|11", "maths|12", "maths|14",
  "physics|2", "physics|3", "physics|4", "physics|5",
  "physics|6", "physics|7", "physics|8", "physics|9", "physics|10",
  "physics|11", "physics|12", "physics|13", "physics|14",
  "physics|15", "physics|16", "physics|17", "physics|18", "physics|19", "physics|20",
]);

/** Physics units certified in this pass (bank-volume order, then mechanics tighten). */
const CERTIFY_PHYSICS_UNITS = [
  "physics|16",
  "physics|11",
  "physics|14",
  "physics|13",
  "physics|12",
  "physics|5",
  "physics|10",
  "physics|6",
  "physics|7",
  "physics|8",
  "physics|9",
  "physics|15",
  "physics|17",
  "physics|18",
  "physics|19",
  "physics|20",
  "physics|2",
  "physics|3",
  "physics|4",
] as const;

/**
 * Required-miss ceiling per certified Physics unit. Misses are visualizable
 * stems that are not honest text-only and still produce no ink.
 * Unit 1 (dimensions) is excluded from DIAGRAM_LED on purpose.
 */
const PHYSICS_MISS_RATE_CEILING: Record<string, number> = {
  "physics|2": 0.12,
  "physics|3": 0.12,
  "physics|4": 0.12,
  "physics|5": 0.12,
  "physics|6": 0.2,
  "physics|7": 0.25,
  "physics|8": 0.15,
  "physics|9": 0.3,
  "physics|10": 0.15,
  "physics|11": 0.05,
  "physics|12": 0.1,
  "physics|13": 0.05,
  "physics|14": 0.03,
  "physics|15": 0.08,
  "physics|16": 0.05,
  "physics|17": 0.12,
  "physics|18": 0.2,
  "physics|19": 0.04,
  "physics|20": 0.35,
};

const NON_ASCII_HEAVY = /[^\x00-\x7F]/g;

const DIAGRAM_CUE =
  /\b(figure|diagram|graph|curve|plot|shown|shown in|circuit|ray|lens|mirror|prism|incline|slope|tangent|normal to|parabola|ellipse|hyperbola|circle|triangle|vector|field|trajectory|projectile|pendulum|wave|interference|diffraction)\b/i;

/** Offline cluster tags for the miss work-list. Never used at runtime. */
const CLUSTER_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?:lens|mirror|prism|refract|reflect|optical fibr|huygens|slit|fringe|diffraction|polar)/i, "ray_path"],
  [/(?:circuit|resistor|inductor|capacitor|wheatstone|galvanometer|\bemf\b|\bLCR\b)/i, "circuit_network"],
  [/(?:charge|coulomb|gauss|dipole|electric field|magnetic field|solenoid|toroid)/i, "point_field"],
  [/(?:incline|pulley|friction|torque|rolling|projectile|pendulum|collision)/i, "contact_body"],
  [/(?:y\s*=|parametric|tangent|parabola|ellipse|hyperbola)/i, "analytic_curve"],
  [/(?:p[-–]?v|isothermal|adiabatic|v-t graph|s-t graph)/i, "state_plot"],
  [/(?:vector|resultant|river|rain falls)/i, "vector_diagram"],
  [/(?:photoelectric|bohr|energy level|energy band|hydrogen|depletion|solar cell)/i, "energy_level"],
  [/(?:hydraulic|venturi|bernoulli|capillary)/i, "fluid_apparatus"],
  [/(?:cylinder|cone|frustum|hemisphere)/i, "solid_figure"],
];

function isEnglishEnough(text: string): boolean {
  if (text.length < 30) return false;
  const nonAscii = text.match(NON_ASCII_HEAVY)?.length ?? 0;
  return nonAscii / text.length < 0.25;
}

function isGarbledOcr(text: string): boolean {
  if ((text.match(/\$/g) ?? []).length >= 6) return true;
  if (/(?:Ho\$|\{bE|·¤|ÅtkZ|AmnH\$mo|Xem©E|feat ser arafea|ItemCode:|Topic Name:Physics)/i.test(text)) {
    return true;
  }
  return /(?:[²¬¾µŸ¯®×•‹†´»]{4,})/.test(text);
}

function isFigureAbsentWithoutApparatus(text: string): boolean {
  const stem = text.replace(/\s+/g, " ");
  const absent = /\b(?:shown in the figure|as shown in the figure|the figure shows|figure shows)\b/i.test(stem)
    || /(?:equivalent capacitance of the combination shown|effective capacitance of the network.{0,80}shown)/i.test(stem);
  if (!absent) return false;
  return !/(?:microscope|telescope|met(?:er|re) bridge|wheatstone|metal sheets|conducting walls|horizontal metal plates|parallel[- ]plate|upper wire|lens|mirror|prism|incline|pendulum)/i.test(stem);
}

function isDiagramWorthy(text: string, unit: string): boolean {
  if (!DIAGRAM_LED_UNITS.has(unit)) return false;
  return DIAGRAM_CUE.test(text);
}

function explicitVisualRequest(text: string): boolean {
  return /\b(?:draw|diagram|illustrat(?:e|ion)|sketch|construct|plot|graph|locate|mark|show)\b/i.test(text);
}

function isHonestTextOnly(text: string): boolean {
  if (isFigureAbsentWithoutApparatus(text)) return true;
  if (explicitVisualRequest(text)) return false;
  if (isQualitativeConceptQuestion(text) && !qualitativeQuestionAllowsScene(text)) return true;
  return /\b(?:dimensional formula|dimensions of|have different dimensions|what is the SI unit|define the term)\b/i.test(text)
    && !/(?:lens|mirror|circuit|incline|pendulum|projectile|slit)/i.test(text);
}

function clusterOf(text: string, families: readonly string[]): string {
  if (families[0]) return families[0];
  for (const [pattern, name] of CLUSTER_HINTS) {
    if (pattern.test(text)) return `unmatched:${name}`;
  }
  return "unmatched:other";
}

interface RowResult {
  question_id: string;
  subject: string;
  unit: string;
  topic_id: string | null;
  visualizable: boolean;
  honest_text_only: boolean;
  inferred_families: string[];
  family: string | "none";
  mode: string;
  primitive_count: number;
  compile_path: "exact" | "last_resort" | "none";
  fatal_codes: string[];
  cluster: string;
  required_miss: boolean;
  stem_preview: string;
}

interface UnitStats {
  visualizable: number;
  honest_text_only: number;
  scenes: number;
  required_misses: number;
}

function emptyStats(): UnitStats {
  return { visualizable: 0, honest_text_only: 0, scenes: 0, required_misses: 0 };
}

function preview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function main(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const questionsPath = resolve(repoRoot, "data/question-bank/build/questions.all.jsonl");
  const syllabusPath = resolve(repoRoot, "data/question-bank/build/question-syllabus.jsonl");
  const reportDir = resolve(repoRoot, "data/question-bank/reports/coverage");
  const reportDate = "2026-08-27";
  const reportPath = resolve(reportDir, `bank-family-compile-${reportDate}.json`);

  if (!existsSync(questionsPath) || !existsSync(syllabusPath)) {
    console.log(
      "verify-bank-family-compile: corpus not built locally; skipping "
        + "(run tools/question-bank build_corpus.py + build_syllabus_index.py to enable).",
    );
    return;
  }

  const assignmentById = new Map<string, SyllabusAssignment>();
  for (const line of readFileSync(syllabusPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const assignment = JSON.parse(line) as SyllabusAssignment;
    assignmentById.set(assignment.question_id, assignment);
  }

  const rows: RowResult[] = [];
  for (const line of readFileSync(questionsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const question = JSON.parse(line) as BankQuestion;
    const assignment = assignmentById.get(question.question_id);
    if (!assignment || assignment.status !== "classified") continue;
    const subjectRaw = assignment.subject ?? "";
    const unit = assignment.primary_unit_id ?? "";
    const subject = unit.startsWith("physics|")
      ? "physics"
      : unit.startsWith("maths|")
        ? "maths"
        : subjectRaw.toLowerCase().startsWith("phys")
          ? "physics"
          : subjectRaw.toLowerCase().startsWith("math")
            ? "maths"
            : "";
    if (subject !== "physics" && subject !== "maths") continue;
    const text = question.text ?? "";
    if (!isEnglishEnough(text)) continue;
    if (isGarbledOcr(text)) continue;
    if (!isDiagramWorthy(text, unit)) continue;

    const capabilities = inferSceneCapabilities(text);
    const honestTextOnly = isHonestTextOnly(text);
    const exact = synthesizeFamilyScene({
      question: text,
      families: capabilities.families,
    });
    const lastResort = exact ? null : synthesizeLastResortScene({
      question: text,
      families: capabilities.families,
    });
    const synthesized = exact ?? lastResort;
    const primitives = synthesized?.renderScene.primitives.length ?? 0;
    const mode = synthesized?.document.visualDecision.mode ?? "none";
    const fatalCodes = synthesized
      ? synthesized.validationReport.issues
        .filter((issue) => issue.severity === "fatal")
        .map((issue) => issue.code)
      : [];
    const compiled = Boolean(synthesized && mode === "scene" && primitives > 0);
    const requiredMiss = !honestTextOnly && !compiled;

    rows.push({
      question_id: question.question_id,
      subject,
      unit,
      topic_id: assignment.primary_topic_id ?? null,
      visualizable: true,
      honest_text_only: honestTextOnly,
      inferred_families: capabilities.families,
      family: synthesized?.family ?? "none",
      mode,
      primitive_count: primitives,
      compile_path: exact ? "exact" : lastResort ? "last_resort" : "none",
      fatal_codes: fatalCodes,
      cluster: clusterOf(text, capabilities.families),
      required_miss: requiredMiss,
      stem_preview: preview(text),
    });
  }

  const byUnit = new Map<string, UnitStats>();
  const bySubject = new Map<string, UnitStats>();
  const clusterMisses = new Map<string, RowResult[]>();
  for (const row of rows) {
    const unitStats = byUnit.get(row.unit) ?? emptyStats();
    unitStats.visualizable += 1;
    if (row.honest_text_only) unitStats.honest_text_only += 1;
    if (!row.required_miss && !row.honest_text_only) unitStats.scenes += 1;
    if (row.required_miss) unitStats.required_misses += 1;
    byUnit.set(row.unit, unitStats);

    const subjectStats = bySubject.get(row.subject) ?? emptyStats();
    subjectStats.visualizable += 1;
    if (row.honest_text_only) subjectStats.honest_text_only += 1;
    if (!row.required_miss && !row.honest_text_only) subjectStats.scenes += 1;
    if (row.required_miss) subjectStats.required_misses += 1;
    bySubject.set(row.subject, subjectStats);

    if (row.required_miss) {
      const bucket = clusterMisses.get(row.cluster) ?? [];
      if (bucket.length < 8) bucket.push(row);
      clusterMisses.set(row.cluster, bucket);
    }
  }

  const clusterCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.required_miss) continue;
    clusterCounts.set(row.cluster, (clusterCounts.get(row.cluster) ?? 0) + 1);
  }

  const physics = bySubject.get("physics") ?? emptyStats();
  const maths = bySubject.get("maths") ?? emptyStats();

  const unitReport = Object.fromEntries(
    [...byUnit.entries()]
      .sort((a, b) => b[1].visualizable - a[1].visualizable)
      .map(([unit, stats]) => {
        const required = Math.max(0, stats.visualizable - stats.honest_text_only);
        const missRate = required === 0 ? 0 : stats.required_misses / required;
        return [unit, { ...stats, required, miss_rate: Number(missRate.toFixed(4)) }];
      }),
  );

  const report = {
    schema: "bank-family-compile/v1",
    generated: new Date().toISOString(),
    note: "Does not overwrite syllabus-capability-coverage-*.json. Bank is an oracle; runtime never keys on question id.",
    totals: {
      visualizable: rows.length,
      physics,
      maths,
    },
    by_unit: unitReport,
    miss_clusters: Object.fromEntries(
      [...clusterCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([cluster, count]) => [
          cluster,
          {
            count,
            samples: (clusterMisses.get(cluster) ?? []).map((row) => ({
              question_id: row.question_id,
              unit: row.unit,
              families: row.inferred_families,
              preview: row.stem_preview,
            })),
          },
        ]),
    ),
    required_misses: rows
      .filter((row) => row.required_miss && row.subject === "physics")
      .slice(0, 80)
      .map((row) => ({
        question_id: row.question_id,
        unit: row.unit,
        cluster: row.cluster,
        families: row.inferred_families,
        preview: row.stem_preview,
      })),
  };

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("verify-bank-family-compile: live family compile");
  console.log(`  visualizable=${rows.length} physics_scenes=${physics.scenes} physics_misses=${physics.required_misses} maths_scenes=${maths.scenes} maths_misses=${maths.required_misses}`);
  const unitOrder = [...CERTIFY_PHYSICS_UNITS, ...[...byUnit.keys()].filter((unit) => !unit.startsWith("physics|"))];
  const seen = new Set<string>();
  for (const unit of [...unitOrder, ...byUnit.keys()]) {
    if (seen.has(unit)) continue;
    seen.add(unit);
    const stats = byUnit.get(unit);
    if (!stats) continue;
    const required = Math.max(0, stats.visualizable - stats.honest_text_only);
    console.log(
      `  ${unit}: scenes=${stats.scenes} / visualizable=${stats.visualizable} / required-misses=${stats.required_misses} (required=${required})`,
    );
  }
  console.log(`  report=${reportPath}`);

  const gateFailures: string[] = [];
  for (const unit of CERTIFY_PHYSICS_UNITS) {
    const stats = byUnit.get(unit);
    if (!stats) continue;
    const required = Math.max(0, stats.visualizable - stats.honest_text_only);
    if (required < 8) continue;
    const missRate = stats.required_misses / required;
    const ceiling = PHYSICS_MISS_RATE_CEILING[unit] ?? 0.25;
    if (missRate > ceiling) {
      gateFailures.push(
        `${unit}: miss_rate=${missRate.toFixed(3)} > ceiling=${ceiling} (misses=${stats.required_misses}/${required})`,
      );
    }
  }
  if (gateFailures.length > 0) {
    console.log("verify-bank-family-compile: PHYSICS MISS-RATE GATE FAILED");
    for (const failure of gateFailures) console.log(`  ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("verify-bank-family-compile: physics miss-rate gates passed");
}

main();
