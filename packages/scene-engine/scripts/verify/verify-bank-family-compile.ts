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
import { sceneDemand } from "../../src/synthesize/sceneDemand.ts";
import type { SceneDocument } from "../../src/types.ts";

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
/**
 * Per-unit ceiling on stems that demand a figure and get none.
 *
 * These are a no-regression ratchet against the honest measurement, not a
 * quality target. Four units were re-baselined upward when the picture-demand
 * check landed: they had been under their old ceilings only because a
 * contradicting canned picture counted as coverage (physics|12 0.10, |13 0.05,
 * |14 0.03, |17 0.12). The `demanded=` column in the per-unit output is the
 * work list; each family built in its unit should let these come back down.
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
  "physics|12": 0.52,
  "physics|13": 0.34,
  "physics|14": 0.08,
  "physics|15": 0.08,
  "physics|16": 0.05,
  "physics|17": 0.66,
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
  const absent = /\b(?:shown in the figure|as shown in the figure|the figure shows|figure shows|shaded region of the circle given below|circle given below)\b/i.test(stem)
    || /(?:given below|as shown below).{0,80}(?:shaded|figure)/i.test(stem)
    || /(?:equivalent capacitance of the combination shown|effective capacitance of the network.{0,80}shown)/i.test(stem)
    // OCR/dropped-article and "diagram" variants of the same figure references.
    // Keep in sync with FIGURE_ABSENT_EXTRA in src/synthesize/familyScene.ts.
    || /(?:\bin the given figure\b|\bas shown in (?:the )?(?:figure|diagram)\b|\bshown in (?:the )?(?:figure|diagram)\b|\bsee (?:the )?figures?\b|\bin the figure\b)/i.test(stem);
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

/**
 * Picture class of a compiled document, read off operators and entity ids/roles
 * only — never the stem. `primitive_count > 0` says nothing about whether the
 * picture is the one the stem demanded; this classification is what lets the
 * sample gate below tell a two-loop network from a resistor chain, river banks
 * from a recycled A/B angle, and a named hyperbola from a guessed circle.
 * Discriminator style mirrors verify-family-synthesis.ts.
 */
type PictureClass =
  | "circuit_two_loop"
  | "river_banks"
  | "space_3d"
  | "implicit_conic"
  | "function_region"
  | "constraint_region"
  | "circle_figure"
  | "function_curves"
  | "vector_ab"
  | "circuit_chain"
  | "other"
  | "none";


/** Independent loops (cyclomatic number) over symbol+connect edges. */
function circuitIndependentLoops(document: SceneDocument): number {
  const nodes = new Set<string>();
  let edges = 0;
  for (const construction of document.constructions) {
    if (construction.operator !== "symbol" && construction.operator !== "connect") continue;
    const pick = (names: string[]): string | null => {
      for (const name of names) {
        const value = construction.inputs[name];
        if (typeof value === "string" && value) return value;
      }
      return null;
    };
    const start = pick(["start", "from", "a"]);
    const end = pick(["end", "to", "b"]);
    if (!start || !end || start === end) continue;
    nodes.add(start);
    nodes.add(end);
    edges += 1;
  }
  if (nodes.size === 0) return 0;
  return edges - nodes.size + 1;
}

function classifyPictureClass(document: SceneDocument | null): PictureClass {
  if (!document) return "none";
  const operators = document.constructions.map((construction) => construction.operator);
  const entityIds = new Set(document.entities.map((entity) => entity.id));
  // A multi-loop network is a topology, not a naming convention and not a
  // source count: a Wheatstone bridge has one cell and is still two loops.
  // Independent loops of a connected graph is edges - nodes + 1, so >= 2 is
  // exactly "more than one current path", which is what separates this from a
  // chain. Edges are read the way topology.ts reads them.
  if (circuitIndependentLoops(document) >= 2) return "circuit_two_loop";
  if (document.entities.some((entity) => /bank/i.test(`${entity.id} ${entity.role}`))) {
    return "river_banks";
  }
  if (operators.includes("space_frame")) return "space_3d";
  if (operators.includes("implicit_curve")) return "implicit_conic";
  if (operators.includes("function_region")) return "function_region";
  if (operators.includes("constraint_region")) return "constraint_region";
  if (operators.includes("circle")) return "circle_figure";
  if (operators.includes("function_curve")) return "function_curves";
  if (
    operators.includes("vector")
    && document.entities.some((entity) => entity.id === "a" && entity.label === "A")
  ) {
    return "vector_ab";
  }
  if (document.constructions.some((construction) =>
    construction.operator === "symbol" && construction.inputs.symbol === "resistor")) {
    return "circuit_chain";
  }
  return "other";
}

