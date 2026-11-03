/**
 * Home screen suggestion check.
 *
 * A student's first lesson is usually a card we wrote. This module joins every
 * card that can show (`shownHomeSuggestions`) with its hand-written oracle row
 * (`data/home-suggestions/oracle.jsonl`), grades a lab round of those cards,
 * and records each card's accepted figure inputs so the offline gate can replay
 * them through the current engine at $0.
 *
 * The oracle says what a right figure must show. It is written from the
 * question and subject knowledge, never from engine output. The judgement that
 * a recorded figure is right comes from looking at its render; the recording
 * only freezes what was judged, so a later change to that figure fails the gate
 * and has to be judged again.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDiagramYieldPolicy, type DiagramYieldPolicy, type RenderScene } from "@heytutor/scene-engine";
import { shownHomeSuggestions } from "../../lib/account/homeSuggestions";
import type { SubjectId } from "../../lib/account/types";
import {
  deriveSceneGate,
  selectProductionScene,
  validateProductionSceneCandidate,
  type ProductionSceneSelectionInput,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { parseDiagramEvalJsonl, type DiagramEvalRow } from "./diagramEval";
import type { LectureRun } from "./lecturePipeline";

export const HOME_SUGGESTION_RECORDING_VERSION = "home-suggestion-recording/v1";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const ORACLE_PATH = join(repoRoot, "data/home-suggestions/oracle.jsonl");
export const RECORDINGS_DIR = join(repoRoot, "data/home-suggestions/recorded");

export interface HomeSuggestionOracleRow extends DiagramEvalRow {
  answer_facts?: string[];
}

export interface ShownSuggestion {
  subject: SubjectId;
  topic: string;
  kind: string;
  question: string;
}

/** What the board showed, reduced to the parts a student can read. */
export interface FigureSignature {
  drawn: boolean;
  figureSource: string;
  tier: string | null;
  family: string | null;
  entityIds: string[];
  texts: string[];
  /** Exact ink hash: informational, label layout may move it. */
  inkHash: string | null;
}

export interface HomeSuggestionRecording {
  schemaVersion: typeof HOME_SUGGESTION_RECORDING_VERSION;
  question: string;
  /** Where the inputs came from (lab round and run file), for audit. */
  recordedFrom: string;
  /** Human or reviewer verdict on the recorded figure, from its render. */
  judged: { verdict: "right" | "text_only_honest"; by: string; note: string };
  /**
   * The lab's selection inputs, without its saved verdicts: the planner document
   * is validated again and a family figure is rebuilt only if the lab had one.
   */
  selection: Omit<ProductionSceneSelectionInput, "candidate" | "candidateValidation" | "fastRepresentation"> & {
    /** The selected raw planner document. Null when none was planned. */
    candidate: Record<string, unknown> | null;
    rebuildFamilyFigure: boolean;
    /** Validate under the policy the lab ran with, as the live hook does. */
    yieldPolicy: DiagramYieldPolicy;
  };
  expected: FigureSignature;
}

const textOf = (scene: RenderScene | null | undefined): string[] =>
  (scene?.primitives ?? [])
    .flatMap((primitive) =>
      (primitive.kind === "label" || primitive.kind === "dimension") && typeof primitive.text === "string"
        ? [primitive.text.trim()]
        : [],
    )
    .filter(Boolean)
    .sort();

export function figureSignature(selection: ReturnType<typeof selectProductionScene>): FigureSignature {
  const shown = selection.representation;
  if (!shown) {
    return { drawn: false, figureSource: "text_only", tier: null, family: null, entityIds: [], texts: [], inkHash: null };
  }
  return {
    drawn: true,
    figureSource: shown.figureSource,
    tier: shown.tier,
    family: shown.family ?? null,
    entityIds: shown.sceneDocument.entities.map((entity) => entity.id).sort(),
    texts: textOf(shown.renderScene),
    inkHash: createHash("sha1").update(JSON.stringify(shown.renderScene)).digest("hex").slice(0, 12),
  };
}

