/** Offline opening-byte parity and prefetch-launch opportunities from saved runs. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { verifiedDiagramHasDrawableInk, type TutorSegment } from "@heytutor/drawing";
import { prepareLessonOpening } from "../../features/tutor-session/lib/turn/lessonOpeningPreparation";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import type { LectureRun } from "../lecture-lab/lecturePipeline";

class ReplayFailure extends Error {}
function check(condition: unknown, safeMessage: string): asserts condition {
  if (!condition) throw new ReplayFailure(safeMessage);
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const serializedHash = (value: unknown) => hash(JSON.stringify(value));
const languages = ["english", "hinglish"] as const;

function argumentsFrom(argv: string[]) {
  let records: string | undefined;
  let lessons: string | undefined;
  let out: string | undefined;
  let mutateOpening = false;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--mutate-opening") mutateOpening = true;
    else if (flag === "--records" || flag === "--lessons" || flag === "--out") {
      const value = argv[++index];
      check(value && !value.startsWith("--"), "missing_cli_value");
      if (flag === "--records") records = value;
      else if (flag === "--lessons") lessons = value;
      else out = value;
    } else throw new ReplayFailure("unknown_cli_argument");
  }
  check(records, "--records DIR is required and must contain saved lecture runs");
  const directory = existsSync(join(records, "runs")) ? join(records, "runs") : records;
  return { directory: resolve(directory), lessons: lessons ? resolve(lessons) : null,
    out: out ? resolve(out) : null, mutateOpening };
}

function statistics(values: number[]) {
  const sorted = [...values].sort((first, second) => first - second);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return { n: sorted.length, sum, mean: sorted.length ? sum / sorted.length : null,
    median: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2 : null,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? null,
    min: sorted[0] ?? null, max: sorted.at(-1) ?? null };
}

function main() {
  const options = argumentsFrom(process.argv.slice(2));
  let filenames = readdirSync(options.directory).filter((name) => name.endsWith(".json")).sort();
  check(filenames.length > 0, "recordings_directory_is_empty");
  if (options.lessons) {
    const manifest = readFileSync(options.lessons, "utf8").trim().split("\n")
      .filter(Boolean).map((line) => JSON.parse(line) as { id: string });
    const byId = new Map(filenames.map((filename) => {
      const run = JSON.parse(readFileSync(join(options.directory, filename), "utf8")) as LectureRun;
      return [run.probeId, filename];
    }));
    check(manifest.length === filenames.length && byId.size === filenames.length,
      "manifest_must_map_every_recording_once");
    check(new Set(manifest.map((lesson) => lesson.id)).size === manifest.length, "duplicate_manifest_id");
    filenames = manifest.map((lesson) => {
      const filename = byId.get(lesson.id);
      check(filename, "manifest_recording_missing");
      return filename;
    });
  }
  let openingComparisons = 0;
  let promptComparisons = 0;
  let mutations = 0;
  const rows = filenames.map((filename, index) => {
    const safeId = `L${String(index + 1).padStart(2, "0")}`;
    const path = join(options.directory, filename);
    const originalBytes = readFileSync(path);
    const run = JSON.parse(originalBytes.toString("utf8")) as LectureRun;
    const frozenPayloadHash = serializedHash(run);
    const replay = run.figureReplayInputs;
    check(replay?.schemaVersion === "lecture-figure-replay-inputs/v1", `${safeId}:missing_full_replay_inputs`);
    check(!run.isDsa && run.figureOnly === false, `${safeId}:requires_full_non_dsa_lesson`);
    check(typeof run.question === "string" && run.question.length > 0, `${safeId}:missing_question`);
    check(replay.selection.question === run.question && replay.selection.turnPlan, `${safeId}:question_or_plan_mismatch`);
    const stages = run.timings.stages;
    check(stages && Number.isFinite(run.timings.planMs), `${safeId}:missing_stage_timings`);
    const selected = selectProductionScene(replay.selection).representation;
    const authorityStatus = replay.authority?.audit.status ?? null;
    const authorityPreparationAllowed = !replay.authorityAttempted
      || (replay.authority !== null && authorityStatus !== "contradiction");
    const variants = languages.map((narrationLanguage) => {
      const presentation = selected ? buildVerifiedDiagramPresentation(selected.sceneDocument, selected.renderScene, {
        narrationLanguage, ...(selected.family ? { figureFamily: selected.family } : {}),
      }) : null;
      const actualAddon = presentation && verifiedDiagramHasDrawableInk(presentation.diagram)
        ? presentation.diagram.promptAddon : null;
      const input = { question: run.question, turnPlan: replay.selection.turnPlan,
        solverProjection: replay.authority?.projection ?? null, codeLesson: null, isDsa: false,
        familiarity: run.familiarity, fastMode: true, narrationLanguage, diagramPromptAddon: actualAddon };
      const questionOnly = prepareLessonOpening({ question: run.question, narrationLanguage });
      const settled = authorityPreparationAllowed ? prepareLessonOpening({ question: run.question,
        narrationLanguage, turnPlan: replay.selection.turnPlan, authoritySettled: true }) : null;
      let prepared: TutorSegment | null = questionOnly ?? settled;
      if (options.mutateOpening && mutations === 0 && prepared) {
        prepared = { ...prepared, narration: `${prepared.narration} mutated` };
        mutations++;
      }
      // The real selected presentation and both possible work-area widths are checked.
      // The truthy marker only selects the narrow width; it is never rendered or sent.
      const addons = [actualAddon, null, actualAddon || "offline narrow-work-area parity marker"];
      const openingHashes = addons.map((diagramPromptAddon) => {
        const before = buildTurnTeachingPrompt({ ...input, diagramPromptAddon });
        const beforeHash = serializedHash(before);
        for (const candidate of [questionOnly, settled, prepared]) {
          if (!candidate) continue;
          check(JSON.stringify(candidate) === JSON.stringify(before.openingSegment), `${safeId}:opening_bytes_changed`);
          openingComparisons++;
        }
        const after = buildTurnTeachingPrompt({ ...input, diagramPromptAddon });
        check(beforeHash === serializedHash(after), `${safeId}:final_prompt_payload_changed`);
        promptComparisons++;
        return serializedHash(before.openingSegment);
      });
      const blockedByAuthority = authorityStatus === "contradiction";
      const stage = blockedByAuthority ? "blocked_by_authority"
        : questionOnly ? "question" : settled ? "settled_authority" : "unchanged";
      // All offsets below are scheduling models, not recorded prefetch epochs.
      // Visual-need completion and sync setup are unrecorded, so the settled
      // estimate is only a derived lower endpoint up to the final planning time.
      const joinEstimate = stages.turnPlanMs + (replay.authorityAttempted
        ? Math.max(stages.problemIrMs, run.examplePicker?.elapsedMs ?? 0) : 0);
      const beforeEstimateMs = blockedByAuthority ? null : run.timings.planMs;
      const afterEstimateMs = questionOnly ? 0 : blockedByAuthority ? null
        : stage === "settled_authority" ? Math.min(run.timings.planMs, joinEstimate) : run.timings.planMs;
      const launchOffsetIntervalMs = questionOnly ? [0, 0] : blockedByAuthority ? null
        : stage === "settled_authority" ? [afterEstimateMs, run.timings.planMs] : null;
      const pairedLaunchComparison = beforeEstimateMs !== null && afterEstimateMs !== null;
      const headStartEstimateMs = pairedLaunchComparison ? Math.max(0, beforeEstimateMs - afterEstimateMs) : null;
      return { language: narrationLanguage, stage, openingHashes, replayedFigureCommitted: Boolean(actualAddon),
        pairedLaunchComparison, unpairedUnusedQuestionAttempt: blockedByAuthority && questionOnly !== null,
        questionOnlyOpeningHash: questionOnly ? serializedHash(questionOnly) : null,
        settledOpeningHash: settled ? serializedHash(settled) : null,
        beforePrefetchLaunchOffsetEstimateMs: beforeEstimateMs,
        afterPrefetchLaunchOffsetEstimateMs: afterEstimateMs, afterPrefetchLaunchOffsetIntervalMs: launchOffsetIntervalMs,
        prefetchLaunchHeadStartEstimateMs: headStartEstimateMs,
        prefetchLaunchHeadStartIntervalMs: !pairedLaunchComparison ? null : stage === "unchanged" ? [0, 0]
          : stage === "question" ? [headStartEstimateMs, headStartEstimateMs] : [0, headStartEstimateMs] };
    });
    check(frozenPayloadHash === serializedHash(run), `${safeId}:original_payload_mutated_in_memory`);
    check(hash(originalBytes) === hash(readFileSync(path)), `${safeId}:original_payload_file_changed`);
    return { safeId, payloadSha256: hash(originalBytes), payloadJsonSha256: frozenPayloadHash,
      questionSha256: hash(run.question), authorityStatus, authorityAttempted: replay.authorityAttempted,
      authorityPreparationAllowed, figureCommitted: run.diagram.committed,
      recordedTeachingIsLabOnlyNotLive: authorityStatus === "contradiction",
      timingsMs: { turnPlan: stages.turnPlanMs, problemIR: stages.problemIrMs,
        picker: run.examplePicker?.elapsedMs ?? 0, pickerCriticalPath: run.examplePicker?.criticalPathMs ?? 0,
        scene: stages.scenePlannerMs, planning: run.timings.planMs, teachingContentTtft: run.teaching.ttftMs },
      visualNeedTimingRecorded: false, variants };
  });
  check(!options.mutateOpening || mutations > 0, "mutation_did_not_exercise_an_eligible_opening");
  const summary = { schemaVersion: "opening-preparation-recordings/v1", records: rows.length,
    safeIdOrder: options.lessons ? "manifest_row_order" : "sorted_recording_filenames",
    lessonManifestSha256: options.lessons ? hash(readFileSync(options.lessons)) : null,
    inputFingerprint: hash(rows.map((row) => row.payloadSha256).join("\n")),
    helperSourceSha256: hash(readFileSync(new URL("../../features/tutor-session/lib/turn/lessonOpeningPreparation.ts", import.meta.url))),
    openingComparisons, promptComparisons, payloadHashesUnchanged: rows.length,
    allRecordedLabMetricsMs: { planning: statistics(rows.map((row) => row.timingsMs.planning)),
      teachingContentTtft: statistics(rows.map((row) => row.timingsMs.teachingContentTtft)
        .filter((value): value is number => typeof value === "number")) },
    languages: languages.map((language) => {
      const variants = rows.map((row) => row.variants.find((variant) => variant.language === language)!);
      const paired = variants.filter((variant) => variant.pairedLaunchComparison);
      return { language, questionOnly: variants.filter((variant) => variant.stage === "question").length,
        settledAuthority: variants.filter((variant) => variant.stage === "settled_authority").length,
        blockedByAuthority: variants.filter((variant) => variant.stage === "blocked_by_authority").length,
        unpairedUnusedQuestionAttempts: variants.filter((variant) => variant.unpairedUnusedQuestionAttempt).length,
        unchanged: variants.filter((variant) => variant.stage === "unchanged").length,
        pairedPrefetchComparisons: paired.length,
        estimatedBeforePrefetchLaunchOffsetMs: statistics(paired.map((variant) => variant.beforePrefetchLaunchOffsetEstimateMs!)),
        estimatedAfterPrefetchLaunchOffsetMs: statistics(paired.map((variant) => variant.afterPrefetchLaunchOffsetEstimateMs!)),
        estimatedPrefetchLaunchHeadStartMs: statistics(paired.map((variant) => variant.prefetchLaunchHeadStartEstimateMs!)),
        modeledHeadStartIntervalLowerEndpointMs: statistics(paired.map((variant) => variant.prefetchLaunchHeadStartIntervalMs![0]!)) };
    }),
    solverContradictionRows: rows.filter((row) => row.authorityStatus === "contradiction").map((row) => row.safeId),
    historicalFigureCommitDiffersFromCurrentSelectorRows: rows.filter((row) => row.variants[0]!.replayedFigureCommitted !== row.figureCommitted).map((row) => row.safeId),
    limits: ["Offline replay of frozen historical final plans and scene selection, not a new model or quality run.",
      "Offsets estimate prefetch LAUNCH opportunity only. TTS generation, first PCM, actual first speech, and live first usable teaching step were not recorded.",
      "Before offset is approximated by final planning duration; original prefetch dispatch epoch is absent.",
      "Question-only offset 0 is the planning origin; earlier admission timing is absent.",
      "Settled-authority estimate is TurnPlan plus max(ProblemIR,picker) when authority was attempted, otherwise TurnPlan; unrecorded visual-need tail and sync work prevent an exact epoch.",
      "Settled intervals extend through final planning completion. Unknown/null authority and contradictions cannot enable settled preparation.",
      "Live solver contradictions abort before the normal prefetch: baseline launch is null and there is no paired saving. An earlier question-only attempt, if present, is unused and unpaired. Recorded lab planning/TTFT metrics retain all rows but do not establish live teaching on contradictions.",
      "Historical figure commits may differ from the current stock selector; that difference is reported, not treated as a new quality result. Original inputs remain frozen.",
      "No earlier playback or changes to prompt, plan, or payload are accepted between the preparation OFF/ON comparisons."],
  };
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(`${options.out}.json`, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
    const english = summary.languages[0]!;
    const table = rows.map((row) => {
      const variant = row.variants[0]!;
      return `| ${row.safeId} | ${row.timingsMs.turnPlan} | ${row.timingsMs.problemIR} | ${row.timingsMs.picker} / ${row.timingsMs.pickerCriticalPath} | ${row.timingsMs.scene} | ${variant.stage} | ${variant.beforePrefetchLaunchOffsetEstimateMs ?? "no launch"} | ${variant.afterPrefetchLaunchOffsetEstimateMs ?? "no launch"} | ${variant.prefetchLaunchHeadStartIntervalMs?.join("–") ?? "unpaired"} |`;
    });
    const markdown = ["# Opening prefetch launch replay", "", `${rows.length} frozen recorded payloads; ${openingComparisons} exact opening comparisons; ${promptComparisons} full prompt comparisons. All payload hashes unchanged.`, "",
      `English launch eligibility: ${english.questionOnly} at question stage, ${english.settledAuthority} after settled authority, ${english.blockedByAuthority} blocked by authority. Both English and Hinglish were checked against the stock selected presentation and both work-area widths.`, "",
      `Paired launch comparisons: ${english.pairedPrefetchComparisons}. Estimated median launch offset ${english.estimatedBeforePrefetchLaunchOffsetMs.median} → ${english.estimatedAfterPrefetchLaunchOffsetMs.median} ms. Estimated paired launch head start: median ${english.estimatedPrefetchLaunchHeadStartMs.median} ms, mean ${english.estimatedPrefetchLaunchHeadStartMs.mean} ms, total ${english.estimatedPrefetchLaunchHeadStartMs.sum} ms. These are scheduling opportunities, not audio-ready or speech savings.`, "",
      `All ${rows.length} recorded lab planning/TTFT rows remain in the JSON; solver-contradiction teaching rows are marked lab-only, not live.`, "",
      `Historical/current-selector figure commit differences: ${summary.historicalFigureCommitDiffersFromCurrentSelectorRows.join(", ") || "none"}.`, "",
      ...summary.limits.map((limit) => `- ${limit}`), "", `Milliseconds; intervals are modeled launch head start bounds. Safe IDs use ${summary.safeIdOrder}; no source text is copied.`, "",
      "| ID | TurnPlan | IR | Picker / tail | Scene | Launch stage | Before approx | After estimate | Head start interval |",
      "|---|---:|---:|---:|---:|---|---:|---:|---:|", ...table, "",
      `Input fingerprint: ${summary.inputFingerprint}`, `Helper source hash: ${summary.helperSourceSha256}`, ""].join("\n");
    writeFileSync(`${options.out}.md`, markdown);
  }
  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  // Never dump an assertion object, stack, original question, or prompt text.
  console.error(`verify-opening-preparation-recordings: ${error instanceof ReplayFailure ? error.message : "offline_replay_failed"}`);
  process.exitCode = 1;
}