/**
 * P0 sample gate: well-known picture-class stems from the bank and the class
 * the stem demands. Stem matching here is an offline test oracle (same role as
 * CLUSTER_HINTS), never runtime coverage. A sampled row that compiled into one
 * of the named `contradictions` — the exact wrong-picture bugs from the issue
 * log (series chain for a Kirchhoff network, generic A/B arrows for a river,
 * a circle or an isometric 3D frame for a hyperbola) — fails the gate. A
 * sampled row compiled into any other class is still flagged in the report and
 * console as a picture-class miss work-list instead of passing silently on
 * primitive_count; those become live-test family-program fixes, not regex.
 */
const PICTURE_CLASS_SAMPLES: ReadonlyArray<{
  id: string;
  expect: PictureClass;
  contradictions: readonly PictureClass[];
  match: (stem: string) => boolean;
}> = [
  {
    id: "kirchhoff_two_loop",
    expect: "circuit_two_loop",
    contradictions: ["circuit_chain"],
    // Anchored to stems whose drawable demand is the network itself; a stem
    // that only cites Kirchhoff for a series/parallel calculation is honestly
    // a chain and stays out of the sample.
    match: (stem) => /kirchhoff/i.test(stem) && /(?:network|loops?|junctions?)/i.test(stem),
  },
  {
    id: "river_banks",
    expect: "river_banks",
    contradictions: ["vector_ab"],
    match: (stem) =>
      !/(?:rain falls|umbrella)/i.test(stem)
      && /(?:\bboat\b|still water)/i.test(stem)
      && /(?:\briver\b|\bcurrent\b|downstream|upstream|still water)/i.test(stem),
  },
  {
    id: "named_hyperbola",
    expect: "implicit_conic",
    contradictions: ["circle_figure", "space_3d"],
    match: (stem) => /\bhyperbola\b/i.test(stem),
  },
];

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
  picture_class: PictureClass;
  compile_path: "exact" | "last_resort" | "none";
  fatal_codes: string[];
  cluster: string;
  required_miss: boolean;
  /** Missed while the stem demanded a specific picture — the Phase-2 work list. */
  miss_with_demand: boolean;
  stem_preview: string;
}

interface UnitStats {
  visualizable: number;
  honest_text_only: number;
  scenes: number;
  required_misses: number;
  misses_with_demand: number;
}