/**
 * Run a recording through today's engine: the planner document is validated
 * again and the deterministic family figure is rebuilt, so a regression in
 * either path shows up. Nothing here reads the network or the environment.
 */
export function replaySelection(recording: HomeSuggestionRecording): ReturnType<typeof selectProductionScene> {
  const { candidate, rebuildFamilyFigure, yieldPolicy, ...input } = recording.selection;
  const gate = deriveSceneGate(input);
  const fastRepresentation = rebuildFamilyFigure
    ? selectFastVerifiedRepresentation({
        question: input.question,
        turnPlan: gate.turnPlan,
        problemIR: input.problemIR ?? null,
        families: gate.sceneCapabilities.families,
      })
    : null;
  return selectProductionScene({
    ...input,
    candidateValidation: candidate
      ? validateProductionSceneCandidate({
          candidate, question: input.question, turnPlan: gate.turnPlan, yieldPolicy, blockFlowEligible: input.blockFlowEligible,
        })
      : null,
    fastRepresentation,
    requiredRetryEnabled: input.requiredRetryEnabled ?? true,
  });
}

export function replayRecording(recording: HomeSuggestionRecording): FigureSignature {
  return figureSignature(replaySelection(recording));
}

/** Differences a student would see. The ink hash is reported, not compared. */
export function signatureDifferences(expected: FigureSignature, actual: FigureSignature): string[] {
  const differences: string[] = [];
  for (const key of ["drawn", "figureSource", "tier", "family"] as const) {
    if (expected[key] !== actual[key]) differences.push(`${key} ${String(expected[key])} -> ${String(actual[key])}`);
  }
  for (const key of ["entityIds", "texts"] as const) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) {
      const missing = expected[key].filter((item) => !actual[key].includes(item));
      const added = actual[key].filter((item) => !expected[key].includes(item));
      differences.push(`${key} missing [${missing.join(", ")}] added [${added.join(", ")}]`);
    }
  }
  return differences;
}

export function shownSuggestions(): ShownSuggestion[] {
  return shownHomeSuggestions().map(({ subject, topic, kind, question }) => ({
    subject, topic, kind: kind ?? "lecture", question,
  }));
}

export function loadOracle(path: string): HomeSuggestionOracleRow[] {
  return parseDiagramEvalJsonl(readFileSync(path, "utf8")) as HomeSuggestionOracleRow[];
}

/**
 * The evaluation set for one round: every shown card, in display order, with
 * its oracle row. A card without an oracle row, or an oracle row for a card
 * that no longer shows, is an error rather than a silent skip.
 */
export function homeSuggestionEvalRows(
  shown: readonly ShownSuggestion[],
  oracle: readonly HomeSuggestionOracleRow[],
): { rows: HomeSuggestionOracleRow[]; problems: string[] } {
  const byQuestion = new Map(oracle.map((row) => [row.question, row]));
  const problems: string[] = [];
  const rows: HomeSuggestionOracleRow[] = [];
  for (const card of shown) {
    const row = byQuestion.get(card.question);
    if (!row) {
      problems.push(`no oracle row for shown suggestion: ${card.question}`);
      continue;
    }
    if (row.subject !== card.subject) problems.push(`oracle subject ${row.subject} != card subject ${card.subject}: ${card.question}`);
    rows.push(row);
  }
  const shownQuestions = new Set(shown.map((card) => card.question));
  for (const row of oracle) {
    if (!shownQuestions.has(row.question)) problems.push(`oracle row for a suggestion that no longer shows: ${row.question}`);
  }
  return { rows, problems };
}

export interface SuggestionRoundRow {
  question: string;
  subject: string;
  figureNeed: string;
  teaches: boolean;
  teachNote: string;
  draws: boolean;
  tier: string | null;
  figureSource: string | null;
  family: string | null;
  emptyCause: string | null;
  runFile: string | null;
}

/**
 * A lesson teaches when it finished without a transport or pipeline error and
 * wrote and said something: at least three narrated steps and one board row,
 * and the stream was not cut short.
 */
