import {
  getSegmentCommands,
  lessonNarrationText,
  parseStoredSegmentCommands,
  type DrawCommand,
  type TutorSegment,
} from "@heytutor/drawing";
import type { RecordedSegmentPayload, StoredTurn } from "@/lib/boards/boardsClient";

export interface LessonPlanFact {
  id: string;
  symbol: string;
  value: number;
  unit?: string;
}

export interface LessonTurnNotes {
  question: string;
  workLines: string[];
  narration: string;
  planFacts: LessonPlanFact[];
}

export interface LessonNotesSnapshot {
  turns: LessonTurnNotes[];
  lectureInProgress: boolean;
}

export interface LiveLessonNotesInput {
  question: string;
  collectedSegments: readonly TutorSegment[];
  recordedSegments: readonly RecordedSegmentPayload[];
  currentSegmentText?: string;
  rawResponse?: string;
  sceneArtifacts?: unknown;
}

const WORK_COMMAND_TYPES = new Set(["WRITE", "LABEL"]);

export function workLinesFromCommands(commands: readonly DrawCommand[]): string[] {
  const lines: string[] = [];
  for (const command of commands) {
    if (!WORK_COMMAND_TYPES.has(command.type)) continue;
    const text = command.text?.trim();
    if (!text) continue;
    if (lines[lines.length - 1] === text) continue;
    lines.push(text);
  }
  return lines;
}

export function workLinesFromStoredCommand(stored: unknown): string[] {
  return workLinesFromCommands(parseStoredSegmentCommands(stored));
}

export function workLinesFromTutorSegment(segment: TutorSegment): string[] {
  return workLinesFromCommands(getSegmentCommands(segment));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function quantityFact(value: unknown): LessonPlanFact | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.symbol !== "string") {
    return null;
  }
  if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
    return null;
  }
  return {
    id: value.id,
    symbol: value.symbol,
    value: value.value,
    unit: typeof value.unit === "string" && value.unit.trim() ? value.unit : undefined,
  };
}

export function planFactsFromSceneArtifacts(artifacts: unknown): LessonPlanFact[] {
  if (!isRecord(artifacts) || !isRecord(artifacts.turnPlan)) {
    return [];
  }
  const plan = artifacts.turnPlan;
  const facts: LessonPlanFact[] = [];
  const seen = new Set<string>();
  const groups = [plan.givens, plan.derived];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const fact = quantityFact(item);
      if (!fact || seen.has(fact.id)) continue;
      seen.add(fact.id);
      facts.push(fact);
    }
  }
  return facts;
}

