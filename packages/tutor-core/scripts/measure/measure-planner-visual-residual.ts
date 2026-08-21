/**
 * Offline oracle of diagram-worthy stems the deterministic pre-filter leaves
 * as visualRequirement=optional (planner_readiness=ambiguous and
 * questionRequiresVisual=false).
 *
 * DIAGRAM_CUE / CONSTRUCTIVE_CUE / QUALITATIVE_CUE / diagram-led unit ids are
 * copied from packages/scene-engine/scripts/verify/verify-syllabus-corpus.ts as a
 * diagnostic-only classifier. They must not become runtime diagram routing
 * (AGENTS.md rule 6). The runtime pre-filter is imported from turnPlannerV3.
 *
 * Usage:
 *   pnpm --filter @heytutor/tutor-core exec tsx scripts/measure/measure-planner-visual-residual.ts
 *   pnpm --filter @heytutor/tutor-core exec tsx scripts/measure/measure-planner-visual-residual.ts --report <path>
 *
 * Skips with exit 0 when the local corpus jsonl is absent.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import {
  explicitDiagramRequest,
  questionRequiresVisual,
  referencesFigure,
} from "../../src/planners/turnPlannerV3";

/** Diagram-led units from the syllabus harness UNIT_DEMAND (all entries are diagramLed). */
const DIAGRAM_LED_UNITS = new Set([
  "maths|7",
  "maths|8",
  "maths|9",
  "maths|10",
  "maths|11",
  "maths|12",
  "maths|14",
  "physics|2",
  "physics|3",
  "physics|4",
  "physics|5",
  "physics|10",
  "physics|11",
  "physics|12",
  "physics|13",
  "physics|14",
  "physics|16",
]);

const NON_ASCII_HEAVY = /[^\x00-\x7F]/g;

function isEnglishEnough(text: string): boolean {
  if (text.length < 30) return false;
  const nonAscii = text.match(NON_ASCII_HEAVY)?.length ?? 0;
  return nonAscii / text.length < 0.25;
}

const DIAGRAM_CUE =
  /\b(figure|diagram|graph|curve|plot|shown|shown in|circuit|ray|lens|mirror|prism|incline|slope|tangent|normal to|parabola|ellipse|hyperbola|circle|triangle|vector|field|trajectory|projectile|pendulum|wave|interference|diffraction)\b/i;

const CONSTRUCTIVE_CUE =
  /\b(draw|sketch|construct|plot|trace|find the (value|area|length|radius|focal|angle|distance|equation)|calculate|determine the|show that|compute the)\b/i;

const QUALITATIVE_CUE =
  /\b(assertion|reason|which of the following|which of these|correct statement|statement(s)? (is|are)|not true|does not occur|true about)\b/i;

type PlannerReadiness = "constructive" | "qualitative" | "ambiguous";

function classifyPlannerReadiness(text: string): PlannerReadiness {
  const constructive = CONSTRUCTIVE_CUE.test(text);
  const qualitative = QUALITATIVE_CUE.test(text);
  if (constructive && !qualitative) return "constructive";
  if (qualitative && !constructive) return "qualitative";
  if (constructive && qualitative) return "constructive";
  return "ambiguous";
}

interface BankQuestion {
  question_id: string;
  text?: string;
}

interface SyllabusAssignment {
  question_id: string;
  status: string;
  primary_unit_id?: string | null;
}

const STEM_TRUNCATE = 160;

function truncateStem(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= STEM_TRUNCATE) return compact;
  return `${compact.slice(0, STEM_TRUNCATE - 1)}…`;
}

function main(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const questionsPath = resolve(repoRoot, "data/question-bank/build/questions.all.jsonl");
  const syllabusPath = resolve(repoRoot, "data/question-bank/build/question-syllabus.jsonl");
  const defaultReport = resolve(
    repoRoot,
    "data/question-bank/reports/planner-ambiguous-residual-2026-08-19.json",
  );

  if (!existsSync(questionsPath) || !existsSync(syllabusPath)) {
    console.log(
      "measure-planner-visual-residual: corpus not built locally; skipping " +
        "(run build_corpus.py + build_syllabus_index.py to enable).",
    );
    return;
  }

  const assignmentById = new Map<string, SyllabusAssignment>();
  for (const line of readFileSync(syllabusPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const assignment = JSON.parse(line) as SyllabusAssignment;
    assignmentById.set(assignment.question_id, assignment);
  }

  const plannerReadinessCounts: Record<PlannerReadiness, number> = {
    constructive: 0,
    qualitative: 0,
    ambiguous: 0,
  };
  let measured = 0;
  let prefilterRequired = 0;
  let qualitativeFalsePositives = 0;
  const residual: Array<{
    question_id: string;
    unit: string;
    stem_truncated: string;
    cues: {
      explicitDiagramRequest: boolean;
      referencesFigure: boolean;
      qualitativeConcept: boolean;
      inferSceneFamilies: string[];
      questionRequiresVisual: boolean;
    };
  }> = [];

  for (const line of readFileSync(questionsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const question = JSON.parse(line) as BankQuestion;
    const assignment = assignmentById.get(question.question_id);
    if (!assignment || assignment.status !== "classified") continue;
    const unit = assignment.primary_unit_id ?? "";
    const text = question.text ?? "";
    if (!DIAGRAM_LED_UNITS.has(unit)) continue;
    if (!isEnglishEnough(text) || !DIAGRAM_CUE.test(text)) continue;

    measured += 1;
    const readiness = classifyPlannerReadiness(text);
    plannerReadinessCounts[readiness] += 1;
    const requiresVisual = questionRequiresVisual(text);
    if (requiresVisual) prefilterRequired += 1;
    if (readiness === "qualitative" && requiresVisual) qualitativeFalsePositives += 1;
    if (readiness !== "ambiguous" || requiresVisual) continue;

    residual.push({
      question_id: question.question_id,
      unit,
      stem_truncated: truncateStem(text),
      cues: {
        explicitDiagramRequest: explicitDiagramRequest(text),
        referencesFigure: referencesFigure(text),
        qualitativeConcept: QUALITATIVE_CUE.test(text),
        inferSceneFamilies: [...inferSceneCapabilities(text).families],
        questionRequiresVisual: requiresVisual,
      },
    });
  }

  residual.sort((a, b) => a.unit.localeCompare(b.unit) || a.question_id.localeCompare(b.question_id));

  const report = {
    schema: "planner-ambiguous-residual/v1",
    generated: new Date().toISOString(),
    inputs: { questions: questionsPath, syllabus: syllabusPath },
    totals: {
      measured_diagram_worthy: measured,
      planner_readiness: plannerReadinessCounts,
      prefilter_required: prefilterRequired,
      residual_optional_ambiguous: residual.length,
      qualitative_false_positives: qualitativeFalsePositives,
    },
    residual,
  };

  console.log("measure-planner-visual-residual: planner visual-requirement leftover");
  console.log(`  measured=${measured}`);
  console.log(`  planner_readiness=${JSON.stringify(plannerReadinessCounts)}`);
  console.log(`  prefilter_required=${prefilterRequired}`);
  console.log(`  residual_optional_ambiguous=${residual.length}`);
  console.log(`  qualitative_false_positives=${qualitativeFalsePositives}`);

  const reportFlagIndex = process.argv.indexOf("--report");
  const reportPath = reportFlagIndex !== -1 && process.argv[reportFlagIndex + 1]
    ? resolve(process.argv[reportFlagIndex + 1])
    : defaultReport;
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`  report=${reportPath}`);
}

main();