export function lessonTeaches(run: LectureRun): { teaches: boolean; note: string } {
  if (run.error) return { teaches: false, note: `error: ${String(run.error).slice(0, 120)}` };
  const steps = run.teaching?.steps.length ?? 0;
  const writes = run.teaching?.writes.length ?? 0;
  if (run.teaching?.incomplete) return { teaches: false, note: `stream incomplete after ${steps} steps` };
  if (steps < 3) return { teaches: false, note: `${steps} steps` };
  if (writes < 1) return { teaches: false, note: "no board rows" };
  return { teaches: true, note: `${steps} steps, ${writes} rows` };
}

export function readRound(roundDir: string): Map<string, { run: LectureRun; file: string }> {
  const runsDir = join(roundDir, "runs");
  const byQuestion = new Map<string, { run: LectureRun; file: string }>();
  for (const name of readdirSync(runsDir).filter((file) => file.endsWith(".json")).sort()) {
    const file = join(runsDir, name);
    const run = JSON.parse(readFileSync(file, "utf8")) as LectureRun;
    byQuestion.set(run.question, { run, file });
  }
  return byQuestion;
}

export function gradeRound(
  rows: readonly HomeSuggestionOracleRow[],
  round: Map<string, { run: LectureRun; file: string }>,
): SuggestionRoundRow[] {
  return rows.map((row) => {
    const hit = round.get(row.question);
    if (!hit) {
      return {
        question: row.question, subject: row.subject, figureNeed: row.figure_need,
        teaches: false, teachNote: "not run", draws: false, tier: null, figureSource: null,
        family: null, emptyCause: null, runFile: null,
      };
    }
    const { teaches, note } = lessonTeaches(hit.run);
    return {
      question: row.question, subject: row.subject, figureNeed: row.figure_need,
      teaches, teachNote: note,
      draws: hit.run.diagram.committed,
      tier: hit.run.diagram.tier ?? null,
      figureSource: hit.run.diagram.figureSource ?? null,
      family: hit.run.diagram.family ?? null,
      emptyCause: hit.run.diagram.emptyCause ?? null,
      runFile: hit.file,
    };
  });
}

function parseCandidate(rawContent: string | undefined): Record<string, unknown> | null {
  if (!rawContent) return null;
  const first = rawContent.indexOf("{");
  const last = rawContent.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    const parsed = JSON.parse(rawContent.slice(first, last + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Freeze one lab run's accepted figure inputs. The candidate is the selected
 * planner document, so replay revalidates it instead of trusting the saved
 * validation; the family figure is rebuilt on replay for the same reason.
 */
export function recordingFromRun(
  run: LectureRun & { executionConfig?: { diagramYieldPolicy?: DiagramYieldPolicy } },
  recordedFrom: string,
  judged: HomeSuggestionRecording["judged"],
): HomeSuggestionRecording {
  const inputs = run.figureReplayInputs;
  if (!inputs) throw new Error(`run has no figureReplayInputs: ${recordedFrom}`);
  const selected = run.diagram.plannerResponses?.find((response) => response.selected);
  const { candidateValidation, fastRepresentation, ...input } = inputs.selection;
  const validated = candidateValidation?.value?.document as Record<string, unknown> | undefined;
  const recording: HomeSuggestionRecording = {
    schemaVersion: HOME_SUGGESTION_RECORDING_VERSION,
    question: run.question,
    recordedFrom,
    judged,
    selection: {
      ...input,
      candidate: parseCandidate(selected?.rawContent) ?? validated ?? null,
      rebuildFamilyFigure: fastRepresentation != null,
      yieldPolicy: run.executionConfig?.diagramYieldPolicy ?? parseDiagramYieldPolicy(process.env.DIAGRAM_YIELD_POLICY),
    },
    expected: { drawn: false, figureSource: "text_only", tier: null, family: null, entityIds: [], texts: [], inkHash: null },
  };
  recording.expected = replayRecording(recording);
  return recording;
}