function emptyStats(): UnitStats {
  return { visualizable: 0, honest_text_only: 0, scenes: 0, required_misses: 0, misses_with_demand: 0 };
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
  // Opt-in: a plain gate run must not dirty the tracked report. Pass
  // `--report` (optionally with a path) to regenerate it deliberately.
  const reportFlag = process.argv.indexOf("--report");
  const reportOverride = reportFlag === -1 ? undefined : process.argv[reportFlag + 1];
  const writeReport = reportFlag !== -1;
  const reportPath = reportOverride && !reportOverride.startsWith("--")
    ? resolve(reportOverride)
    : resolve(reportDir, `bank-family-compile-${reportDate}.json`);

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
  const sampleRows = new Map<string, Array<{ row: RowResult; compiled: boolean }>>();
  for (const line of readFileSync(questionsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const question = JSON.parse(line) as BankQuestion;
    const assignment = assignmentById.get(question.question_id);
    const subjectRaw = assignment?.subject ?? "";
    const unit = assignment?.primary_unit_id ?? "";
    const subject = unit.startsWith("physics|")
      ? "physics"
      : unit.startsWith("maths|")
        ? "maths"
        : subjectRaw.toLowerCase().startsWith("phys")
          ? "physics"
          : subjectRaw.toLowerCase().startsWith("math")
            ? "maths"
            : "";
    const text = question.text ?? "";
    if (!isEnglishEnough(text) || isGarbledOcr(text)) continue;
    // Picture-class samples are the wrong-picture oracle, so they are drawn
    // from every readable stem. Restricting them to admitted rows let a sample
    // match nothing and still "pass" — river_banks scored 0 that way, and the
    // one river stem in the bank is `needs_review` with no unit.
    const sampled = PICTURE_CLASS_SAMPLES.filter((sample) => sample.match(text));
    const admitted = assignment?.status === "classified"
      && (subject === "physics" || subject === "maths")
      && isDiagramWorthy(text, unit);
    if (!admitted && sampled.length === 0) continue;

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
    // A stem with a demand that produced nothing is usually a candidate the
    // demand vetoed, i.e. a wrong picture we refused rather than a blind spot.
    const demand = sceneDemand(text);
    const hasDemand = demand.requires.length > 0 || demand.forbids.length > 0;
    const pictureClass = classifyPictureClass(synthesized?.document ?? null);

    const row: RowResult = {
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
      picture_class: pictureClass,
      compile_path: exact ? "exact" : lastResort ? "last_resort" : "none",
      fatal_codes: fatalCodes,
      cluster: clusterOf(text, capabilities.families),
      required_miss: requiredMiss,
      miss_with_demand: requiredMiss && hasDemand,
      stem_preview: preview(text),
    };
    if (admitted) rows.push(row);

    for (const sample of sampled) {
      const bucket = sampleRows.get(sample.id) ?? [];
      bucket.push({ row, compiled });
      sampleRows.set(sample.id, bucket);
    }
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
    if (row.miss_with_demand) unitStats.misses_with_demand += 1;
    byUnit.set(row.unit, unitStats);

    const subjectStats = bySubject.get(row.subject) ?? emptyStats();
    subjectStats.visualizable += 1;
    if (row.honest_text_only) subjectStats.honest_text_only += 1;
    if (!row.required_miss && !row.honest_text_only) subjectStats.scenes += 1;
    if (row.required_miss) subjectStats.required_misses += 1;
    if (row.miss_with_demand) subjectStats.misses_with_demand += 1;
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
    picture_class_samples: Object.fromEntries(
      PICTURE_CLASS_SAMPLES.map((sample) => {
        const entries = sampleRows.get(sample.id) ?? [];
        const compiledEntries = entries.filter((entry) => entry.compiled);
        const wrong = compiledEntries.filter((entry) => entry.row.picture_class !== sample.expect);
        return [sample.id, {
          expect: sample.expect,
          contradiction_classes: sample.contradictions,
          sampled: entries.length,
          compiled: compiledEntries.length,
          correct_class: compiledEntries.length - wrong.length,
          wrong_class: wrong.map((entry) => ({
            question_id: entry.row.question_id,
            unit: entry.row.unit,
            actual_class: entry.row.picture_class,
            contradiction: sample.contradictions.includes(entry.row.picture_class),
            preview: entry.row.stem_preview,
          })),
        }];
      }),
    ),
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

  if (writeReport) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

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
      `  ${unit}: scenes=${stats.scenes} / visualizable=${stats.visualizable} / required-misses=${stats.required_misses} (demanded=${stats.misses_with_demand}) (required=${required})`,
    );
  }
  console.log(`  report=${writeReport ? reportPath : "(not written; pass --report to regenerate)"}`);

  console.log("verify-bank-family-compile: picture-class sample gate");
  const pictureContradictions: string[] = [];
  for (const sample of PICTURE_CLASS_SAMPLES) {
    const entries = sampleRows.get(sample.id) ?? [];
    const compiledEntries = entries.filter((entry) => entry.compiled);
    const wrong = compiledEntries.filter((entry) => entry.row.picture_class !== sample.expect);
    console.log(
      `  ${sample.id}: sampled=${entries.length} compiled=${compiledEntries.length} correct-class=${compiledEntries.length - wrong.length} wrong-class=${wrong.length} not-compiled=${entries.length - compiledEntries.length} (expect=${sample.expect})`,
    );
    // A sample that matches nothing proves nothing; it must not read as a pass.
    if (entries.length === 0) {
      pictureContradictions.push(
        `${sample.id}: matched no stem in the corpus — the sample is vacuous, fix its matcher or remove it`,
      );
      continue;
    }
    for (const entry of entries.filter((candidate) => !candidate.compiled)) {
      console.log(`    [no-picture] ${entry.row.question_id} ${entry.row.stem_preview}`);
    }
    for (const entry of wrong) {
      const contradiction = sample.contradictions.includes(entry.row.picture_class);
      if (contradiction) {
        pictureContradictions.push(
          `${sample.id}: ${entry.row.question_id} compiled as ${entry.row.picture_class} (expected ${sample.expect}) — ${entry.row.stem_preview}`,
        );
      }
      console.log(
        `    [${contradiction ? "CONTRADICTION" : "miss"}] ${entry.row.question_id} actual=${entry.row.picture_class} ${entry.row.stem_preview}`,
      );
    }
  }
  if (pictureContradictions.length > 0) {
    console.log("verify-bank-family-compile: PICTURE-CLASS GATE FAILED");
    for (const failure of pictureContradictions) console.log(`  ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("verify-bank-family-compile: picture-class sample gates passed");

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