function joinNarration(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function notesFromStoredTurn(turn: StoredTurn): LessonTurnNotes {
  const workLines: string[] = [];
  const narrationParts: string[] = [];
  for (const segment of turn.segments) {
    for (const line of workLinesFromStoredCommand(segment.command)) {
      if (workLines[workLines.length - 1] !== line) {
        workLines.push(line);
      }
    }
    if (segment.narration.trim()) {
      narrationParts.push(segment.narration);
    }
  }
  const narration =
    joinNarration(narrationParts) || lessonNarrationText(turn.rawResponse).trim();
  return {
    question: turn.question.trim(),
    workLines,
    narration,
    planFacts: planFactsFromSceneArtifacts(turn.sceneArtifacts),
  };
}

export function notesFromLiveInput(input: LiveLessonNotesInput): LessonTurnNotes {
  const workLines: string[] = [];
  const narrationParts: string[] = [];

  const recorded = input.recordedSegments;
  if (recorded.length > 0) {
    for (const segment of recorded) {
      for (const line of workLinesFromStoredCommand(segment.command)) {
        if (workLines[workLines.length - 1] !== line) {
          workLines.push(line);
        }
      }
      if (segment.narration.trim()) {
        narrationParts.push(segment.narration);
      }
    }
  } else {
    for (const segment of input.collectedSegments) {
      for (const line of workLinesFromTutorSegment(segment)) {
        if (workLines[workLines.length - 1] !== line) {
          workLines.push(line);
        }
      }
      if (segment.narration.trim()) {
        narrationParts.push(segment.narration);
      }
    }
  }

  const current = input.currentSegmentText?.trim();
  if (current && narrationParts[narrationParts.length - 1] !== current) {
    narrationParts.push(current);
  }

  const narration =
    joinNarration(narrationParts) ||
    (input.rawResponse ? lessonNarrationText(input.rawResponse).trim() : "");

  return {
    question: input.question.trim(),
    workLines,
    narration,
    planFacts: planFactsFromSceneArtifacts(input.sceneArtifacts),
  };
}

function turnHasContent(turn: LessonTurnNotes): boolean {
  return Boolean(turn.question || turn.workLines.length > 0 || turn.narration);
}

function liveIsAlreadyPersisted(persisted: LessonTurnNotes, live: LessonTurnNotes): boolean {
  if (persisted.question !== live.question) return false;
  if (persisted.workLines.length < live.workLines.length) return false;
  if (live.narration && !persisted.narration.includes(live.narration.slice(0, 80))) {
    return persisted.narration.length >= live.narration.length;
  }
  return true;
}

export function assembleLessonNotes(
  persisted: LessonTurnNotes[],
  live: LessonTurnNotes | null,
  lectureInProgress: boolean,
): LessonNotesSnapshot {
  const turns = persisted.filter(turnHasContent);
  if (lectureInProgress && live && turnHasContent(live)) {
    const last = turns[turns.length - 1];
    if (!last || !liveIsAlreadyPersisted(last, live)) {
      if (last && last.question === live.question) {
        turns[turns.length - 1] = live;
      } else {
        turns.push(live);
      }
    }
  }
  return { turns, lectureInProgress };
}

export function parseLiveTurnNotes(raw: unknown): LessonTurnNotes | null {
  if (!isRecord(raw)) return null;
  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  const workLines = Array.isArray(raw.workLines)
    ? raw.workLines.filter((line): line is string => typeof line === "string").map((line) => line.trim()).filter(Boolean)
    : [];
  const narration = typeof raw.narration === "string" ? raw.narration.trim() : "";
  const planFacts = Array.isArray(raw.planFacts)
    ? raw.planFacts.map(quantityFact).filter((fact): fact is LessonPlanFact => fact !== null)
    : [];
  const live = { question, workLines, narration, planFacts };
  return turnHasContent(live) ? live : null;
}

export function buildLessonNotes(input: {
  persistedTurns: readonly StoredTurn[];
  live?: LiveLessonNotesInput | null;
  lectureInProgress: boolean;
}): LessonNotesSnapshot {
  const persisted = input.persistedTurns.map(notesFromStoredTurn);
  const live = input.live ? notesFromLiveInput(input.live) : null;
  return assembleLessonNotes(persisted, live, input.lectureInProgress);
}

export function lessonNotesAreEmpty(snapshot: LessonNotesSnapshot): boolean {
  return snapshot.turns.every((turn) => !turnHasContent(turn));
}

export function formatPlanFact(fact: LessonPlanFact): string {
  const unit = fact.unit ? ` ${fact.unit}` : "";
  return `${fact.symbol} = ${fact.value}${unit}`.replace(/\s+/g, " ").trim();
}

export function formatLessonNotesForPrompt(snapshot: LessonNotesSnapshot): string {
  if (lessonNotesAreEmpty(snapshot)) {
    return snapshot.lectureInProgress
      ? "the lecture is starting. no board notes yet."
      : "the board has no notes yet.";
  }

  const blocks = snapshot.turns.map((turn, index) => {
    const lines: string[] = [`turn ${index + 1}`];
    if (turn.question) lines.push(`question: ${turn.question}`);
    if (turn.planFacts.length > 0) {
      lines.push(`plan facts: ${turn.planFacts.map(formatPlanFact).join("; ")}`);
    }
    if (turn.workLines.length > 0) {
      lines.push("board work:");
      for (const line of turn.workLines) {
        lines.push(`- ${line}`);
      }
    }
    if (turn.narration) {
      lines.push(`spoken: ${turn.narration}`);
    }
    return lines.join("\n");
  });

  const prefix = snapshot.lectureInProgress
    ? "the lecture is still in progress. only the notes below are on the board so far.\n\n"
    : "";
  return `${prefix}${blocks.join("\n\n")}`;
}
