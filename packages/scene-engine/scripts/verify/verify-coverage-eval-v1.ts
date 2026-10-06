/**
 * DCP-01 frozen coverage evaluation: coverage-eval/v1 report + regression gate.
 *
 * Freezes an independent evaluation denominator and result schema
 * (exact_verified, qualitative_verified, question_representation, legitimate
 * text-only, coverage gap, source-quality exclusion) with chapter/family/tier
 * breakdowns, separated exclusions, and a deterministic holdout cohort.
 *
 * Frozen oracle vs system under test:
 * - Oracle (frozen, versioned in src/eval/coverageEvalV1.ts): scope, source
 *   quality, diagram need, holdout assignment, picture-demand samples. It
 *   never imports the live manifest, planner, or compiler.
 * - System under test (live): the family-synthesis path lectures use after a
 *   scene-planner timeout (synthesizeFamilyScene -> synthesizeLastResortScene),
 *   plus a persistence/replay round-trip sample (JSON serialize -> re-validate
 *   -> re-compile) and a determinism re-run sample.
 *
 * No success metric is based on ink/primitive counts: primitives>0 is only a
 * non-emptiness guard combined with mode=scene, zero fatal issues, and the
 * engine's own certified tier.
 *
 * Usage:
 *   pnpm --filter @heytutor/scene-engine verify:coverage-eval        # gate run
 *   ... verify:coverage-eval -- --report [path]                      # durable report
 *   ... verify:coverage-eval -- --freeze                             # re-freeze baseline (deliberate only)
 *
 * A plain gate run always writes its full JSON report to the OS temp dir and
 * prints the path; --report writes the durable copy instead. --freeze
 * regenerates fixtures/evaluation/coverage-eval-v1.baseline.json and must be
 * reviewed as a denominator change, never used to green a regression.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COVERAGE_EVAL_VERSION,
  COVERAGE_OUTCOMES,
  TEXT_ONLY_REASONS,
  V1_PICTURE_SAMPLES,
  v1ClassifyPreCompile,
  v1Cohort,
  v1DiagramNeed,
  v1ExplicitVisualRequest,
  v1SourceExclusion,
  type CoverageCohort,
  type CoverageOutcome,
} from "../../src/eval/coverageEvalV1";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";
import {
  synthesizeFamilyScene,
  synthesizeLastResortScene,
} from "../../src/synthesize/familyScene";
import { inferSceneCapabilities } from "../../../tutor-core/src/planners/sceneCapabilities.ts";

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
}

interface EvalRow {
  question_id: string;
  subject: string;
  unit: string;
  cohort: CoverageCohort;
  outcome: CoverageOutcome;
  reason: string;
  tier: string | null;
  family: string | null;
  compile_path: "exact" | "last_resort" | "none";
  fatal_codes: string[];
  picture_defect: string | null;
  label_warnings: number;
  stem_preview: string;
}

interface UnitCounts {
  required: number;
  committed: number;
  gaps: number;
  text_only: number;
  excluded: number;
}

interface BaselineUnit {
  required: number;
  committed: number;
  gaps: number;
  text_only: number;
  excluded: number;
}

interface Baseline {
  version: string;
  corpus: { questions_sha256: string; syllabus_sha256: string; rows: number };
  tuning: Record<string, BaselineUnit>;
  holdout_required: Record<string, number>;
}

function emptyUnit(): UnitCounts {
  return { required: 0, committed: 0, gaps: 0, text_only: 0, excluded: 0 };
}

function preview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function subjectOf(unit: string, subjectRaw: string): string {
  if (unit.startsWith("physics|")) return "physics";
  if (unit.startsWith("maths|")) return "maths";
  const lower = subjectRaw.toLowerCase();
  if (lower.startsWith("phys")) return "physics";
  if (lower.startsWith("math")) return "maths";
  return "";
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../../../..");
  const questionsPath = resolve(repoRoot, "data/question-bank/build/questions.all.jsonl");
  const syllabusPath = resolve(repoRoot, "data/question-bank/build/question-syllabus.jsonl");
  const baselinePath = resolve(here, "../../fixtures/evaluation/coverage-eval-v1.baseline.json");
  const freeze = process.argv.includes("--freeze");
  const reportFlag = process.argv.indexOf("--report");
  const reportOverride = reportFlag === -1 ? undefined : process.argv[reportFlag + 1];
  const durableReportPath = reportFlag === -1
    ? null
    : reportOverride && !reportOverride.startsWith("--")
      ? resolve(reportOverride)
      : resolve(repoRoot, "data/question-bank/reports/coverage/coverage-eval-v1.json");

  if (!existsSync(questionsPath) || !existsSync(syllabusPath)) {
    console.log(
      "verify-coverage-eval-v1: corpus not built locally; skipping "
        + "(run tools/question-bank build_corpus.py + build_syllabus_index.py to enable).",
    );
    return;
  }

  const corpus = {
    questions_sha256: sha256File(questionsPath),
    syllabus_sha256: sha256File(syllabusPath),
    rows: readFileSync(questionsPath, "utf8").split("\n").filter((l) => l.trim()).length,
  };

  const assignmentById = new Map<string, SyllabusAssignment>();
  for (const line of readFileSync(syllabusPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const assignment = JSON.parse(line) as SyllabusAssignment;
    assignmentById.set(assignment.question_id, assignment);
  }

  // --- Self-tests on the frozen oracle (inline synthetic stems; metamorphic) ---
  const selfTests: Array<{ id: string; pass: boolean; detail: string }> = [];
  const check = (id: string, pass: boolean, detail: string): void => {
    selfTests.push({ id, pass, detail });
  };
  {
    const stems = [
      "A projectile is launched with velocity vector v at angle theta. Find the trajectory range.",
      "In the circuit shown, find the equivalent resistance between A and B.",
      "The hyperbola x^2/9 - y^2/4 = 1 has a tangent of slope 2. Find its equation.",
    ];
    const units = ["physics|2", "physics|11", "maths|10"];
    const base = stems.map((s, i) => v1DiagramNeed(s, units[i]!));
    const varied = stems.map((s, i) => v1DiagramNeed(`  ${s.toUpperCase()}  \n`, units[i]!));
    check("need_case_whitespace_invariant", JSON.stringify(base) === JSON.stringify(varied)
      && base.every((n) => n === "required_visual"), JSON.stringify(base));
    const garbled = `${stems[0]} Ho$ {bE ·¤ÅtkZ $$$$$$`;
    check("garbled_injection_excludes", v1SourceExclusion(garbled) === "garbled_ocr",
      String(v1SourceExclusion(garbled)));
    check("explicit_request_requires_visual",
      v1DiagramNeed("Draw the free body diagram of the block on the incline.", "physics|3") === "required_visual",
      "explicit draw forces required_visual");
    check("figure_absent_is_text_only",
      v1DiagramNeed("The equivalent resistance of the combination shown in the figure below is", "physics|11")
        === "figure_absent_without_apparatus", "absent figure without apparatus");
    check("explicit_beats_figure_absent",
      v1DiagramNeed("Draw the combination shown in the figure and mark the currents.", "physics|11") === "required_visual",
      "explicit request wins over figure-absent");
    check("definition_is_text_only",
      v1DiagramNeed("What is the dimensional formula of force?", "physics|2") === "definition_or_units",
      "definition stem");
    check("no_cue_is_unresolved",
      v1DiagramNeed("A body moves with uniform speed along a straight road.", "physics|2") === "need_unresolved",
      "oracle refuses to guess");
    check("holdout_deterministic", v1Cohort("q_stable_id") === v1Cohort("q_stable_id"), v1Cohort("q_stable_id"));
    check("picture_samples_demand_described",
      V1_PICTURE_SAMPLES.every((s) => s.demandDescription.length > 0) && V1_PICTURE_SAMPLES.length === 3,
      V1_PICTURE_SAMPLES.map((s) => s.id).join(","));
  }

  // --- Classify + compile every corpus row ---
  const rows: EvalRow[] = [];
  const outOfScopeReasons = new Map<string, number>();
  const exclusionSamples = new Map<string, EvalRow[]>();
  let pendingCompile = 0;
  for (const line of readFileSync(questionsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const question = JSON.parse(line) as BankQuestion;
    const assignment = assignmentById.get(question.question_id);
    const unit = assignment?.primary_unit_id ?? "";
    const subject = subjectOf(unit, assignment?.subject ?? "");
    const text = question.text ?? "";
    const pre = v1ClassifyPreCompile({
      questionId: question.question_id,
      text,
      status: assignment?.status ?? "missing",
      subject,
      unit,
    });
    if (pre.outcome === "out_of_scope") {
      outOfScopeReasons.set(pre.reason, (outOfScopeReasons.get(pre.reason) ?? 0) + 1);
      continue;
    }
    if (pre.outcome === "source_exclusion") {
      const row: EvalRow = {
        question_id: question.question_id, subject, unit, cohort: pre.cohort,
        outcome: "source_exclusion", reason: pre.reason, tier: null, family: null,
        compile_path: "none", fatal_codes: [], picture_defect: null, label_warnings: 0,
        stem_preview: preview(text),
      };
      rows.push(row);
      const bucket = exclusionSamples.get(pre.reason) ?? [];
      if (bucket.length < 5) bucket.push(row);
      exclusionSamples.set(pre.reason, bucket);
      continue;
    }
    if (pre.outcome === "text_only") {
      // Anti-relabel guard: an explicit visual request can never be text-only.
      if (v1ExplicitVisualRequest(text)) {
        rows.push({
          question_id: question.question_id, subject, unit, cohort: pre.cohort,
          outcome: "coverage_gap", reason: "oracle_violation_explicit_marked_text_only",
          tier: null, family: null, compile_path: "none", fatal_codes: [],
          picture_defect: null, label_warnings: 0, stem_preview: preview(text),
        });
        continue;
      }
      rows.push({
        question_id: question.question_id, subject, unit, cohort: pre.cohort,
        outcome: "text_only", reason: pre.reason, tier: null, family: null,
        compile_path: "none", fatal_codes: [], picture_defect: null, label_warnings: 0,
        stem_preview: preview(text),
      });
      continue;
    }
    pendingCompile += 1;
    // Required-visual: run the live lecture fallback path (exact, then last-resort).
    const capabilities = inferSceneCapabilities(text);
    const exact = synthesizeFamilyScene({ question: text, families: capabilities.families });
    const lastResort = exact
      ? null
      : synthesizeLastResortScene({ question: text, families: capabilities.families });
    const synthesized = exact ?? lastResort;
    const mode = synthesized?.document.visualDecision.mode ?? "none";
    const primitives = synthesized?.renderScene.primitives.length ?? 0;
    const fatalCodes = synthesized
      ? synthesized.validationReport.issues
        .filter((issue) => issue.severity === "fatal")
        .map((issue) => issue.code)
      : [];
    const labelWarnings = synthesized
      ? synthesized.validationReport.issues.filter((issue) =>
        issue.severity === "warning" && issue.code.toLowerCase().includes("label")).length
      : 0;
    const committed = Boolean(synthesized) && mode === "scene" && primitives > 0 && fatalCodes.length === 0;
    if (!committed) {
      const reason = !synthesized
        ? "no_scene_synthesized"
        : mode !== "scene"
          ? "mode_not_scene"
          : primitives === 0
            ? "zero_primitives"
            : "validation_fatal";
      rows.push({
        question_id: question.question_id, subject, unit, cohort: pre.cohort,
        outcome: "coverage_gap", reason: fatalCodes.length > 0 ? `validation_fatal:${fatalCodes[0]}` : reason,
        tier: null,
        family: capabilities.families[0] ?? null,
        compile_path: exact ? "exact" : lastResort ? "last_resort" : "none",
        fatal_codes: fatalCodes, picture_defect: null, label_warnings: 0,
        stem_preview: preview(text),
      });
      continue;
    }
    // Committed: outcome is the engine's own certified tier. Picture-demand
    // samples then check family relevance independently (wrong family on a
    // sampled row is a false certification, not a bigger coverage number).
    const doc = synthesized!.document;
    let pictureDefect: string | null = null;
    for (const sample of V1_PICTURE_SAMPLES) {
      if (sample.match(text) && !sample.demandMet(doc)) {
        pictureDefect = sample.id;
        break;
      }
    }
    rows.push({
      question_id: question.question_id, subject, unit, cohort: pre.cohort,
      outcome: synthesized!.tier, reason: `certified_${synthesized!.tier}`,
      tier: synthesized!.tier, family: synthesized!.family,
      compile_path: exact ? "exact" : "last_resort",
      fatal_codes: [], picture_defect: pictureDefect, label_warnings: labelWarnings,
      stem_preview: preview(text),
    });
  }
  void pendingCompile;

  // --- Schema conformance over every emitted row ---
  {
    const valid = new Set<string>(COVERAGE_OUTCOMES);
    const validTextReasons = new Set<string>(TEXT_ONLY_REASONS);
    let bad = 0;
    for (const row of rows) {
      if (!valid.has(row.outcome) || !row.reason || (row.cohort !== "tuning" && row.cohort !== "holdout")) bad += 1;
      if (row.outcome === "text_only" && !validTextReasons.has(row.reason)) bad += 1;
    }
    check("row_schema_conformance", bad === 0, `${rows.length} rows, ${bad} nonconforming`);
  }

  // --- Persistence/replay + determinism samples (thin vertical slice) ---
  const committedTuning = rows
    .filter((r) => r.cohort === "tuning" && r.tier !== null)
    .sort((a, b) => (a.question_id < b.question_id ? -1 : 1));
  const roundtripSample = committedTuning.slice(0, 40);
  const roundtripFailures: string[] = [];
  const primitiveById = new Map<string, number>();
  for (const row of roundtripSample) {
    const line = findQuestionLine(questionsPath, row.question_id);
    const text = (JSON.parse(line) as BankQuestion).text ?? "";
    const capabilities = inferSceneCapabilities(text);
    const synthesized = synthesizeFamilyScene({ question: text, families: capabilities.families })
      ?? synthesizeLastResortScene({ question: text, families: capabilities.families });
    if (!synthesized) {
      roundtripFailures.push(`${row.question_id}: synthesis not reproducible`);
      continue;
    }
    primitiveById.set(row.question_id, synthesized.renderScene.primitives.length);
    const before = synthesized.renderScene.primitives.length;
    const revived = JSON.parse(JSON.stringify(synthesized.document)) as SceneDocument;
    const validation = validateSceneDocument(revived);
    if (!validation.document) {
      roundtripFailures.push(`${row.question_id}: re-validate failed after JSON round-trip`);
      continue;
    }
    const recompiled = compileSceneDocument(validation.document);
    const after = recompiled.renderScene?.primitives.length ?? -1;
    if (!recompiled.ok || after !== before) {
      roundtripFailures.push(`${row.question_id}: re-compile mismatch before=${before} after=${after}`);
    }
  }
  // Determinism: re-running synthesis on the same stems must agree exactly.
  const determinismSample = committedTuning.slice(0, 25);
  let determinismMismatches = 0;
  for (const row of determinismSample) {
    const expected = primitiveById.get(row.question_id);
    if (expected === undefined) continue;
    const line = findQuestionLine(questionsPath, row.question_id);
    const text = (JSON.parse(line) as BankQuestion).text ?? "";
    const capabilities = inferSceneCapabilities(text);
    const again = synthesizeFamilyScene({ question: text, families: capabilities.families })
      ?? synthesizeLastResortScene({ question: text, families: capabilities.families });
    if (!again || again.tier !== row.tier || again.family !== row.family
      || again.renderScene.primitives.length !== expected) {
      determinismMismatches += 1;
    }
  }

  // --- Aggregates per cohort ---
  interface CohortAgg {
    counts: Record<CoverageOutcome, number>;
    by_unit: Record<string, UnitCounts>;
    by_subject: Record<string, UnitCounts>;
    by_family: Record<string, number>;
    by_tier: Record<string, number>;
    gaps_by_reason: Record<string, number>;
    text_only_by_reason: Record<string, number>;
    excluded_by_reason: Record<string, number>;
  }
  const newAgg = (): CohortAgg => ({
    counts: Object.fromEntries(COVERAGE_OUTCOMES.map((o) => [o, 0])) as Record<CoverageOutcome, number>,
    by_unit: {},
    by_subject: {},
    by_family: {},
    by_tier: {},
    gaps_by_reason: {},
    text_only_by_reason: {},
    excluded_by_reason: {},
  });
  const tuning = newAgg();
  const holdout = newAgg();
  const aggOf = (c: CoverageCohort): CohortAgg => (c === "tuning" ? tuning : holdout);
  const contradictions: EvalRow[] = [];
  let labelWarningScenes = 0;
  for (const row of rows) {
    const agg = aggOf(row.cohort);
    agg.counts[row.outcome] += 1;
    const unit = agg.by_unit[row.unit] ?? (agg.by_unit[row.unit] = emptyUnit());
    const subj = agg.by_subject[row.subject] ?? (agg.by_subject[row.subject] = emptyUnit());
    const bump = (u: UnitCounts): void => {
      if (row.tier) {
        u.required += 1;
        u.committed += 1;
      } else if (row.outcome === "coverage_gap") {
        u.required += 1;
        u.gaps += 1;
      } else if (row.outcome === "text_only") {
        u.text_only += 1;
      } else if (row.outcome === "source_exclusion") {
        u.excluded += 1;
      }
    };
    bump(unit);
    bump(subj);
    if (row.tier) {
      agg.by_tier[row.tier] = (agg.by_tier[row.tier] ?? 0) + 1;
      agg.by_family[row.family ?? "none"] = (agg.by_family[row.family ?? "none"] ?? 0) + 1;
      if (row.picture_defect) contradictions.push(row);
      if (row.label_warnings > 0) labelWarningScenes += 1;
    } else if (row.outcome === "coverage_gap") {
      const key = row.reason.split(":")[0]!;
      agg.gaps_by_reason[key] = (agg.gaps_by_reason[key] ?? 0) + 1;
    } else if (row.outcome === "text_only") {
      agg.text_only_by_reason[row.reason] = (agg.text_only_by_reason[row.reason] ?? 0) + 1;
    } else if (row.outcome === "source_exclusion") {
      agg.excluded_by_reason[row.reason] = (agg.excluded_by_reason[row.reason] ?? 0) + 1;
    }
  }

  const rate = (num: number, den: number): number | null =>
    den === 0 ? null : Number((num / den).toFixed(4));
  const summarize = (agg: CohortAgg): Record<string, unknown> => {
    const required = agg.counts.coverage_gap
      + agg.counts.exact_verified + agg.counts.qualitative_verified + agg.counts.question_representation;
    const committed = agg.counts.exact_verified + agg.counts.qualitative_verified + agg.counts.question_representation;
    const contra = rows.filter((r) => r.tier && r.picture_defect
      && aggOf(r.cohort) === agg).length;
    return {
      required_visual: required,
      committed,
      coverage: rate(committed, required),
      accuracy_committed_without_contradiction: rate(committed - contra, committed),
      contradictions: contra,
      by_tier: agg.by_tier,
    };
  };

  const holdoutFraction = rows.length === 0
    ? 0
    : rows.filter((r) => r.cohort === "holdout").length / rows.length;

  const report = {
    schema: COVERAGE_EVAL_VERSION,
    generated: new Date().toISOString(),
    corpus,
    method_notes: [
      "Oracle (scope/need/quality/holdout/picture-demand) is frozen under coverage-eval/v1 and independent of engine code.",
      "System under test is the live family-synthesis path (exact then last-resort), the lecture fallback after planner timeout.",
      "No success metric uses ink or primitive counts; primitives>0 is a non-emptiness guard with mode=scene and zero fatal issues.",
      "need_unresolved and out-of-unit rows are out_of_scope: excluded from every rate, never counted as text-only success.",
      "Holdout cohort is measured and reported but never part of tuning denominators or ratchets.",
    ],
    self_tests: selfTests,
    tuning: { ...summarize(tuning), by_unit: tuning.by_unit, by_subject: tuning.by_subject, by_family: tuning.by_family },
    holdout: { ...summarize(holdout), by_unit: holdout.by_unit, by_subject: holdout.by_subject, by_family: holdout.by_family },
    holdout_fraction: Number(holdoutFraction.toFixed(4)),
    gaps: {
      tuning_by_reason: tuning.gaps_by_reason,
      holdout_by_reason: holdout.gaps_by_reason,
      samples: rows.filter((r) => r.outcome === "coverage_gap").slice(0, 80).map((r) => ({
        question_id: r.question_id, unit: r.unit, cohort: r.cohort, reason: r.reason,
        family_hint: r.family, preview: r.stem_preview,
      })),
    },
    text_only: { tuning_by_reason: tuning.text_only_by_reason, holdout_by_reason: holdout.text_only_by_reason },
    exclusions: {
      tuning_by_reason: tuning.excluded_by_reason,
      holdout_by_reason: holdout.excluded_by_reason,
      samples: [...exclusionSamples.entries()].flatMap(([reason, bucket]) =>
        bucket.map((r) => ({ reason, question_id: r.question_id, unit: r.unit, preview: r.stem_preview }))),
    },
    out_of_scope_by_reason: Object.fromEntries(outOfScopeReasons),
    accuracy: {
      contradictions: contradictions.map((r) => ({
        sample: r.picture_defect, question_id: r.question_id, unit: r.unit,
        tier: r.tier, family: r.family, preview: r.stem_preview,
      })),
      committed_scenes_with_label_warnings: labelWarningScenes,
    },
    reliability: {
      roundtrip: {
        sampled: roundtripSample.length,
        passed: roundtripSample.length - roundtripFailures.length,
        failures: roundtripFailures,
      },
      determinism: { sampled: determinismSample.length, mismatches: determinismMismatches },
    },
  };

  const reportPath = durableReportPath
    ?? resolve(tmpdir(), `coverage-eval-v1-${corpus.questions_sha256.slice(0, 8)}.json`);
  if (durableReportPath) mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  // --- Baseline freeze / gate ---
  const tuningUnits: Record<string, BaselineUnit> = {};
  for (const [unit, counts] of Object.entries(tuning.by_unit)) tuningUnits[unit] = { ...counts };
  const holdoutRequired: Record<string, number> = {};
  for (const [unit, counts] of Object.entries(holdout.by_unit)) {
    if (counts.required > 0) holdoutRequired[unit] = counts.required;
  }
  if (freeze) {
    const baseline: Baseline = { version: COVERAGE_EVAL_VERSION, corpus, tuning: tuningUnits, holdout_required: holdoutRequired };
    mkdirSync(dirname(baselinePath), { recursive: true });
    // Compact: the frozen fixture must stay small and reviewable.
    writeFileSync(baselinePath, `${JSON.stringify(baseline)}\n`, "utf8");
    console.log(`verify-coverage-eval-v1: baseline frozen at ${baselinePath}`);
    console.log(`  report=${reportPath}`);
    return;
  }

  const failures: string[] = [];
  for (const test of selfTests) {
    if (!test.pass) failures.push(`self-test ${test.id} FAILED: ${test.detail}`);
  }
  if (!existsSync(baselinePath)) {
    failures.push(`missing baseline ${baselinePath} — run once with --freeze after review, then re-run the gate`);
  } else {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
    if (baseline.version !== COVERAGE_EVAL_VERSION) {
      failures.push(`baseline version ${baseline.version} != ${COVERAGE_EVAL_VERSION}`);
    }
    if (baseline.corpus.questions_sha256 !== corpus.questions_sha256
      || baseline.corpus.syllabus_sha256 !== corpus.syllabus_sha256) {
      failures.push("corpus fingerprint drifted since freeze — rebuild inputs changed; review and re-freeze deliberately");
    }
    const allUnits = new Set([...Object.keys(baseline.tuning), ...Object.keys(tuningUnits)]);
    for (const unit of [...allUnits].sort()) {
      const base = baseline.tuning[unit];
      const now = tuningUnits[unit];
      if (!base || !now) {
        failures.push(`denominator drift on ${unit}: baseline=${JSON.stringify(base)} now=${JSON.stringify(now)}`);
        continue;
      }
      // Denominator freeze: required / text_only / excluded must match exactly.
      for (const key of ["required", "text_only", "excluded"] as const) {
        if (base[key] !== now[key]) {
          failures.push(`denominator drift on ${unit}.${key}: baseline=${base[key]} now=${now[key]}`);
        }
      }
      // Ratchet: committed may grow (deliberate improvement), never shrink.
      if (now.committed < base.committed) {
        failures.push(`coverage regression on ${unit}: committed ${now.committed} < baseline ${base.committed}`);
      }
      if (now.gaps > base.gaps) {
        failures.push(`gap regression on ${unit}: gaps ${now.gaps} > baseline ${base.gaps}`);
      }
    }
    const allHoldout = new Set([...Object.keys(baseline.holdout_required), ...Object.keys(holdoutRequired)]);
    for (const unit of [...allHoldout].sort()) {
      if ((baseline.holdout_required[unit] ?? 0) !== (holdoutRequired[unit] ?? 0)) {
        failures.push(`holdout denominator drift on ${unit}: baseline=${baseline.holdout_required[unit] ?? 0} now=${holdoutRequired[unit] ?? 0}`);
      }
    }
  }
  if (contradictions.length > 0) {
    failures.push(`zero-false-certification violated: ${contradictions.length} picture-demand contradiction(s)`);
    for (const row of contradictions.slice(0, 10)) {
      failures.push(`  [${row.picture_defect}] ${row.question_id} ${row.stem_preview}`);
    }
  }
  if (roundtripFailures.length > 0) {
    failures.push(`persistence/replay round-trip failed on ${roundtripFailures.length}/${roundtripSample.length} sampled scenes`);
    for (const failure of roundtripFailures.slice(0, 10)) failures.push(`  ${failure}`);
  }
  if (determinismMismatches > 0) {
    failures.push(`synthesis nondeterminism: ${determinismMismatches}/${determinismSample.length} mismatches`);
  }
  if (holdoutFraction < 0.08 || holdoutFraction > 0.18) {
    failures.push(`holdout fraction ${holdoutFraction.toFixed(4)} outside [0.08, 0.18]`);
  }

  const t = report.tuning as Record<string, unknown>;
  const h = report.holdout as Record<string, unknown>;
  console.log("verify-coverage-eval-v1: frozen denominator report");
  console.log(`  corpus_rows=${corpus.rows} evaluated=${rows.length} out_of_scope=${[...outOfScopeReasons.values()].reduce((a, b) => a + b, 0)}`);
  console.log(`  tuning: required=${t.required_visual} committed=${t.committed} coverage=${t.coverage} accuracy=${t.accuracy_committed_without_contradiction} tiers=${JSON.stringify(t.by_tier)}`);
  console.log(`  holdout: required=${h.required_visual} committed=${h.committed} coverage=${h.coverage} accuracy=${h.accuracy_committed_without_contradiction} tiers=${JSON.stringify(h.by_tier)}`);
  console.log(`  holdout_fraction=${report.holdout_fraction} contradictions=${contradictions.length} label_warning_scenes=${labelWarningScenes}`);
  console.log(`  roundtrip=${report.reliability.roundtrip.passed}/${report.reliability.roundtrip.sampled} determinism_mismatches=${determinismMismatches}`);
  console.log(`  report=${reportPath} (pass --report [path] for a durable copy)`);
  if (failures.length > 0) {
    console.log("verify-coverage-eval-v1: GATE FAILED");
    for (const failure of failures) console.log(`  ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("verify-coverage-eval-v1: gate passed");
}

const lineCache = new Map<string, Map<string, string>>();

function findQuestionLine(questionsPath: string, questionId: string): string {
  let cache = lineCache.get(questionsPath);
  if (!cache) {
    cache = new Map<string, string>();
    for (const line of readFileSync(questionsPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as BankQuestion;
        if (parsed.question_id) cache.set(parsed.question_id, line);
      } catch {
        // ignore malformed lines; main loop already parsed successfully
      }
    }
    lineCache.set(questionsPath, cache);
  }
  const found = cache.get(questionId);
  if (!found) throw new Error(`question ${questionId} not found in corpus`);
  return found;
}

main();
